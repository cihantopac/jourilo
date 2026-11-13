// Installs the request-level safety backstop (journeys/safety.ts `checkRequest`) on a page or context. Whatever
// triggers a request while Jourilo interacts with a page, a request the policy forbids is aborted before it leaves
// the browser and recorded, so the step that caused it is reported as blocked and its failure is not mistaken for a
// defect of the site.
//
// Redirects (`checkRedirects`, journeys): Playwright routes only the first URL of a redirect chain; the browser follows
// the later hops without asking. So a top-level navigation is made by Jourilo itself (`route.fetch`, through the
// browser's proxy, so the network guard still checks the address) without following redirects. A redirect's target is
// judged like a navigation before anything is sent to it; if it is allowed, the browser is handed a page that
// navigates there (`location.replace`), which is a new navigation and comes back through this route. No hop of a
// chain reaches an origin or URL the policy forbids. Cookies a redirect sets are kept: `route.fetch` stores them in the
// browser context.
import type { APIResponse, BrowserContext, Page, Request, Route } from 'playwright-core';
import type { TargetHeaders } from '../browser/target-headers.js';
import { GUARD_UPSTREAM_ERROR_HEADER } from '../core/net-guard.js';
import { redactUrl } from '../core/redact.js';
import { type BlockKind, checkRequest, type RequestPolicy, type SafetyVerdict } from './safety.js';

export interface BlockedRequest {
  url: string;
  method: string;
  reason: string;
  kind: BlockKind;
  /** A document load (navigation or form submission) rather than a background request. */
  navigation: boolean;
  at: number;
}

export interface RequestGuard {
  blocked: BlockedRequest[];
  /** Raw URLs that were aborted (to discount the failures they cause). */
  isBlocked(url: string): boolean;
  /** Blocked requests since a point in time (Date.now()). */
  since(t: number): BlockedRequest[];
  detach(): Promise<void>;
}

export interface RequestGuardOptions {
  /** Judge every hop of a top-level navigation's redirect chain before it is sent (journeys). */
  checkRedirects?: boolean;
  /** `--extra-header`: the navigations this guard makes itself carry them to the target's origin only. */
  targetHeaders?: TargetHeaders;
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** The page handed to the browser in place of an allowed redirect: it navigates on, as a new, routed navigation. */
function onwardPage(next: URL, method: string, body: string | null, contentType: string): string | null {
  const target = JSON.stringify(next.toString()).replace(/</g, '\\u003c');
  if (method === 'GET' || method === 'HEAD')
    return `<!doctype html><meta charset="utf-8"><title>Redirecting</title><script>location.replace(${target})</script>`;
  // 307/308 resend the form; only a URL-encoded form can be rebuilt faithfully.
  if (!/^application\/x-www-form-urlencoded/i.test(contentType)) return null;
  const esc = (v: string) =>
    v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fields = [...new URLSearchParams(body ?? '')]
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Redirecting</title><form method="post" action="${esc(next.toString())}">${fields}</form><script>document.forms[0].submit()</script>`;
}

function isMainFrame(req: Request): boolean {
  try {
    return req.frame().parentFrame() === null;
  } catch {
    // Requests without a frame (service workers are blocked anyway).
    return req.isNavigationRequest();
  }
}

function frameUrl(req: Request): string | undefined {
  try {
    return req.frame().url();
  } catch {
    return undefined;
  }
}

export async function installRequestGuard(
  target: BrowserContext | Page,
  policy: RequestPolicy,
  options: RequestGuardOptions = {},
): Promise<RequestGuard> {
  const blocked: BlockedRequest[] = [];
  const urls = new Set<string>();
  const block = async (
    route: Route,
    url: string,
    method: string,
    navigation: boolean,
    verdict: SafetyVerdict,
  ) => {
    if (verdict.allowed) return;
    if (blocked.length < 200)
      blocked.push({
        url: redactUrl(url),
        method,
        reason: verdict.reason,
        kind: verdict.kind ?? 'submit',
        navigation,
        at: Date.now(),
      });
    urls.add(url);
    urls.add(route.request().url());
    await route.abort('blockedbyclient').catch(() => undefined);
  };

  /** Makes a top-level navigation without following redirects; judges and hands on each redirect. */
  const navigate = async (route: Route, req: Request) => {
    const scope = options.targetHeaders;
    let response: APIResponse;
    try {
      const own = scope && new URL(req.url()).origin === scope.origin;
      if (own) {
        const names = new Set(Object.keys(scope.headers).map((n) => n.toLowerCase()));
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers())) if (!names.has(k.toLowerCase())) headers[k] = v;
        response = await route.fetch({ headers: { ...headers, ...scope.headers }, maxRedirects: 0 });
      } else response = await route.fetch({ maxRedirects: 0 });
    } catch {
      // Playwright's fetch errors can list request headers, values included: no detail.
      await route.abort('failed').catch(() => undefined);
      return;
    }
    // The network guard's reply to a refused or failed CONNECT is not the site's page: fail as the browser would.
    if (response.headers()[GUARD_UPSTREAM_ERROR_HEADER] !== undefined && req.url().startsWith('https:')) {
      const status = response.status();
      await response.dispose().catch(() => undefined);
      await route.abort(status === 403 ? 'blockedbyclient' : 'connectionfailed').catch(() => undefined);
      return;
    }
    const location = response.headers().location;
    // WebKit refuses to be handed any 3xx: fail the navigation rather than leave it hanging.
    const handOver = () =>
      route.fulfill({ response }).catch(() => route.abort('failed').catch(() => undefined));
    if (!REDIRECT.has(response.status()) || !location) {
      await handOver();
      return;
    }
    let next: URL;
    try {
      next = new URL(location, req.url());
    } catch {
      await handOver();
      return;
    }
    await response.dispose().catch(() => undefined);
    const method = req.method().toUpperCase();
    const keep =
      (response.status() === 307 || response.status() === 308) && method !== 'GET' && method !== 'HEAD';
    const nextMethod = keep ? method : 'GET';
    const verdict = checkRequest(
      {
        url: next.toString(),
        method: nextMethod,
        isNavigation: true,
        mainFrame: true,
        body: keep ? req.postData() : null,
        frameUrl: req.url(),
      },
      policy,
    );
    if (!verdict.allowed) {
      await block(route, next.toString(), nextMethod, true, verdict);
      return;
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      await block(route, next.toString(), nextMethod, true, {
        allowed: false,
        kind: 'off-origin',
        reason: `A redirect to a ${next.protocol} URL is not followed.`,
      });
      return;
    }
    const body = onwardPage(
      next,
      nextMethod,
      keep ? req.postData() : null,
      req.headers()['content-type'] ?? '',
    );
    if (body === null) {
      await block(route, next.toString(), nextMethod, true, {
        allowed: false,
        kind: 'submit',
        reason: `${nextMethod} ${next.pathname} is a ${response.status()} redirect that resends a form Jourilo cannot rebuild hop by hop, so it is not followed.`,
      });
      return;
    }
    await route
      .fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        body,
      })
      .catch(() => undefined);
  };

  const handler = async (route: Route) => {
    const req = route.request();
    const mainFrame = isMainFrame(req);
    const verdict = checkRequest(
      {
        url: req.url(),
        method: req.method(),
        isNavigation: req.isNavigationRequest(),
        mainFrame,
        body: req.postData(),
        ...(frameUrl(req) ? { frameUrl: frameUrl(req)! } : {}),
      },
      policy,
    );
    if (!verdict.allowed) {
      await block(route, req.url(), req.method(), req.isNavigationRequest(), verdict);
      return;
    }
    if (options.checkRedirects && req.isNavigationRequest() && mainFrame && /^https?:/.test(req.url())) {
      await navigate(route, req);
      return;
    }
    await route.fallback().catch(() => undefined);
  };
  await target.route('**/*', handler);
  return {
    blocked,
    isBlocked: (u) => urls.has(u) || urls.has(u.split('#')[0]!),
    since: (t) => blocked.filter((b) => b.at >= t),
    detach: () => target.unroute('**/*', handler).catch(() => undefined),
  };
}
