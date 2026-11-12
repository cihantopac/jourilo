// Target validation and the network address policy. Jourilo only opens http(s) pages, keeps crawling on the target
// origin, and refuses private-network addresses unless the user explicitly targets a local development host or opts
// in. The same policy is enforced for every browser request by the network guard (core/net-guard.ts).
import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { JouriloError } from './errors.js';

export type HostClass = 'local' | 'private' | 'public';

/**
 * What an IP address reaches. `loopback` includes the unspecified address (0.0.0.0 and :: connect to the local
 * machine on Linux and macOS); `metadata` are cloud instance-metadata endpoints; `reserved` covers documentation,
 * benchmarking, multicast and other special-purpose ranges that a public web page never legitimately uses.
 */
export type AddressClass = 'public' | 'loopback' | 'private' | 'link-local' | 'metadata' | 'reserved';

const LOCAL_SUFFIXES = ['.localhost', '.test'];

export function isLocalHostname(host: string): boolean {
  const h = host
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  return (
    h === 'localhost' ||
    h === '::1' ||
    /^127\.\d+\.\d+\.\d+$/.test(h) ||
    h === '0.0.0.0' ||
    LOCAL_SUFFIXES.some((s) => h.endsWith(s))
  );
}

const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '169.254.169.123', '100.100.100.200']);

function classifyV4(v: string): AddressClass {
  const [a, b, c, d] = v.split('.').map(Number) as [number, number, number, number];
  if (METADATA_V4.has(`${a}.${b}.${c}.${d}`)) return 'metadata';
  if (a === 0) return b === 0 && c === 0 && d === 0 ? 'loopback' : 'reserved';
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // carrier-grade NAT, often internal
  if (a === 169 && b === 254) return 'link-local';
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return 'reserved';
  if (a === 192 && b === 88 && c === 99) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved'; // benchmarking, used for internal networks
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 224) return 'reserved'; // multicast, 240/4, broadcast
  return 'public';
}

/** Expands an IPv6 address (with optional embedded IPv4 and zone id) into eight 16-bit groups. */
function v6Groups(v: string): number[] | null {
  let s = v.split('%')[0]!;
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const p = tail[1]!.split('.').map(Number) as [number, number, number, number];
    s = `${s.slice(0, -tail[1]!.length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (h: string) => (h ? h.split(':').map((g) => Number.parseInt(g, 16)) : []);
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const groups = [...head, ...Array(fill).fill(0), ...rest];
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function classifyV6(v: string): AddressClass {
  const g = v6Groups(v);
  if (!g) return 'reserved';
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const zeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroTo(8)) return 'loopback'; // ::
  if (zeroTo(7) && g7 === 1) return 'loopback'; // ::1
  if (zeroTo(5) && g5 === 0xffff) return classifyV4(v4From(g6, g7)); // ::ffff:a.b.c.d
  if (zeroTo(6)) return classifyV4(v4From(g6, g7)); // ::a.b.c.d (deprecated IPv4-compatible)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return classifyV4(v4From(g6, g7)); // NAT64 64:ff9b::/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return 'private'; // local-use NAT64
  if (g0 === 0x2002) return classifyV4(v4From(g1, g2)); // 6to4
  if (g0 === 0x2001 && g1 === 0) return 'reserved'; // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return 'reserved'; // documentation
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return 'reserved'; // discard
  if (g0 === 0xfd00 && g1 === 0xec2 && g2 + g3 + g4 + g5 + g6 === 0 && g7 === 0x254) return 'metadata'; // AWS IMDS over IPv6
  if ((g0 & 0xfe00) === 0xfc00) return 'private'; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return 'link-local';
  if ((g0 & 0xffc0) === 0xfec0) return 'private'; // deprecated site-local
  if ((g0 & 0xff00) === 0xff00) return 'reserved'; // multicast
  return 'public';
}

export function classifyIp(ip: string): AddressClass {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const family = isIP(v.split('%')[0]!);
  if (family === 4) return classifyV4(v);
  if (family === 6) return classifyV6(v);
  return 'reserved';
}

/** True for every address that is not on the public internet. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '');
  return isIP(v.split('%')[0]!) !== 0 && classifyIp(v) !== 'public';
}

export interface AddressPolicy {
  /** Class of the audited target: local targets may reach loopback services. */
  target: HostClass;
  /** The user passed --allow-private (authorized to test private-network hosts). */
  allowPrivate: boolean;
  /** The user passed --deny-local: loopback and local names are refused, also as a redirect or subresource. */
  denyLocal?: boolean;
  /** With denyLocal: the only loopback ports that stay reachable (Jourilo's own static server for a directory target). */
  allowLoopbackPorts?: number[];
  /** `--allow-hosts`: only these hosts (and the target's own host, see `hostListsFor`) may be reached. */
  allowHosts?: string[];
  /** `--block-hosts`: these hosts are refused by name, before any lookup. */
  blockHosts?: string[];
  /**
   * `--proxy` / `HTTPS_PROXY`: the guard checks every destination first, then opens a CONNECT tunnel through this
   * proxy to the checked address. `auth` is `user:password` and is never written anywhere.
   */
  upstream?: Upstream;
}

/** An upstream HTTP proxy (`http://[user:password@]host:port`). */
export interface Upstream {
  host: string;
  port: number;
  auth?: string;
}

/** The proxy as recorded in a run: scheme, host and port, never the credentials. */
export function upstreamLabel(up: Upstream): string {
  return `http://${isIP(up.host) === 6 ? `[${up.host}]` : up.host}:${up.port}`;
}

const normalizeHost = (h: string) =>
  h
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');

/** `pattern` is a host name (exact match) or `*.suffix` (any subdomain of suffix, not suffix itself). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/** Whether `--allow-hosts` / `--block-hosts` let the browser (or Jourilo) reach this host name. */
export function hostVerdict(
  host: string,
  policy: AddressPolicy,
): { ok: true } | { ok: false; reason: string } {
  const h = normalizeHost(host);
  const blocked = policy.blockHosts?.find((p) => hostMatches(h, p));
  if (blocked) return { ok: false, reason: `${h} is blocked by --block-hosts (${blocked}).` };
  if (policy.allowHosts?.length && !policy.allowHosts.some((p) => hostMatches(h, p)))
    return { ok: false, reason: `${h} is not in --allow-hosts.` };
  return { ok: true };
}

/**
 * The host lists of a run's policy. The target's own host is always allowed, so `--allow-hosts` names only the
 * third-party hosts to keep; a block list that matches the target itself is a usage error.
 */
export function hostListsFor(
  target: URL,
  allowHosts: string[],
  blockHosts: string[],
): Pick<AddressPolicy, 'allowHosts' | 'blockHosts'> {
  const own = normalizeHost(target.hostname);
  const hit = blockHosts.find((p) => hostMatches(own, p));
  if (hit)
    throw new JouriloError(
      'USAGE',
      `--block-hosts ${hit} blocks the target itself (${own}).`,
      'Remove that pattern, or audit another target.',
    );
  return {
    ...(allowHosts.length ? { allowHosts: [...new Set([...allowHosts, own])] } : {}),
    ...(blockHosts.length ? { blockHosts } : {}),
  };
}

/**
 * Whether NO_PROXY lets `host` bypass the proxy. The common convention: comma- (or space-) separated entries, each a
 * host name or suffix (`example.com`, `.example.com` and `*.example.com` all match example.com and its subdomains),
 * an IP address (exact), optionally with `:port`; `*` alone matches every host. CIDR ranges are not supported.
 */
export function noProxyMatches(host: string, port: number, noProxy: string): boolean {
  const h = normalizeHost(host);
  for (const raw of noProxy.split(/[\s,]+/)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === '*') return true;
    if (isIP(entry)) {
      if (h === entry) return true;
      continue;
    }
    const m = entry.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!m) continue;
    if (m[2] && Number(m[2]) !== port) continue;
    const name = normalizeHost(m[1]!).replace(/^\*?\./, '');
    if (h === name || h.endsWith(`.${name}`)) return true;
  }
  return false;
}

/** Whether the browser (or Jourilo itself) may connect to this address while auditing a target. */
export function addressVerdict(
  ip: string,
  policy: AddressPolicy,
  port?: number,
): { ok: true } | { ok: false; reason: string } {
  const cls = classifyIp(ip);
  switch (cls) {
    case 'public':
      return { ok: true };
    case 'metadata':
      return {
        ok: false,
        reason: `${ip} is a cloud instance-metadata endpoint; Jourilo never connects to it.`,
      };
    case 'reserved':
      return { ok: false, reason: `${ip} is a reserved or special-purpose address.` };
    case 'loopback':
      if (
        policy.denyLocal &&
        !(port !== undefined && policy.allowLoopbackPorts?.includes(port) && ip === '127.0.0.1')
      )
        return { ok: false, reason: `${ip} is this machine (loopback) and --deny-local is set.` };
      return policy.target === 'local' || policy.allowPrivate
        ? { ok: true }
        : { ok: false, reason: `${ip} is this machine (loopback); a public target may not reach it.` };
    default:
      return policy.allowPrivate
        ? { ok: true }
        : {
            ok: false,
            reason: `${ip} is a ${cls} network address; pass --allow-private if you are authorized.`,
          };
  }
}

export function parseTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new JouriloError('INVALID_INPUT', `Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new JouriloError('UNSAFE_URL', `Only http and https URLs are supported (got ${url.protocol}).`);
  }
  url.hash = '';
  return url;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;

export const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

/** How long a name may take to resolve before it counts as unresolvable. */
export const RESOLVE_TIMEOUT_MS = 5000;

/** Rejects when `work` takes longer than `ms`; the timer never keeps the process alive. */
export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** The resolver answered that the name does not exist (or the lookup ran out of time). */
export class LookupFailed extends Error {}

type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; encoding: 'utf8'; env: NodeJS.ProcessEnv },
  callback: (err: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string) => void,
) => unknown;

/**
 * Resolves a name in a short-lived child process. The system resolver cannot be cancelled: a lookup abandoned in this
 * process keeps the process alive (and even `process.exit`) until the resolver's own timeout, often 30 s. A child
 * that outlives the limit is simply killed.
 *
 * The host reaches the child only as data, through an environment variable, so it can never be parsed as a Node
 * option. Only a lookup error reported by the child, or the timeout kill, rejects with `LookupFailed`; any other
 * failure (spawn error, crash) resolves to no answers so the caller fails open and lets the browser decide.
 */
export function resolveInChild(
  host: string,
  ms: number,
  exec: ExecFileFn = execFile as unknown as ExecFileFn,
): Promise<{ address: string; family: number }[]> {
  const script =
    "require('node:dns').lookup(process.env.JOURILO_RESOLVE_HOST,{all:true,verbatim:true},(e,a)=>{if(e)process.exit(2);process.stdout.write(JSON.stringify(a),()=>process.exit(0))})";
  const env = { ...process.env, NODE_OPTIONS: '', JOURILO_RESOLVE_HOST: host };
  return new Promise((resolve, reject) => {
    try {
      exec(process.execPath, ['-e', script], { timeout: ms, encoding: 'utf8', env }, (err, stdout) => {
        if (err) {
          if (err.killed || err.code === 2) return reject(new LookupFailed(`DNS lookup failed for ${host}`));
          return resolve([]);
        }
        try {
          resolve(JSON.parse(stdout) as { address: string; family: number }[]);
        } catch {
          resolve([]);
        }
      });
    } catch {
      resolve([]);
    }
  });
}

export interface UrlCheckOptions {
  allowPrivate?: boolean;
  /** Skip DNS resolution (tests, offline). */
  resolveDns?: boolean;
  /** DNS resolver (tests inject answers). */
  resolver?: Resolver;
  /** Time limit for resolving a local name (default 5 s; tests shorten it). */
  resolveTimeoutMs?: number;
  /** Look a local name up (only the audit engine needs the answer). Default true; `checkTarget` turns it off. */
  resolveLocalNames?: boolean;
  /** Refuse local targets (loopback, `localhost`, `*.localhost`, `*.test`) before any lookup. */
  denyLocal?: boolean;
}

export interface TargetCheck {
  hostClass: HostClass;
  /** A local name (not `.localhost`) that did not resolve: nothing can be loaded from it. */
  unresolved?: true;
}

const DENY_LOCAL_HINT =
  'Unset --deny-local / JOURILO_DENY_LOCAL to audit a local development server, or pass a public URL.';

const PRIVATE_HINT = 'Pass --allow-private if you are authorized to test this host.';

/**
 * Classifies a target and throws for targets the user did not opt into. A host name is refused when any of its DNS
 * answers is non-public: a mixed answer is how DNS-rebinding attacks start, and the browser may pick any address.
 * Metadata and reserved addresses are refused even with --allow-private.
 */
export async function checkTarget(url: URL, opts: UrlCheckOptions = {}): Promise<HostClass> {
  return (await checkTargetDetailed(url, { ...opts, resolveLocalNames: false })).hostClass;
}

/** `checkTarget` plus whether a local name failed to resolve (the audit then skips the browser). */
export async function checkTargetDetailed(url: URL, opts: UrlCheckOptions = {}): Promise<TargetCheck> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host) !== 0;
  if (opts.denyLocal && (isLocalHostname(host) || (literal && classifyIp(host) === 'loopback')))
    throw new JouriloError(
      'UNSAFE_URL',
      `${host} is a local address and --deny-local is set.`,
      DENY_LOCAL_HINT,
    );
  if (literal) {
    const cls = classifyIp(host);
    if (cls === 'metadata' || (cls === 'reserved' && host !== '0.0.0.0'))
      throw new JouriloError('UNSAFE_URL', `${host} is a ${cls} address; Jourilo does not audit it.`);
    if (cls === 'loopback') return { hostClass: 'local' };
    if (cls === 'public') return { hostClass: 'public' };
    if (!opts.allowPrivate)
      throw new JouriloError('UNSAFE_URL', `${host} is a private network address.`, PRIVATE_HINT);
    return { hostClass: 'private' };
  }
  if (isLocalHostname(host)) {
    // `.localhost` resolves to loopback by specification. Any other local name (such as `.test`) needs a hosts entry
    // or a local resolver; without one the browser would wait out its whole navigation timeout.
    const h = host.toLowerCase();
    const needsLookup = LOCAL_SUFFIXES.some((x) => x !== '.localhost' && h.endsWith(x));
    if (opts.resolveDns === false || opts.resolveLocalNames === false || !needsLookup)
      return { hostClass: 'local' };
    try {
      const limit = opts.resolveTimeoutMs ?? RESOLVE_TIMEOUT_MS;
      await withTimeout(
        opts.resolver ? opts.resolver(host) : resolveInChild(host, limit),
        limit,
        `DNS lookup failed for ${host} (timed out)`,
      );
    } catch {
      return { hostClass: 'local', unresolved: true };
    }
    return { hostClass: 'local' };
  }
  if (opts.resolveDns === false) return { hostClass: 'public' };
  let addrs: { address: string }[];
  try {
    addrs = await (opts.resolver ?? systemResolver)(host);
  } catch {
    // DNS failure is reported later by the browser as a navigation error, with evidence.
    return { hostClass: 'public' };
  }
  const classes = addrs.map((a) => ({ address: a.address, cls: classifyIp(a.address) }));
  const forbidden = classes.find((c) => c.cls === 'metadata' || c.cls === 'reserved');
  if (forbidden)
    throw new JouriloError(
      'UNSAFE_URL',
      `${host} resolves to ${forbidden.address}, a ${forbidden.cls} address; Jourilo does not audit it.`,
    );
  if (opts.denyLocal) {
    const loop = classes.find((c) => c.cls === 'loopback');
    if (loop)
      throw new JouriloError(
        'UNSAFE_URL',
        `${host} resolves to ${loop.address}, a local address, and --deny-local is set.`,
        DENY_LOCAL_HINT,
      );
  }
  const nonPublic = classes.filter((c) => c.cls !== 'public');
  if (!nonPublic.length) return { hostClass: 'public' };
  if (!opts.allowPrivate) {
    const mixed = nonPublic.length < classes.length;
    throw new JouriloError(
      'UNSAFE_URL',
      mixed
        ? `${host} resolves to both public and private addresses (${nonPublic.map((c) => c.address).join(', ')}); this is refused because the browser could connect to either (DNS rebinding).`
        : `${host} resolves to a private network address (${nonPublic[0]!.address}).`,
      PRIVATE_HINT,
    );
  }
  return { hostClass: 'private' };
}

/** Same origin, http(s) only, no obvious logout / destructive GET endpoints. */
export function isCrawlable(candidate: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return false;
  }
  if (u.origin !== origin) return false;
  if (/\/(log-?out|sign-?out|logoff|delete|destroy|remove|unsubscribe|cancel)(\/|$|\?)/i.test(u.pathname))
    return false;
  if (
    /\.(pdf|zip|gz|dmg|exe|msi|png|jpe?g|gif|webp|svg|mp4|mp3|woff2?|ttf|ico|xml|json|txt|csv)$/i.test(
      u.pathname,
    )
  )
    return false;
  return true;
}

export function normalizeForCrawl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  for (const k of [...u.searchParams.keys()])
    if (/^utm_|^(fbclid|gclid|ref)$/i.test(k)) u.searchParams.delete(k);
  return u.toString();
}

/** The identity of a crawl URL: `/a` and `/a/` are one page. Used only to deduplicate; never to rewrite a URL. */
export function crawlKey(url: string): string {
  const u = new URL(normalizeForCrawl(url));
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}
