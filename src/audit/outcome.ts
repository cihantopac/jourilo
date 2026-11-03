import type { Run } from '../core/types.js';

/** How a finished run ended. A stopped run is `partial` even when it loaded nothing: it did not finish. */
export function runOutcome(run: Pick<Run, 'pages' | 'stoppedBy'>): NonNullable<Run['outcome']> {
  if (run.stoppedBy) return 'partial';
  return run.pages.some((p) => p.status !== null) ? 'complete' : 'no-page-loaded';
}

/** Exit code of an audit: a stopped run (6), then a run that loaded nothing (5), outrank the severity gate. */
export function exitCodeForOutcome(outcome: Run['outcome'], gateFailed: boolean): number {
  if (outcome === 'partial') return 6;
  if (outcome === 'no-page-loaded') return 5;
  return gateFailed ? 1 : 0;
}
