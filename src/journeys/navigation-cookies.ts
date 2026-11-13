// Cookies for the top-level navigations the request guard makes itself (`route.fetch`). Playwright's fetch takes every
// cookie of the context that matches domain, path and Secure, and ignores SameSite. A browser does not: it withholds
// Strict cookies from a navigation a cross-site page started, and Lax cookies from a cross-site POST. Sending them
// would let a cross-site sign-in flow pass where real users fail, so the guard builds the Cookie header itself.
//
// Where the browser's decision cannot be reproduced exactly, the cookie is withheld (fail closed), with one known
// exception: in Chromium, a navigation another window or frame started without a Referer is judged by the frame's
// document, which may count it as same-site where the browser would not.
//
// Which cookies match a URL follows RFC 6265 (`cookieMatchesUrl`), not Playwright's `context.cookies(url)` filter,
// which is looser: it sends a host-only cookie to subdomains and a `Path=/app` cookie to `/application`.
//  - "Same site" needs the public suffix list. The browser's own verdict is used when it gives one (Sec-Fetch-Site on
//    the first hop, Firefox and WebKit); otherwise two different host names count as cross-site, even subdomains of
//    one site.
//  - Chromium's two-minute "Lax + POST" allowance for cookies without a SameSite attribute is not reproduced.

/** Who started a navigation chain. */
export type Initiator =
  /** The address bar, a bookmark, history: page.goto and goBack. Always same-site. */
  | { kind: 'browser' }
  /** A page on this origin (a link, a form, a script, an opener). */
  | { kind: 'site'; origin: string }
  /** Unknown (an opaque or unknown document): treated as cross-site. */
  | { kind: 'opaque' };

/**
 * Whether a navigation to `url` is same-site for cookies. `fetchSite` is the browser's own Sec-Fetch-Site header, valid
 * only for the first request of a chain (later hops are Jourilo's own hand-over navigations).
 */
export function isSameSiteNavigation(initiator: Initiator, url: string, fetchSite?: string): boolean {
  if (initiator.kind === 'browser' || fetchSite === 'none') return true;
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') return true;
  if (fetchSite === 'cross-site') return false;
  if (initiator.kind === 'opaque') return false;
  try {
    const a = new URL(initiator.origin);
    const b = new URL(url);
    // Schemeful same-site, approximated by the host name (see the header comment).
    return a.protocol === b.protocol && a.hostname === b.hostname;
  } catch {
    return false;
  }
}

export interface JarCookie {
  name: string;
  value: string;
  /** Playwright's form: a leading dot for a Domain cookie, none for a host-only cookie. */
  domain: string;
  path: string;
  /** Seconds since the epoch; -1 for a session cookie. */
  expires: number;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

const isIpLiteral = (host: string) =>
  /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') || host.includes(':');

/** RFC 6265 §5.1.4 path-match. */
export function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/**
 * Whether a browser sends the cookie to `url` (RFC 6265 §5.4): host-only cookies to their exact host, Domain cookies
 * to the domain and its subdomains (never by suffix on an IP address), path-match, Secure only over https (or to
 * localhost, which browsers treat as secure), and not expired.
 */
export function cookieMatchesUrl(c: JarCookie, url: string, now = Date.now()): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const hostOnly = !c.domain.startsWith('.');
  const domain = c.domain.replace(/^\./, '').toLowerCase();
  const domainOk = hostOnly
    ? host === domain
    : host === domain || (host.endsWith(`.${domain}`) && !isIpLiteral(host));
  if (!domainOk) return false;
  if (!pathMatches(u.pathname || '/', c.path || '/')) return false;
  if (
    c.secure &&
    u.protocol !== 'https:' &&
    host !== 'localhost' &&
    !host.endsWith('.localhost') &&
    host !== '127.0.0.1' &&
    host !== '[::1]'
  )
    return false;
  return c.expires === -1 || c.expires * 1000 > now;
}

/**
 * The cookies a browser sends with a top-level navigation. Strict: same-site only. Lax: same-site, or a cross-site
 * GET/HEAD. None: in Chromium only when Secure (it never stores another); Firefox and WebKit report a cookie without a
 * SameSite attribute as None and send it.
 */
export function navigationCookies(
  jar: readonly JarCookie[],
  url: string,
  sameSite: boolean,
  method: string,
  browser: string,
): JarCookie[] {
  const safe = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
  return jar.filter((c) =>
    !cookieMatchesUrl(c, url)
      ? false
      : c.sameSite === 'Strict'
        ? sameSite
        : c.sameSite === 'Lax'
          ? sameSite || safe
          : c.secure || browser !== 'chromium',
  );
}
