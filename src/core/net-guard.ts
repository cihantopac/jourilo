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
// proxy's own DNS cannot send a request somewhere the guard did not check. Plain HTTP takes the same tunnel
// (`CONNECT 93.184.216.34:80`), and the original request, Host header included, is sent inside it: an absolute-URI
// request would make the proxy rebuild Host from the address (RFC 9112 3.2.2), so a name-based site would answer as
// its default host. A proxy that refuses tunnels to port 80 (a 4xx other than 407) fails the request with the guard's
// own 502, never its page; a 5xx means the proxy could not reach the site. Loopback addresses a local target may reach, and hosts NO_PROXY matches, connect directly (the proxy's
// loopback is another machine).
//
// A name can resolve to several allowed addresses (`localhost` to ::1 and 127.0.0.1). Every address is checked first;
// a direct connection then tries the allowed ones in resolver order and moves to the next only when the connection
// itself fails (refused, unreachable, or no answer within the attempt time), within one time budget for the request.
// An error after the connection is made (TLS, HTTP, a reset) is final.
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
  /** Limit for one address's connection when another address is left to try (default 5 s). */
  connectAttemptTimeoutMs?: number;
  /** Limit for connecting at all, every address included (default 30 s, and never more than a hop's own timeout). */
  connectTimeoutMs?: number;
}

const systemResolve = (host: string) =>
  new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))),
  );

/**
 * Resolves a host and keeps only addresses the policy allows, in resolver order. A mixed answer keeps its allowed
 * addresses, so the connection can never reach a forbidden one; an answer with no allowed address is blocked. Callers
 * connect to the returned addresses themselves, so there is no second lookup that DNS rebinding could change.
 */
export async function resolveAllowedAll(
  host: string,
  port: number,
  policy: AddressPolicy,
  deps: GuardDeps = {},
): Promise<{ addresses: { address: string; family: number }[] } | { blocked: string }> {
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
  const addresses: { address: string; family: number }[] = [];
  for (const a of addrs) {
    const v = verdict(a.address, port);
    if (v.ok) {
      if (!addresses.some((x) => x.address === a.address))
        addresses.push({ address: a.address, family: a.family });
    } else reason ||= v.reason;
  }
  if (addresses.length) return { addresses };
  return { blocked: reason || `${h} did not resolve to an allowed address.` };
}

/** The first address `resolveAllowedAll` allows. */
export async function resolveAllowed(
  host: string,
  port: number,
  policy: AddressPolicy,
  deps: GuardDeps = {},
): Promise<{ address: string; family: number } | { blocked: string }> {
  const r = await resolveAllowedAll(host, port, policy, deps);
  return 'blocked' in r ? r : r.addresses[0]!;
}

/** How long one address may take to accept the connection while another address is left to try. */
const CONNECT_ATTEMPT_TIMEOUT_MS = 5_000;
/** How long connecting may take in all, every address of the name included. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Failures of the connection itself: the next allowed address may still answer. */
const CONNECT_FALLBACK_CODES = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'ETIMEDOUT',
]);

const errorWithCode = (message: string, code: string) =>
  Object.assign(new Error(message), { code }) as NodeJS.ErrnoException;

/** One TCP connection to a checked address (a literal IP, so there is no lookup). */
function connectAddress(
  address: string,
  port: number,
  timeoutMs: number,
  onSocket?: (s: Socket) => void,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: address, port });
    let settled = false;
    const finish = (err?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.off('connect', onConnect);
      sock.off('error', finish);
      sock.off('close', onClose);
      if (err) {
        sock.destroy();
        return reject(err);
      }
      // The connection's user adds its own handlers; an error before then must not crash the process.
      sock.on('error', () => undefined);
      resolve(sock);
    };
    const onConnect = () => finish();
    const onClose = () =>
      finish(errorWithCode(`connect closed ${authorityOf(address, port)}`, 'ECONNABORTED'));
    const timer = setTimeout(
      () => finish(errorWithCode(`connect ETIMEDOUT ${authorityOf(address, port)}`, 'ETIMEDOUT')),
      timeoutMs,
    );
    sock.once('connect', onConnect);
    sock.once('error', finish);
    sock.once('close', onClose);
    onSocket?.(sock);
  });
}

/**
 * Connects to the first of the checked addresses that accepts, in order. Only a failure of the connection itself moves
 * on to the next address; any other error, or the end of the time budget, is final. The last error is reported.
 */
async function connectFirst(
  addresses: string[],
  port: number,
  opts: { attemptTimeoutMs: number; timeoutMs: number; onSocket?: (s: Socket) => void },
): Promise<Socket> {
  const deadline = Date.now() + opts.timeoutMs;
  let last: NodeJS.ErrnoException | undefined;
  for (const [i, address] of addresses.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const limit = i === addresses.length - 1 ? remaining : Math.min(opts.attemptTimeoutMs, remaining);
    try {
      return await connectAddress(address, port, limit, opts.onSocket);
    } catch (err) {
      last = err as NodeJS.ErrnoException;
      if (!CONNECT_FALLBACK_CODES.has(last.code ?? '')) throw last;
    }
  }
  throw last ?? errorWithCode(`connect ETIMEDOUT ${port}`, 'ETIMEDOUT');
}

/**
 * Opens a connection to a destination `resolveAllowedAll` checked: a TCP connection to the first allowed address that
 * accepts, or a CONNECT tunnel through the upstream proxy. Through the proxy, the tunnel goes to the first allowed
 * address only: the proxy, not this machine, makes the connection, so its failures are not connection failures here.
 * When the first address goes through the proxy, a later one never connects directly.
 */
async function connectChecked(
  host: string,
  port: number,
  addresses: { address: string }[],
  policy: AddressPolicy,
  opts: { deps?: GuardDeps; timeoutMs: number; tunnelTimeoutMs: number; onSocket?: (s: Socket) => void },
): Promise<Socket> {
  const first = addresses[0]!.address;
  const proxy = viaUpstream(policy, host, first, port);
  if (proxy) return openTunnel(proxy, first, port, opts.tunnelTimeoutMs, opts.onSocket);
  const direct = addresses.map((a) => a.address).filter((a) => !viaUpstream(policy, host, a, port));
  return connectFirst(direct, port, {
    attemptTimeoutMs: opts.deps?.connectAttemptTimeoutMs ?? CONNECT_ATTEMPT_TIMEOUT_MS,
    timeoutMs: Math.min(opts.timeoutMs, opts.deps?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS),
    ...(opts.onSocket ? { onSocket: opts.onSocket } : {}),
  });
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
  const port = /upstream proxy: refuses tunnels to port (\d+)/.exec(message)?.[1];
  if (port) return `the upstream proxy refuses tunnels to port ${port}; give the target's https:// URL`;
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

  /**
   * Resolves under the policy, then opens a TCP connection to the first checked address that accepts it, or a CONNECT
   * tunnel to the checked address through the upstream proxy (connectChecked).
   */
  const connectUpstream = (
    host: string,
    port: number,
    onReady: (s: Socket) => void,
    onFail: (status: number, reason: string) => void,
  ) => {
    resolveAllowedAll(host, port, policy, deps).then(
      (r) => {
        if ('blocked' in r) {
          record(host, port, r.blocked);
          return onFail(403, r.blocked);
        }
        connectChecked(host, port, r.addresses, policy, {
          deps,
          timeoutMs: CONNECT_TIMEOUT_MS,
          tunnelTimeoutMs: TUNNEL_TIMEOUT_MS,
          onSocket: track,
        }).then(
          (socket) => onReady(track(socket)),
          (err: Error) => onFail(502, err.message),
        );
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
    // A chunked body on a method Node does not chunk by default (GET, HEAD, DELETE, OPTIONS) keeps its framing.
    if (req.headers['transfer-encoding'] && req.headers['content-length'] === undefined)
      headers['transfer-encoding'] = 'chunked';
    // One path for direct connections and the upstream proxy's tunnel (CONNECT to the checked address): the socket
    // comes from connectUpstream, and the request inside it keeps its own Host header.
    connectUpstream(
      host,
      port,
      (socket) => {
        const upstream = http.request({
          method: req.method,
          path: `${target.pathname}${target.search}`,
          headers,
          setHost: false,
          createConnection: () => socket,
        });
        socket.resume();
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
      (status, reason) => {
        req.resume();
        // A proxy that answers a plain-HTTP tunnel with a 4xx other than 407 refuses that port (403/405 for a
        // non-SSL port is common): say so in fixed wording, the proxy's page is never shown. A 5xx means the proxy
        // could not reach the site, which is not a policy refusal, so it keeps the "could not open" wording.
        const answered = /^upstream proxy: answered (\d{3})/.exec(reason)?.[1];
        const refusesPort = answered?.startsWith('4') && answered !== '407';
        fail(status, refusesPort ? `upstream proxy: refuses tunnels to port ${port}` : reason);
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

interface HopOptions {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes?: number;
  deps?: GuardDeps;
}

type Hop =
  | { status: number; headers: IncomingMessage['headers']; body: string }
  | { blocked: string }
  | { failed: string };

/**
 * One request under the address policy, without following redirects. The host is resolved and checked before
 * connecting; through an upstream proxy the request takes a CONNECT tunnel to the checked address, as the guard does.
 */
async function guardedHop(current: URL, policy: AddressPolicy, opts: HopOptions): Promise<Hop> {
  const port = Number(current.port || (current.protocol === 'https:' ? 443 : 80));
  const pre = await resolveAllowedAll(current.hostname, port, policy, opts.deps).catch(
    (e: Error) => ({ blocked: `${current.hostname} could not be resolved (${e.message})` }) as const,
  );
  if ('blocked' in pre) return { blocked: pre.blocked };
  const servername = current.hostname.replace(/^\[|\]$/g, '');
  const secure = current.protocol === 'https:';
  let socket: Socket;
  try {
    socket = await connectChecked(servername, port, pre.addresses, policy, {
      ...(opts.deps ? { deps: opts.deps } : {}),
      timeoutMs: opts.timeoutMs,
      tunnelTimeoutMs: opts.timeoutMs,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.message.startsWith('upstream proxy:'))
      return { failed: 'the upstream proxy did not open a tunnel' };
    return { failed: err.code ?? err.message };
  }
  return new Promise<Hop>((resolve) => {
    const mod = secure ? https : http;
    const req = mod.request(
      current,
      {
        method: opts.method,
        headers: opts.headers,
        timeout: opts.timeoutMs,
        // The connection is already open to a checked address (or a tunnel to one): no lookup, no agent.
        createConnection: () => {
          socket.resume();
          return secure
            ? tls.connect({ socket, host: servername, ...(isIP(servername) ? {} : { servername }) })
            : socket;
        },
      },
      (r) => {
        const status = r.statusCode ?? 0;
        const max = opts.maxBytes ?? 2_000_000;
        let size = 0;
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= max) chunks.push(c);
          else r.destroy();
        });
        const done = () =>
          resolve({ status, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') });
        r.on('end', done);
        r.on('close', done);
        r.on('error', () => resolve({ failed: 'the response was interrupted' }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timed out after ${opts.timeoutMs} ms`)));
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ failed: e.code ?? e.message }));
    req.end(opts.body);
  });
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
  const headers = { 'user-agent': opts.userAgent, accept: 'text/plain, application/xml, text/xml, */*' };
  for (let hop = 0; hop < 6; hop++) {
    if (current.origin !== origin) return null;
    const res = await guardedHop(current, policy, { ...opts, method: 'GET', headers });
    if (!('status' in res)) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      try {
        current = new URL(res.headers.location, current);
      } catch {
        return null;
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) return null;
    return res.body;
  }
  return null;
}

/**
 * A `fetch` for Jourilo's own API calls (the read-only analytics adapters) under the same address policy and upstream
 * proxy as every other outbound request. GET follows at most five redirects, only on the same origin, so headers such
 * as Authorization never reach another host; any other method returns a redirect as it is. A destination the policy
 * refuses throws GuardBlockedError; a connection that fails throws an Error naming the cause, never the headers.
 */
export async function guardedFetch(
  url: string,
  policy: AddressPolicy,
  opts: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    maxBytes?: number;
    deps?: GuardDeps;
  },
): Promise<Response> {
  const method = opts.method ?? 'GET';
  const origin = new URL(url).origin;
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop++) {
    if (current.origin !== origin)
      throw new GuardBlockedError(
        `${origin} redirected to another origin (${current.origin}); not followed.`,
      );
    const res = await guardedHop(current, policy, {
      method,
      headers: opts.headers ?? {},
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      timeoutMs: opts.timeoutMs,
      ...(opts.maxBytes !== undefined ? { maxBytes: opts.maxBytes } : {}),
      ...(opts.deps ? { deps: opts.deps } : {}),
    });
    if ('blocked' in res) throw new GuardBlockedError(res.blocked);
    if ('failed' in res) throw new Error(`${current.host}: ${res.failed}`);
    if (method === 'GET' && res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, current);
      continue;
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(res.headers)) {
      if (v === undefined) continue;
      for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    }
    const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
    const empty = status === 204 || status === 205 || status === 304;
    return new Response(empty ? null : res.body, { status, headers });
  }
  throw new Error(`${origin}: too many redirects`);
}
