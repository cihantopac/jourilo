// The slice of a run that trends read. It lives in core so storage does not depend on the report layer.
import type { Finding, PageCapture, Run } from './types.js';

/** The part of a run a trend needs. A `Run` fits; a trend-enabled `RunListing` keeps this slice. */
export interface TrendRun {
  id: string;
  target: string;
  startedAt: string;
  outcome?: Run['outcome'];
  stoppedBy?: Run['stoppedBy'];
  pages: Pick<PageCapture, 'url' | 'viewport' | 'status' | 'metrics'>[];
  findings: Pick<Finding, 'kind' | 'severity' | 'url' | 'viewport' | 'pages'>[];
}

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
      ...(f.pages ? { pages: f.pages } : {}),
    })),
  };
}
