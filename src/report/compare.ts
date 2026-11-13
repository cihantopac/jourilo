// Before/after comparison of two runs by finding fingerprint, plus lab metric deltas per page and viewport.
import { collapseKey, fingerprintPath, pagesOf, sameCause } from '../audit/finding.js';
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

const pathKey = fingerprintPath;

export function compareRuns(base: Run, head: Run): RunComparison {
  const before = new Map(base.findings.map((f) => [f.fingerprint, f]));
  const after = new Map(head.findings.map((f) => [f.fingerprint, f]));
  // Findings on pages the head run did not visit, or that did not load, are not "fixed": they were not checked.
  const headPages = new Set(head.pages.filter((p) => p.status !== null).map((p) => pathKey(p.url)));
  const dismissedFps = new Set((head.dismissed ?? []).map((f) => f.fingerprint));
  const dismissed = base.findings.filter((f) => dismissedFps.has(f.fingerprint));
  // A finding collapsed over several pages (F44) has a fingerprint of its own: it still matches the same cause seen on
  // one of its pages, collapsed or not, so a collapse in either run is neither "fixed" nor "new".
  const baseCauses = base.findings.filter((f) => collapseKey(f));
  const headCauses = head.findings.filter((f) => collapseKey(f));
  const counterpart = (f: Finding) => before.get(f.fingerprint) ?? baseCauses.find((b) => sameCause(b, f));
  const stillThere = (f: Finding) => after.has(f.fingerprint) || headCauses.some((h) => sameCause(f, h));
  // Fixed only when none of its pages shows it, and every one of them was checked again.
  const fixed = base.findings.filter(
    (f) =>
      !stillThere(f) &&
      !dismissedFps.has(f.fingerprint) &&
      pagesOf(f).every((p) => headPages.has(pathKey(p))),
  );
  const introduced = head.findings.filter((f) => !counterpart(f));
  const persisting = head.findings.filter((f) => counterpart(f));
  const changed = persisting
    .map((f) => ({ before: counterpart(f)!, after: f }))
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
