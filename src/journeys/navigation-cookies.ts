// Cookies for the top-level navigations the request guard makes itself (`route.fetch`). Playwright's fetch takes every
// cookie of the context that matches domain, path and Secure, and ignores SameSite. A browser does not: it withholds
// Strict cookies from a navigation a cross-site page started, and Lax cookies from a cross-site POST. Sending them
// would let a cross-site sign-in flow pass where real users fail, so the guard builds the Cookie header itself.
//
// Where the browser's decision cannot be reproduced exactly, the cookie is withheld (fail closed): the journey may
// fail where a browser would succeed, never the other way round.
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
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/**
 * The cookies a browser sends with a top-level navigation. Strict: same-site only. Lax: same-site, or a cross-site
 * GET/HEAD. None: in Chromium only when Secure (it never stores another); Firefox and WebKit report a cookie without a
 * SameSite attribute as None and send it.
 */
export function navigationCookies(
  jar: readonly JarCookie[],
  sameSite: boolean,
  method: string,
  browser: string,
): JarCookie[] {
  const safe = method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';
  return jar.filter((c) =>
    c.sameSite === 'Strict'
      ? sameSite
      : c.sameSite === 'Lax'
        ? sameSite || safe
        : c.secure || browser !== 'chromium',
  );
}
