// Network guard: a local forward proxy that every browser request goes through. It resolves host names itself and
// connects only to addresses the policy allows, so a page cannot reach loopback, LAN or cloud-metadata services by
// literal IP, by a host name with a mixed DNS answer, by DNS rebinding between a check and the connection, through
// a redirect, an iframe or a WebSocket. Blocked attempts are recorded as evidence for the report.
//
// HTTPS and WebSockets are tunnelled with CONNECT (the proxy never sees or alters their content); plain HTTP is
// forwarded. Node-side fetches (robots.txt, sitemaps) use `guardedFetchText` with the same policy per redirect hop.
import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import {
  type AddressPolicy,
  addressVerdict,
  classifyIp,
  isLocalHostname,
  RESOLVE_TIMEOUT_MS,
  withTimeout,
} from './url-safety.js';

export interface BlockedConnection {
  host: string;
  port: number;
  reason: string;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export class GuardBlockedError extends Error {
  readonly code = 'EJOURILOBLOCKED';
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Injectable for tests: name resolution and the per-address decision. */
export interface GuardDeps {
  resolve?: (host: string) => Promise<LookupAddress[]>;
  verdict?: (address: string, port: number) => Verdict;
  /** Limit for one name lookup (default 5 s). */
  resolveTimeoutMs?: number;
}

const systemResolve = (host: string) =>
  new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
  );

/**
 * Resolves a host and keeps only addresses the policy allows. A mixed answer keeps its allowed addresses, so the
 * connection can never reach a forbidden one; an answer with no allowed address is blocked. Callers connect to the
 * returned address itself, so there is no second lookup that DNS rebinding could change.
 */
export async function resolveAllowed(
  host: string,
  port: number,
  policy: AddressPolicy,
  deps: GuardDeps = {},
): Promise<{ address: string; family: number } | { blocked: string }> {
  const h = host.replace(/^\[|\]$/g, '');
  const verdict = deps.verdict ?? ((ip: string, port: number) => addressVerdict(ip, policy, port));
  let addrs: LookupAddress[];
  if (isIP(h)) addrs = [{ address: h, family: isIP(h) }];
  else {
    try {
      addrs = await withTimeout(
        (deps.resolve ?? systemResolve)(h),
        deps.resolveTimeoutMs ?? RESOLVE_TIMEOUT_MS,
        `DNS lookup failed for ${h} (timed out)`,
      );
    } catch (err) {
      throw Object.assign(new Error(`DNS lookup failed for ${h}`), { cause: err });
    }
  }
  let reason = '';
  for (const a of addrs) {
    const v = verdict(a.address, port);
    if (v.ok) return { address: a.address, family: a.family };
    reason ||= v.reason;
  }
  return { blocked: reason || `${h} did not resolve to an allowed address.` };
}

/** A `dns.lookup`-compatible function (for http.request) built on resolveAllowed. */
export function guardedLookup(policy: AddressPolicy, port: number, deps: GuardDeps = {}) {
  return (hostname: string, options: { all?: boolean } | number, callback: LookupCallback): void => {
    const wantAll = typeof options === 'object' && options?.all === true;
    resolveAllowed(hostname, port, policy, deps).then(
      (r) => {
        if ('blocked' in r) return callback(new GuardBlockedError(r.blocked), wantAll ? [] : '', 0);
        if (wantAll) return callback(null, [{ address: r.address, family: r.family }]);
        callback(null, r.address, r.family);
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, wantAll ? [] : '', 0),
    );
  };
}

function splitHostPort(authority: string, defaultPort: number): { host: string; port: number } | null {
  const m = authority.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1]!.replace(/^\[|\]$/g, ''), port };
}

const HOP_BY_HOP = new Set([
  'proxy-connection',
  'proxy-authorization',
  'proxy-authenticate',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Loopback names the browser resolves itself without asking the proxy. */
function isLoopbackName(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || (isIP(h) !== 0 && classifyIp(h) === 'loopback');
}

/** A redirect from an allowed page to a loopback address the policy forbids, or null. */
export function loopbackRedirectVerdict(location: string, from: URL, policy: AddressPolicy): string | null {
  let to: URL;
  try {
    to = new URL(location, from);
  } catch {
    return null;
  }
  if (policy.denyLocal) {
    const h = to.hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .replace(/\.$/, '');
    const local = isLocalHostname(h) || (isIP(h) !== 0 && classifyIp(h) === 'loopback');
    const port = Number(to.port || (to.protocol === 'https:' ? 443 : 80));
    const own = policy.allowLoopbackPorts?.includes(port) && (h === '127.0.0.1' || h === 'localhost');
    if (local && !own)
      return `redirect from ${from.host} to ${to.host} (a local address) refused: --deny-local is set.`;
  }
  if (!isLoopbackName(to.hostname)) return null;
  if (policy.target === 'local' || policy.allowPrivate) return null;
  return `redirect from ${from.host} to ${to.host} (this machine) refused.`;
}

/**
 * Whether a browser request is a redirect hop that reached a forbidden loopback address. WebKit sends these
 * directly instead of through the proxy when the redirect came over HTTPS (which the proxy cannot read), so they
 * are detected here and reported; they cannot be prevented in that engine.
 */
export function redirectEscape(
  url: string,
  redirectedFrom: string | null,
  policy: AddressPolicy,
): string | null {
  if (!redirectedFrom) return null;
  try {
    return loopbackRedirectVerdict(url, new URL(redirectedFrom), policy);
  } catch {
    return null;
  }
}

export interface NetGuard {
  /** Proxy URL for the browser (http://127.0.0.1:port). */
  url: string;
  policy: AddressPolicy;
  /** Secret of this guard instance: only a response header that starts with it is the guard's own signal. */
  token: string;
  /** Connections refused by the policy (deduplicated by host:port, capped). */
  blocked: BlockedConnection[];
  close(): Promise<void>;
}

/** Set on the guard's own 502 so a page that never reached the server is not mistaken for an HTTP error page. */
export const GUARD_UPSTREAM_ERROR_HEADER = 'x-jourilo-guard-upstream-error';

/** Fixed wording for a connection failure; the raw error can carry resolved IP addresses and must not be reported. */
export function upstreamFailureWording(message: string): string {
  if (/DNS lookup failed|ENOTFOUND|EAI_AGAIN/i.test(message)) return 'the host name could not be resolved';
  if (/ECONNREFUSED/i.test(message)) return 'the connection was refused';
  if (/ETIMEDOUT|timed out/i.test(message)) return 'the connection timed out';
  if (/ECONNRESET/i.test(message)) return 'the connection was reset';
  if (/cert|SSL|TLS/i.test(message)) return 'the TLS certificate was rejected';
  return 'the connection failed';
}

export async function startNetGuard(policy: AddressPolicy, deps: GuardDeps = {}): Promise<NetGuard> {
  const token = randomBytes(16).toString('hex');
  const blocked: BlockedConnection[] = [];
  const seen = new Set<string>();
  const record = (host: string, port: number, reason: string) => {
    const key = `${host}:${port}`;
    if (seen.has(key) || blocked.length >= 200) return;
    seen.add(key);
    blocked.push({ host, port, reason });
  };
  const sockets = new Set<Duplex>();
  // Idempotent: a kept-alive upstream socket is reported again for every request it carries.
  const track = <T extends Duplex>(s: T): T => {
    if (sockets.has(s)) return s;
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
    return s;
  };

  /** Resolves under the policy and opens a TCP connection to the allowed address itself. */
  const connectUpstream = (
    host: string,
    port: number,
    onReady: (s: Socket) => void,
    onFail: (status: number, reason: string) => void,
  ) => {
    resolveAllowed(host, port, policy, deps).then(
      (r) => {
        if ('blocked' in r) {
          record(host, port, r.blocked);
          return onFail(403, r.blocked);
        }
        const upstream = track(net.connect({ host: r.address, port }));
        upstream.once('connect', () => onReady(upstream));
        upstream.once('error', (err) => onFail(502, err.message));
      },
      (err: Error) => onFail(502, err.message),
    );
  };

  const pipeBoth = (client: Duplex, upstream: Socket, head: Buffer) => {
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  };

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    // Plain HTTP through the proxy arrives with an absolute URI.
    let target: URL;
    try {
      target = new URL(req.url ?? '');
      if (target.protocol !== 'http:') throw new Error('not http');
    } catch {
      res.writeHead(400).end('Jourilo network guard: absolute http:// URL expected.');
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = Number(target.port || 80);
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    const fail = (status: number, reason: string) => {
      if (res.headersSent) return void res.destroy();
      res
        .writeHead(status, {
          'content-type': 'text/plain',
          ...(status === 403
            ? {}
            : { [GUARD_UPSTREAM_ERROR_HEADER]: `${token} ${upstreamFailureWording(reason)}` }),
        })
        .end(status === 403 ? `Blocked by Jourilo network guard: ${reason}` : 'Bad gateway');
    };
    resolveAllowed(host, port, policy, deps).then(
      (r) => {
        if ('blocked' in r) {
          record(host, port, r.blocked);
          req.resume();
          return fail(403, r.blocked);
        }
        const upstream = http.request({
          host: r.address,
          port,
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          setHost: false,
        });
        upstream.on('response', (up) => {
          // WebKit follows redirects to loopback hosts outside the proxy, so a forbidden redirect target is
          // refused here, while the proxy can still see it (plain HTTP only; see redirectEscape for HTTPS).
          const loc =
            (up.statusCode ?? 0) >= 300 && (up.statusCode ?? 0) < 400 ? up.headers.location : undefined;
          const refused = loc ? loopbackRedirectVerdict(loc, target, policy) : null;
          if (refused) {
            up.resume();
            record(host, port, refused);
            return fail(403, refused);
          }
          const out: Record<string, string | string[]> = {};
          for (const [k, v] of Object.entries(up.headers))
            if (
              v !== undefined &&
              !HOP_BY_HOP.has(k.toLowerCase()) &&
              k.toLowerCase() !== GUARD_UPSTREAM_ERROR_HEADER
            )
              out[k] = v;
          res.writeHead(up.statusCode ?? 502, up.statusMessage, out);
          up.pipe(res);
        });
        upstream.on('socket', (s) => track(s));
        // A request the browser gave up on (its page closed, an abandoned page) ends upstream too: a server that never
        // answers would otherwise keep the connection, and so Jourilo's process, alive after the audit.
        res.on('close', () => {
          if (!res.writableFinished) upstream.destroy();
        });
        upstream.on('error', (err) => {
          if (!res.destroyed) fail(502, err.message);
        });
        req.pipe(upstream);
      },
      (err: Error) => fail(502, err.message),
    );
  });

  // HTTPS and WebSockets (ws:// and wss://) are tunnelled.
  server.on('connect', (req: IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on('error', () => undefined);
    const hp = splitHostPort(req.url ?? '', 443);
    if (!hp) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    connectUpstream(
      hp.host,
      hp.port,
      (upstream) => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        pipeBoth(client, upstream, head);
      },
      (status, reason) =>
        client.end(
          `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\ncontent-type: text/plain\r\n\r\n${status === 403 ? `Blocked by Jourilo network guard: ${reason}` : ''}`,
        ),
    );
  });

  // Plain ws:// sent as an Upgrade request with an absolute URI (some engines do this instead of CONNECT).
  server.on('upgrade', (req: IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on('error', () => undefined);
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    connectUpstream(
      target.hostname,
      Number(target.port || 80),
      (upstream) => {
        const lines = [`${req.method} ${target.pathname}${target.search} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i]!;
          if (/^proxy-/i.test(k)) continue;
          lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
        }
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        pipeBoth(client, upstream, head);
      },
      (status) => client.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\n\r\n`),
    );
  });
  server.on('connection', (s) => track(s));
  server.on('clientError', (_err, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    policy,
    token,
    blocked,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/**
 * GET a small text resource (robots.txt, sitemap) under the address policy. Redirects are followed manually, at most
 * five, only on the same origin, and every hop is resolved and checked again before connecting.
 */
export async function guardedFetchText(
  url: string,
  policy: AddressPolicy,
  opts: { timeoutMs: number; userAgent: string; maxBytes?: number; deps?: GuardDeps },
): Promise<string | null> {
  const origin = new URL(url).origin;
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (current.origin !== origin) return null;
    const port = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
    // Node skips `lookup` for literal IPs, so every hop is checked here as well.
    const pre = await resolveAllowed(current.hostname, port, policy, opts.deps).catch(() => null);
    if (!pre || 'blocked' in pre) return null;
    const res = await new Promise<{ status: number; location?: string; body?: string } | null>((resolve) => {
      const mod = current.protocol === 'https:' ? https : http;
      const req = mod.get(
        current,
        {
          headers: { 'user-agent': opts.userAgent, accept: 'text/plain, application/xml, text/xml, */*' },
          lookup: guardedLookup(policy, port, opts.deps) as never,
          timeout: opts.timeoutMs,
          agent: false,
        },
        (r) => {
          const status = r.statusCode ?? 0;
          if (status >= 300 && status < 400 && r.headers.location) {
            r.resume();
            return resolve({ status, location: r.headers.location });
          }
          if (status < 200 || status >= 300) {
            r.resume();
            return resolve({ status });
          }
          const max = opts.maxBytes ?? 2_000_000;
          let size = 0;
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => {
            size += c.length;
            if (size <= max) chunks.push(c);
            else r.destroy();
          });
          const done = () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
          r.on('end', done);
          r.on('close', done);
          r.on('error', () => resolve(null));
        },
      );
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
    });
    if (!res) return null;
    if (res.location) {
      try {
        current = new URL(res.location, current);
      } catch {
        return null;
      }
      continue;
    }
    return res.body ?? null;
  }
  return null;
}
