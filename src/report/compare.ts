// Before/after comparison of two runs by finding fingerprint, plus lab metric deltas per page and viewport.
import type { Finding, Run } from '../core/types.js';

export interface MetricDelta {
  url: string;
  viewport: string;
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface RunComparison {
  base: Run;
  head: Run;
  fixed: Finding[];
  introduced: Finding[];
  persisting: Finding[];
  changed: { before: Finding; after: Finding }[];
  metrics: MetricDelta[];
  /** True when the head run has no new defects at serious or above. */
  regressionFree: boolean;
}

function pathKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.pathname}${x.search}`;
  } catch {
    return u;
  }
}

export function compareRuns(base: Run, head: Run): RunComparison {
  const before = new Map(base.findings.map((f) => [f.fingerprint, f]));
  const after = new Map(head.findings.map((f) => [f.fingerprint, f]));
  // Findings on pages the head run did not visit are not "fixed": they were simply not checked.
  const headPages = new Set(head.pages.map((p) => pathKey(p.url)));
  const fixed = base.findings.filter((f) => !after.has(f.fingerprint) && headPages.has(pathKey(f.url)));
  const introduced = head.findings.filter((f) => !before.has(f.fingerprint));
  const persisting = head.findings.filter((f) => before.has(f.fingerprint));
  const changed = persisting
    .map((f) => ({ before: before.get(f.fingerprint)!, after: f }))
    .filter((c) => c.before.severity !== c.after.severity || c.before.occurrences !== c.after.occurrences);

  const metrics: MetricDelta[] = [];
  for (const hp of head.pages) {
    const bp = base.pages.find((p) => pathKey(p.url) === pathKey(hp.url) && p.viewport === hp.viewport);
    if (!bp) continue;
    for (const name of ['LCP', 'CLS', 'TBT', 'FCP', 'Transfer']) {
      const a = bp.metrics.find((m) => m.name === name);
      const b = hp.metrics.find((m) => m.name === name);
      if (!a || !b) continue;
      const delta = Math.round((b.value - a.value) * 1000) / 1000;
      metrics.push({ url: hp.url, viewport: hp.viewport, name, before: a.value, after: b.value, delta });
    }
  }
  const regressionFree = !introduced.some(
    (f) => f.kind === 'defect' && (f.severity === 'critical' || f.severity === 'serious'),
  );
  return { base, head, fixed, introduced, persisting, changed, metrics, regressionFree };
}
