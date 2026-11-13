import type { PageObservation } from '../browser/capture.js';

export const STALE_SERVER_LIMITATION =
  "Every page's own scripts failed (5xx or no answer) — this looks like a stale or different server on the port, not a site defect. Check that the dev server you meant to test is the one listening, then rerun.";

/**
 * F42: a second run can reach an older server still holding the port, so every own-origin script answers 5xx and
 * each page looks broken. Jourilo cannot start or identify the server, so when at least two pages were captured and
 * on every one of them all own-origin script requests failed, it says so once. Findings are not suppressed: a real
 * 5xx site is still reported.
 */
export function staleServerSuspect(observations: PageObservation[]): string | null {
  const pages = new Set(observations.map((o) => o.finalUrl));
  if (pages.size < 2) return null;
  for (const o of observations) {
    const failed = o.network.filter(
      (n) =>
        n.firstParty && n.resourceType === 'script' && ((n.status ?? 0) >= 500 || n.failure !== undefined),
    ).length;
    // A page without a recorded count cannot show that all its scripts failed: never guess it.
    const total = o.scriptRequests?.firstParty;
    if (total === undefined || failed === 0 || failed < total) return null;
  }
  return STALE_SERVER_LIMITATION;
}
