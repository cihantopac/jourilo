// Installs the request-level safety backstop (journeys/safety.ts `checkRequest`) on a page or context. Whatever
// triggers a request while Jourilo interacts with a page, a request the policy forbids is aborted before it leaves
// the browser and recorded, so the step that caused it is reported as blocked and its failure is not mistaken for a
// defect of the site.
import type { BrowserContext, Page, Route } from 'playwright-core';
import { redactUrl } from '../core/redact.js';
import { type BlockKind, checkRequest, type RequestPolicy } from './safety.js';

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

export async function installRequestGuard(
  target: BrowserContext | Page,
  policy: RequestPolicy,
): Promise<RequestGuard> {
  const blocked: BlockedRequest[] = [];
  const urls = new Set<string>();
  const handler = async (route: Route) => {
    const req = route.request();
    let mainFrame = req.isNavigationRequest();
    try {
      const frame = req.frame();
      mainFrame = frame.parentFrame() === null;
    } catch {
      // Requests without a frame (service workers are blocked anyway).
    }
    const verdict = checkRequest(
      {
        url: req.url(),
        method: req.method(),
        isNavigation: req.isNavigationRequest(),
        mainFrame,
        body: req.postData(),
      },
      policy,
    );
    if (!verdict.allowed) {
      if (blocked.length < 200)
        blocked.push({
          url: redactUrl(req.url()),
          method: req.method(),
          reason: verdict.reason,
          kind: verdict.kind ?? 'submit',
          navigation: req.isNavigationRequest(),
          at: Date.now(),
        });
      urls.add(req.url());
      await route.abort('blockedbyclient').catch(() => undefined);
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
