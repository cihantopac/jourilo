// Target validation and the network address policy. Jourilo only opens http(s) pages, keeps crawling on the target
// origin, and refuses private-network addresses unless the user explicitly targets a local development host or opts
// in. The same policy is enforced for every browser request by the network guard (core/net-guard.ts).
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
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
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
}

/** Whether the browser (or Jourilo itself) may connect to this address while auditing a target. */
export function addressVerdict(
  ip: string,
  policy: AddressPolicy,
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

export interface UrlCheckOptions {
  allowPrivate?: boolean;
  /** Skip DNS resolution (tests, offline). */
  resolveDns?: boolean;
  /** DNS resolver (tests inject answers). */
  resolver?: Resolver;
}

const PRIVATE_HINT = 'Pass --allow-private if you are authorized to test this host.';

/**
 * Classifies a target and throws for targets the user did not opt into. A host name is refused when any of its DNS
 * answers is non-public: a mixed answer is how DNS-rebinding attacks start, and the browser may pick any address.
 * Metadata and reserved addresses are refused even with --allow-private.
 */
export async function checkTarget(url: URL, opts: UrlCheckOptions = {}): Promise<HostClass> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(host) !== 0;
  if (literal) {
    const cls = classifyIp(host);
    if (cls === 'metadata' || (cls === 'reserved' && host !== '0.0.0.0'))
      throw new JouriloError('UNSAFE_URL', `${host} is a ${cls} address; Jourilo does not audit it.`);
    if (cls === 'loopback') return 'local';
    if (cls === 'public') return 'public';
    if (!opts.allowPrivate)
      throw new JouriloError('UNSAFE_URL', `${host} is a private network address.`, PRIVATE_HINT);
    return 'private';
  }
  if (isLocalHostname(host)) return 'local';
  if (opts.resolveDns === false) return 'public';
  let addrs: { address: string }[];
  try {
    addrs = await (opts.resolver ?? systemResolver)(host);
  } catch {
    // DNS failure is reported later by the browser as a navigation error, with evidence.
    return 'public';
  }
  const classes = addrs.map((a) => ({ address: a.address, cls: classifyIp(a.address) }));
  const forbidden = classes.find((c) => c.cls === 'metadata' || c.cls === 'reserved');
  if (forbidden)
    throw new JouriloError(
      'UNSAFE_URL',
      `${host} resolves to ${forbidden.address}, a ${forbidden.cls} address; Jourilo does not audit it.`,
    );
  const nonPublic = classes.filter((c) => c.cls !== 'public');
  if (!nonPublic.length) return 'public';
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
  return 'private';
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
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}
