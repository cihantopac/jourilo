// Target validation. Jourilo only opens http(s) pages, keeps crawling on the target origin, and refuses
// private-network addresses unless the user explicitly targets a local development host or opts in.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { JouriloError } from './errors.js';

export type HostClass = 'local' | 'private' | 'public';

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

export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(v) === 6) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]!) : false;
  }
  return false;
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

export interface UrlCheckOptions {
  allowPrivate?: boolean;
  /** Skip DNS resolution (tests, offline). */
  resolveDns?: boolean;
}

/** Classifies a target and throws for private-network targets the user did not opt into. */
export async function checkTarget(url: URL, opts: UrlCheckOptions = {}): Promise<HostClass> {
  const host = url.hostname;
  if (isLocalHostname(host)) return 'local';
  if (isPrivateIp(host)) {
    if (!opts.allowPrivate) {
      throw new JouriloError(
        'UNSAFE_URL',
        `${host} is a private network address.`,
        'Pass --allow-private if you are authorized to test this host.',
      );
    }
    return 'private';
  }
  if (opts.resolveDns !== false && isIP(host) === 0) {
    try {
      const addrs = await lookup(host, { all: true });
      if (addrs.length && addrs.every((a) => isPrivateIp(a.address)) && !opts.allowPrivate) {
        throw new JouriloError(
          'UNSAFE_URL',
          `${host} resolves to a private network address.`,
          'Pass --allow-private if you are authorized to test this host.',
        );
      }
      if (addrs.some((a) => isPrivateIp(a.address))) return 'private';
    } catch (err) {
      if (err instanceof JouriloError) throw err;
      // DNS failure is reported later by the browser as a navigation error, with evidence.
    }
  }
  return 'public';
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
