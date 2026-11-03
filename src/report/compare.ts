// Before/after comparison of two runs by finding fingerprint, plus lab metric deltas per page and viewport.
import type { Finding, MetricValue, Run } from '../core/types.js';

export interface MetricDelta {
  url: string;
  viewport: string;
  name: string;
  before: number;
  after: number;
  delta: number;
  /**
   * improved / regressed: the ranges of repeated visits do not overlap; noise: they overlap, or the change is below
   * what a single visit can resolve; unconfirmed: a large change seen in single visits (rerun with --runs).
   */
  verdict: 'improved' | 'regressed' | 'noise' | 'unconfirmed';
}

/** Smallest change a single lab visit can resolve; below this, a difference is treated as noise. */
const RESOLUTION: Record<string, number> = { LCP: 150, FCP: 150, TBT: 100, CLS: 0.02, Transfer: 0 };

export function metricVerdict(name: string, a: MetricValue, b: MetricValue): MetricDelta['verdict'] {
  const delta = b.value - a.value;
  if (name === 'Transfer') {
    if (Math.abs(delta) <= Math.max(2048, a.value * 0.02)) return 'noise';
    return delta < 0 ? 'improved' : 'regressed';
  }
  if (a.range && b.range) {
    const overlap = a.range[0] <= b.range[1] && b.range[0] <= a.range[1];
    if (overlap || Math.abs(delta) < (RESOLUTION[name] ?? 0) / 2) return 'noise';
    return delta < 0 ? 'improved' : 'regressed';
  }
  return Math.abs(delta) < (RESOLUTION[name] ?? 0) ? 'noise' : 'unconfirmed';
}

export interface RunComparison {
  base: Run;
  head: Run;
  fixed: Finding[];
  /** Base findings the head run kept out because they were dismissed: not fixed, not present. */
  dismissed: Finding[];
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
  // Findings on pages the head run did not visit, or that did not load, are not "fixed": they were not checked.
  const headPages = new Set(head.pages.filter((p) => p.status !== null).map((p) => pathKey(p.url)));
  const dismissedFps = new Set((head.dismissed ?? []).map((f) => f.fingerprint));
  const dismissed = base.findings.filter((f) => dismissedFps.has(f.fingerprint));
  const fixed = base.findings.filter(
    (f) => !after.has(f.fingerprint) && !dismissedFps.has(f.fingerprint) && headPages.has(pathKey(f.url)),
  );
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
      metrics.push({
        url: hp.url,
        viewport: hp.viewport,
        name,
        before: a.value,
        after: b.value,
        delta,
        verdict: metricVerdict(name, a, b),
      });
    }
  }
  const regressionFree = !introduced.some(
    (f) => f.kind === 'defect' && (f.severity === 'critical' || f.severity === 'serious'),
  );
  return { base, head, fixed, dismissed, introduced, persisting, changed, metrics, regressionFree };
}
