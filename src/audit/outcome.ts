import type { Run } from '../core/types.js';

/** How a finished run ended. Extend here (e.g. a run stopped early is `partial`) so the rule lives in one place. */
export function runOutcome(run: Pick<Run, 'pages'>): NonNullable<Run['outcome']> {
  return run.pages.some((p) => p.status !== null) ? 'complete' : 'no-page-loaded';
}

/** Exit code of an audit: a run that loaded nothing outranks the severity gate. */
export function exitCodeForOutcome(outcome: Run['outcome'], gateFailed: boolean): number {
  if (outcome === 'no-page-loaded') return 5;
  return gateFailed ? 1 : 0;
}
