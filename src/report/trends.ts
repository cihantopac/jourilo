// Trends across runs of one target, normalized per page capture (URL x viewport), so runs audited with different
// --pages or viewports still compare: every row follows one page at one viewport through the runs that captured it.
import { pagesOf } from '../audit/finding.js';
import { runOutcome } from '../audit/outcome.js';
import type { TrendRun } from '../core/trend-run.js';

export { type TrendRun, trendSlice } from '../core/trend-run.js';

export interface TrendPoint {
  runId: string;
  at: string;
  /** Defects on this page at this viewport, divided by the number of captures of it in the run. */
  defectsPerCapture: number;
  /** Critical and serious defects (same normalization). */
  serious: number;
  lcp: number | null;
  cls: number | null;
}

export interface TrendRow {
  url: string;
  viewport: string;
  points: TrendPoint[];
}

export interface TrendReport {
  rows: TrendRow[];
  /** Runs of the target that fed the rows. */
  used: number;
  /** Partial and no-page-loaded runs of the target left out: their numbers are not comparable. */
  skipped: number;
  /** True when the pages (URL x viewport) captured differ between the runs that fed the rows. */
  pageSetChanged: boolean;
}

const metric = (p: TrendRun['pages'][number], name: string): number | null =>
  p.metrics.find((m) => m.name === name)?.value ?? null;

/** Median of the values that exist; null when none does. */
function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** Runs older than `outcome` are judged the way a new run is. */
function usable(run: TrendRun): boolean {
  return (run.outcome ?? runOutcome(run)) === 'complete';
}

export function trendReport(runs: TrendRun[], key: { target: string }): TrendReport {
  const same = runs
    .filter((r) => r.target === key.target)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const good = same.filter(usable);
  const rows = new Map<string, TrendRow>();
  const pageSets = new Set<string>();
  for (const run of good) {
    const captures = new Map<string, TrendRun['pages']>();
    for (const p of run.pages) {
      if (p.status === null) continue; // never loaded: nothing to compare
      const k = `${p.url}\n${p.viewport}`;
      captures.set(k, [...(captures.get(k) ?? []), p]);
    }
    pageSets.add([...captures.keys()].sort().join('\n\n'));
    for (const [k, caps] of captures) {
      const first = caps[0]!;
      // A finding without a viewport (a page-level result) is counted at every viewport of its page: once per row.
      // A finding collapsed over several pages (F44) counts on each of its pages, as it did before the collapse, so a
      // page's defects per capture do not drop just because the same cause was also seen elsewhere.
      const mine = run.findings.filter(
        (f) =>
          f.kind === 'defect' &&
          pagesOf(f).includes(first.url) &&
          // A finding merged over viewports names them all ("desktop, mobile"): it counts at each of them.
          (f.viewport === undefined || f.viewport.split(', ').includes(first.viewport)),
      );
      const row = rows.get(k) ?? { url: first.url, viewport: first.viewport, points: [] };
      row.points.push({
        runId: run.id,
        at: run.startedAt,
        defectsPerCapture: mine.length / caps.length,
        serious:
          mine.filter((f) => f.severity === 'critical' || f.severity === 'serious').length / caps.length,
        // The median over the captures of this page, not the first one: a single visit can be an outlier.
        lcp: median(caps.map((c) => metric(c, 'LCP'))),
        cls: median(caps.map((c) => metric(c, 'CLS'))),
      });
      rows.set(k, row);
    }
  }
  return {
    rows: [...rows.values()].sort(
      (a, b) => a.url.localeCompare(b.url) || a.viewport.localeCompare(b.viewport),
    ),
    used: good.length,
    skipped: same.length - good.length,
    pageSetChanged: pageSets.size > 1,
  };
}

export function trends(runs: TrendRun[], key: { target: string }): TrendRow[] {
  return trendReport(runs, key).rows;
}
