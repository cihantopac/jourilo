// Trends across runs of one target, normalized per page capture (URL x viewport), so runs audited with different
// --pages or viewports still compare: every row follows one page at one viewport through the runs that captured it.
import { runOutcome } from '../audit/outcome.js';
import type { Finding, PageCapture, Run } from '../core/types.js';

/** The part of a run a trend needs. A `Run` fits; `RunListing` keeps this slice so history stays light. */
export interface TrendRun {
  id: string;
  target: string;
  startedAt: string;
  outcome?: Run['outcome'];
  stoppedBy?: Run['stoppedBy'];
  pages: Pick<PageCapture, 'url' | 'viewport' | 'status' | 'metrics'>[];
  findings: Pick<Finding, 'kind' | 'severity' | 'url' | 'viewport'>[];
}

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
}

/** The slice of a run `trends` reads. */
export function trendSlice(run: Run): TrendRun {
  return {
    id: run.id,
    target: run.target,
    startedAt: run.startedAt,
    outcome: run.outcome,
    stoppedBy: run.stoppedBy,
    pages: run.pages.map((p) => ({ url: p.url, viewport: p.viewport, status: p.status, metrics: p.metrics })),
    findings: run.findings.map((f) => ({
      kind: f.kind,
      severity: f.severity,
      url: f.url,
      viewport: f.viewport,
    })),
  };
}

const metric = (p: TrendRun['pages'][number], name: string): number | null =>
  p.metrics.find((m) => m.name === name)?.value ?? null;

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
  for (const run of good) {
    const captures = new Map<string, TrendRun['pages']>();
    for (const p of run.pages) {
      if (p.status === null) continue; // never loaded: nothing to compare
      const k = `${p.url}\n${p.viewport}`;
      captures.set(k, [...(captures.get(k) ?? []), p]);
    }
    for (const [k, caps] of captures) {
      const first = caps[0]!;
      // A finding without a viewport belongs to the page at every viewport.
      const mine = run.findings.filter(
        (f) =>
          f.kind === 'defect' &&
          f.url === first.url &&
          (f.viewport === undefined || f.viewport === first.viewport),
      );
      const row = rows.get(k) ?? { url: first.url, viewport: first.viewport, points: [] };
      row.points.push({
        runId: run.id,
        at: run.startedAt,
        defectsPerCapture: mine.length / caps.length,
        serious:
          mine.filter((f) => f.severity === 'critical' || f.severity === 'serious').length / caps.length,
        lcp: metric(first, 'LCP'),
        cls: metric(first, 'CLS'),
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
  };
}

export function trends(runs: TrendRun[], key: { target: string }): TrendRow[] {
  return trendReport(runs, key).rows;
}
