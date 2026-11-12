// Network guard: a local forward proxy that every browser request goes through. It resolves host names itself and
// connects only to addresses the policy allows, so a page cannot reach loopback, LAN or cloud-metadata services by
// literal IP, by a host name with a mixed DNS answer, by DNS rebinding between a check and the connection, through
// a redirect, an iframe or a WebSocket. Blocked attempts are recorded as evidence for the report.
//
// HTTPS and WebSockets are tunnelled with CONNECT (the proxy never sees or alters their content); plain HTTP is
// forwarded. Node-side fetches (robots.txt, sitemaps) use `guardedFetchText` with the same policy per redirect hop.
//
// With an upstream proxy (`--proxy`, HTTPS_PROXY), the guard still resolves and checks every destination itself, then
// asks the proxy for a CONNECT tunnel to the checked address (`CONNECT 93.184.216.34:443`), never to the name, so the
// proxy's own DNS cannot send a request somewhere the guard did not check. Plain HTTP goes to the proxy as an
// absolute-URI request for the checked address (`GET http://93.184.216.34:80/path`, the original Host header kept),
// since many proxies refuse CONNECT to port 80. Loopback addresses a local target may reach, and hosts NO_PROXY
// matches, connect directly (the proxy's loopback is another machine).
import { randomBytes } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { isIP, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import {
  type AddressPolicy,
  addressVerdict,
  classifyIp,
  hostVerdict,
  isLocalHostname,
  noProxyMatches,
  RESOLVE_TIMEOUT_MS,
  type Upstream,
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
  // --allow-hosts / --block-hosts decide by name, before the name is even looked up.
  const named = hostVerdict(h, policy);
  if (!named.ok) return { blocked: named.reason };
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

/** How long the upstream proxy may take to open a tunnel. */
const TUNNEL_TIMEOUT_MS = 30_000;

/**
 * Whether a destination is reached through the upstream proxy: everything but this machine and the hosts NO_PROXY
 * matches, decided per destination (`host` is the name the request asked for, `address` the checked IP).
 */
export function viaUpstream(
  policy: AddressPolicy,
  host: string,
  address: string,
  port: number,
): Upstream | undefined {
  const up = policy.upstream;
  if (!up || classifyIp(address) === 'loopback') return undefined;
  if (up.noProxy && noProxyMatches(host, port, up.noProxy)) return undefined;
  return up;
}

/** `ip:port`, with brackets for IPv6. */
const authorityOf = (address: string, port: number) =>
  `${isIP(address) === 6 ? `[${address}]` : address}:${port}`;

/** The Proxy-Authorization header for an upstream proxy with credentials. */
const proxyAuthorization = (up: Upstream): Record<string, string> =>
  up.auth ? { 'proxy-authorization': `Basic ${Buffer.from(up.auth).toString('base64')}` } : {};

/**
 * Opens a CONNECT tunnel through the upstream proxy to an address the guard already checked. The request names the
 * address, never a host name. Errors name the proxy step but never its credentials. `onSocket` sees the socket as soon
 * as it exists, so its owner can destroy it while the handshake is still pending.
 */
export function openTunnel(
  upstream: Upstream,
  address: string,
  port: number,
  timeoutMs = TUNNEL_TIMEOUT_MS,
  onSocket?: (s: Socket) => void,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const authority = authorityOf(address, port);
    const sock = net.connect({ host: upstream.host, port: upstream.port });
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error(`upstream proxy: ${message}`));
    };
    sock.setTimeout(timeoutMs, () => fail('timed out'));
    sock.once('error', (err: NodeJS.ErrnoException) => fail(err.code ?? 'connection failed'));
    sock.once('close', () => fail('closed the connection'));
    sock.once('connect', () => {
      const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`];
      for (const [k, v] of Object.entries(proxyAuthorization(upstream))) lines.push(`${k}: ${v}`);
      sock.write(`${lines.join('\r\n')}\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) {
        if (buf.length > 16_384) fail('answered with an oversized header');
        return;
      }
      sock.off('data', onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(buf.subarray(0, end).toString('latin1'))?.[1] ?? 0);
      if (status !== 200) return fail(`answered ${status || 'without a status'}`);
      settled = true;
      sock.setTimeout(0);
      sock.removeAllListeners('close');
      sock.removeAllListeners('error');
      // The tunnel's user adds its own handlers; an error before then must not crash the process.
      sock.on('error', () => undefined);
      // Nothing is read until the tunnel's user attaches; bytes after the header (none in practice) are kept.
      sock.pause();
      const rest = buf.subarray(end + 4);
      if (rest.length) sock.unshift(rest);
      resolve(sock);
    };
    sock.on('data', onData);
    onSocket?.(sock);
  });
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
    const own = policy.allowLoopbackPorts?.includes(port) && h === '127.0.0.1';
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
/** The signal's wording for a destination the guard refused (a failed CONNECT answered 403). */
export const GUARD_REFUSED_WORDING = 'the network guard refused the destination';

/** Fixed wording for a connection failure; the raw error can carry resolved IP addresses and must not be reported. */
export function upstreamFailureWording(message: string): string {
  if (/upstream proxy: answered 407/.test(message)) return 'the upstream proxy asked for credentials (407)';
  if (/upstream proxy:/.test(message)) return 'the upstream proxy could not open the connection';
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
  // Set by close(): a socket that appears afterwards (a DNS answer or a tunnel that came late) is destroyed at once.
  let closed = false;
  // Idempotent: a kept-alive upstream socket is reported again for every request it carries.
  const track = <T extends Duplex>(s: T): T => {
    if (closed) {
      s.destroy();
      return s;
    }
    if (sockets.has(s)) return s;
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
    return s;
  };

  /** Resolves under the policy; `onAllowed` gets the checked address and the upstream proxy to reach it through. */
  const checkDestination = (
    host: string,
    port: number,
    onAllowed: (address: string, proxy: Upstream | undefined) => void,
    onFail: (status: number, reason: string) => void,
  ) => {
    resolveAllowed(host, port, policy, deps).then(
      (r) => {
        if ('blocked' in r) {
          record(host, port, r.blocked);
          return onFail(403, r.blocked);
        }
        onAllowed(r.address, viaUpstream(policy, host, r.address, port));
      },
      (err: Error) => onFail(502, err.message),
    );
  };

  /** Opens a TCP connection to the checked address itself, or a CONNECT tunnel to it through the upstream proxy. */
  const connectUpstream = (
    host: string,
    port: number,
    onReady: (s: Socket) => void,
    onFail: (status: number, reason: string) => void,
  ) => {
    checkDestination(
      host,
      port,
      (address, proxy) => {
        if (proxy) {
          openTunnel(proxy, address, port, TUNNEL_TIMEOUT_MS, track).then(
            (tunnel) => onReady(track(tunnel)),
            (err: Error) => onFail(502, err.message),
          );
          return;
        }
        const upstream = track(net.connect({ host: address, port }));
        upstream.once('connect', () => onReady(upstream));
        upstream.once('error', (err) => onFail(502, err.message));
      },
      onFail,
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
    // The browser's own Proxy-* headers are meant for this guard, never for the next hop.
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase()) && !/^proxy-/i.test(k)) headers[k] = v;
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
    // Direct: a connection to the checked address. Through the upstream proxy: an absolute-URI request that names the
    // checked address, never the host name (the Host header keeps the name for the origin server).
    checkDestination(
      host,
      port,
      (address, proxy) => {
        const socket = track(
          proxy ? net.connect({ host: proxy.host, port: proxy.port }) : net.connect({ host: address, port }),
        );
        const path = `${target.pathname}${target.search}`;
        const upstream = http.request({
          method: req.method,
          path: proxy ? `http://${authorityOf(address, port)}${path}` : path,
          headers: proxy ? { ...headers, ...proxyAuthorization(proxy) } : headers,
          setHost: false,
          createConnection: () => socket,
        });
        upstream.on('response', (up) => {
          // The proxy's own refusal is not a page from the target.
          if (proxy && up.statusCode === 407) {
            up.resume();
            return fail(502, 'upstream proxy: answered 407');
          }
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
        // A request the browser gave up on (its page closed, an abandoned page) ends upstream too: a server that never
        // answers would otherwise keep the connection, and so Jourilo's process, alive after the audit.
        res.on('close', () => {
          if (!res.writableFinished) upstream.destroy();
        });
        upstream.on('error', (err: NodeJS.ErrnoException) => {
          if (!res.destroyed)
            fail(502, proxy ? `upstream proxy: ${err.code ?? 'connection failed'}` : err.message);
        });
        req.pipe(upstream);
      },
      (status, reason) => {
        req.resume();
        fail(status, reason);
      },
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
      // Browsers ignore a failed CONNECT's headers. Jourilo's own fetches through the guard (route.fetch for
      // --extra-header) read the reply as the response, so it carries the token signal too, in fixed wording.
      (status, reason) =>
        client.end(
          `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Bad Gateway'}\r\ncontent-type: text/plain\r\n${GUARD_UPSTREAM_ERROR_HEADER}: ${token} ${status === 403 ? GUARD_REFUSED_WORDING : upstreamFailureWording(reason)}\r\n\r\n${status === 403 ? `Blocked by Jourilo network guard: ${reason}` : ''}`,
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
        closed = true;
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
    // Through the upstream proxy, by the checked address: HTTPS in a CONNECT tunnel with TLS to the host name inside
    // it, plain HTTP as an absolute-URI request (as the guard sends it).
    const servername = current.hostname.replace(/^\[|\]$/g, '');
    const proxy = viaUpstream(policy, servername, pre.address, port);
    const secure = current.protocol === 'https:';
    let tunnel: Socket | undefined;
    if (proxy && secure) {
      tunnel = await openTunnel(proxy, pre.address, port, opts.timeoutMs).catch(() => undefined);
      if (!tunnel) return null;
    }
    const headers = { 'user-agent': opts.userAgent, accept: 'text/plain, application/xml, text/xml, */*' };
    const res = await new Promise<{ status: number; location?: string; body?: string } | null>((resolve) => {
      const mod = secure ? https : http;
      const req = mod.get(
        current,
        {
          headers,
          timeout: opts.timeoutMs,
          ...(tunnel
            ? {
                createConnection: () => {
                  tunnel!.resume();
                  return tls.connect({
                    socket: tunnel!,
                    host: servername,
                    ...(isIP(servername) ? {} : { servername }),
                  });
                },
              }
            : proxy
              ? {
                  path: `http://${authorityOf(pre.address, port)}${current.pathname}${current.search}`,
                  headers: { ...headers, host: current.host, ...proxyAuthorization(proxy) },
                  createConnection: () => net.connect({ host: proxy.host, port: proxy.port }),
                }
              : { lookup: guardedLookup(policy, port, opts.deps) as never, agent: false }),
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
