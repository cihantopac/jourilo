// `--extra-header`: headers sent only with requests to the target's origin, never to another origin (F16).
//
// `route.fallback({ headers })` is not enough: Playwright applies overridden headers to every hop of a redirect
// chain, so a request to the target that redirects to another origin would carry them there. Instead, Jourilo makes
// each request to the target's origin itself (`route.fetch`, through the browser's proxy, so the network guard
// still checks it) without following redirects, and hands the response to the browser. A redirect is followed by the
// browser as a new request, which Playwright does not route again, so it goes without the headers.
import type { BrowserContext, Route } from 'playwright-core';
import { GUARD_UPSTREAM_ERROR_HEADER } from '../core/net-guard.js';
import { redactUrl } from '../core/redact.js';

export interface TargetHeaders {
  /** Only requests to this origin carry the headers. */
  origin: string;
  /** Header values may be credentials: never logged, reported or stored. */
  headers: Record<string, string>;
  /** Filled while browsing: redirects within the origin that the browser followed without the headers (redacted). */
  redirects: Set<string>;
  /**
   * Token of the network guard the browser goes through, set once the guard runs. A failed CONNECT reaches
   * `route.fetch` as an HTTP response (Playwright replays the proxy's reply); the token tells it apart from a page.
   */
  guardToken?: string;
}

export function targetHeaders(origin: string, headers: Record<string, string>): TargetHeaders {
  return { origin, headers, redirects: new Set() };
}

function safeUrl(url: string, base?: string): URL | undefined {
  try {
    return new URL(url, base);
  } catch {
    return undefined;
  }
}

/**
 * Registers the header route on a new context, before any other route, so every route registered later (the
 * read-only request guard) runs first and falls back to this one. Errors are swallowed without a trace: Playwright's
 * fetch errors list the request headers, values included.
 */
export async function sendTargetHeaders(
  ctx: BrowserContext,
  scope: TargetHeaders,
  timeoutMs: number,
): Promise<void> {
  const names = new Set(Object.keys(scope.headers).map((n) => n.toLowerCase()));
  await ctx.route('**/*', async (route: Route) => {
    const req = route.request();
    if (safeUrl(req.url())?.origin !== scope.origin) return route.fallback();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers())) if (!names.has(k.toLowerCase())) headers[k] = v;
    Object.assign(headers, scope.headers);
    try {
      const response = await route.fetch({ headers, maxRedirects: 0, timeout: timeoutMs });
      const status = response.status();
      // The guard's reply to a failed CONNECT (refused destination, DNS or connection failure) is not the site's page:
      // it fails as it does in the browser without --extra-header. Plain HTTP keeps the guard's 502, which the
      // capture recognises by the same token.
      const signal = response.headers()[GUARD_UPSTREAM_ERROR_HEADER];
      if (
        scope.guardToken &&
        signal?.startsWith(`${scope.guardToken} `) &&
        safeUrl(req.url())?.protocol === 'https:'
      ) {
        await response.dispose().catch(() => undefined);
        await route.abort(status === 403 ? 'blockedbyclient' : 'connectionfailed');
        return;
      }
      const location = response.headers().location;
      const next = status >= 300 && status < 400 && location ? safeUrl(location, req.url()) : undefined;
      if (next?.origin === scope.origin && scope.redirects.size < 100)
        scope.redirects.add(`${redactUrl(req.url())} → ${redactUrl(next.toString())}`);
      // WebKit cannot be handed a redirect (Playwright refuses); the request then fails like a network error.
      await route.fulfill({ response });
    } catch {
      await route.abort('failed').catch(() => undefined);
    }
  });
}

/** Limitation lines of a run that ignored certificate errors or sent extra headers. */
export function requestLimitations(opts: {
  ignoreHttpsErrors?: boolean;
  headers?: TargetHeaders;
  /** The run used --throttle. */
  throttled?: boolean;
}): string[] {
  const out: string[] = [];
  if (opts.ignoreHttpsErrors)
    out.push(
      'Certificate errors were ignored (--ignore-https-errors): the browser accepted invalid, expired or self-signed certificates, so certificate problems of the site were not reported. The network guard still checked every destination.',
    );
  const h = opts.headers;
  if (h) {
    out.push(
      `Extra headers (${Object.keys(h.headers).join(', ')}) were sent only with requests to ${h.origin}, never to other origins. Jourilo made those requests itself, so the headers could not follow a redirect elsewhere; their lab timings include that step.`,
    );
    if (opts.throttled)
      out.push(
        `With --throttle and --extra-header, responses from ${h.origin} that Jourilo fetched itself and handed to the browser were not throttled (the CPU slowdown still applied): their lab timings are faster than a throttled network would give.`,
      );
    const hops = [...h.redirects];
    if (hops.length)
      out.push(
        `${hops.length} redirect(s) within ${h.origin} were followed without the extra headers (${hops.slice(0, 3).join('; ')}${hops.length > 3 ? '; …' : ''}); a page that needs them is best audited at its final URL.`,
      );
  }
  return out;
}
