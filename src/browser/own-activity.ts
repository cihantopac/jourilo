// Jourilo's own work inside a page (evaluated probes, axe, screenshots) is never the site's defect. Scripts are
// evaluated through the browser's debugging protocol (`page.evaluate`, init scripts), which a page's
// Content-Security-Policy does not govern, so a nonce- or hash-only CSP neither blocks them nor logs a refusal. Two
// things can still reach the console, and both are recognised here and dropped from the observations:
// - a message or exception raised by Jourilo's own source: every source it evaluates carries a sourceURL under
//   `jourilo-inpage://`, which Chromium and Firefox report as the message's location (WebKit reports none);
// - a CSP refusal of a style Playwright inserts while it takes a screenshot (WebKit adds one to sync animations): it
//   has no source position, so it is recognised by being a style refusal raised while Jourilo is taking one.
// A CSP refusal of the site's own scripts or styles at any other time is still reported.
import type { Page } from 'playwright-core';

export const INPAGE_SCHEME = 'jourilo-inpage://';

/** Marks a script source Jourilo evaluates in a page, so what it logs or throws is recognised as Jourilo's. */
export const inpageSource = (name: string, source: string) =>
  `${source}\n//# sourceURL=${INPAGE_SCHEME}${name}.js`;

const acting = new WeakMap<Page, number>();

/** Runs `act` (a screenshot) as Jourilo's own action on `page`: style refusals it causes are not the site's. */
export async function asJourilo<T>(page: Page, act: () => Promise<T>): Promise<T> {
  acting.set(page, (acting.get(page) ?? 0) + 1);
  try {
    return await act();
  } finally {
    acting.set(page, (acting.get(page) ?? 1) - 1);
  }
}

// The wording of a CSP refusal of a style in Chromium, Firefox and WebKit.
const CSP = /Content[- ]Security[- ]Policy/i;
const STYLE = /\bstyle(sheet)?\b|style-src/i;

/** True for a console message that Jourilo's own instrumentation caused on `page`. */
export function isOwnConsoleMessage(page: Page, text: string, sourceUrl: string): boolean {
  if (sourceUrl.startsWith(INPAGE_SCHEME)) return true;
  return (acting.get(page) ?? 0) > 0 && CSP.test(text) && STYLE.test(text);
}

/** True for an uncaught exception thrown by Jourilo's own source (its innermost frame is one of them). */
export function isOwnException(err: Error): boolean {
  const top = (err.stack ?? '').split('\n').find((l) => /^\s+at\b/.test(l));
  return top?.includes(INPAGE_SCHEME) === true;
}
