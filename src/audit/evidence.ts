// `--evidence minimal`: which screenshots a run keeps. Full-page shots are the bulk of a run's size, so only the
// ones a finding points at survive; first screens (fold shots) and journey step shots follow their own rule.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, JourneyStepResult, PageCapture } from '../core/types.js';

export type EvidenceMode = 'full' | 'minimal';

/** JPEG quality and the tallest full-page capture, per mode. */
export const EVIDENCE_QUALITY = { full: 80, minimal: 55 } as const;
export const FULL_PAGE_MAX_HEIGHT = { full: 12_000, minimal: 6_000 } as const;

/**
 * Deletes the full-page screenshot of every page that no finding refers to (by evidence file, which is also what an
 * evidence `rect` is drawn on), and drops it from the page. `findings` must include dismissed ones: dismissals never
 * delete evidence. Fold screenshots are never touched: a page whose fold file is its full-page file (the document
 * fits one screen) is kept, and `foldFiles` lists those fold paths.
 */
export function pruneFullPageScreenshots(
  runDir: string,
  pages: PageCapture[],
  findings: Finding[],
  foldFiles: Iterable<string | undefined> = [],
): { pruned: PageCapture[] } {
  const referenced = new Set(findings.flatMap((f) => f.evidence.map((e) => e.file).filter(Boolean)));
  const folds = new Set(foldFiles);
  const pruned: PageCapture[] = [];
  for (const p of pages) {
    if (!p.screenshot || referenced.has(p.screenshot) || folds.has(p.screenshot)) continue;
    rmSync(join(runDir, p.screenshot), { force: true });
    delete p.screenshot;
    pruned.push(p);
  }
  return { pruned };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

export function firstScreenLimitation(pruned: PageCapture[]): string {
  const shown = pruned.slice(0, 10).map((p) => `${pathOf(p.url)} (${p.viewport})`);
  const more = pruned.length > shown.length ? ` and ${pruned.length - shown.length} more` : '';
  return `--evidence minimal: only the first screen was kept for ${shown.join(', ')}${more}; the full-page screenshot was not needed by any finding. Run without --evidence minimal to keep every full page.`;
}

/** Indices of the journey steps whose screenshots stay: the failed step, the step before it and the final step. */
export function journeyStepsToKeep(steps: Pick<JourneyStepResult, 'status'>[]): Set<number> {
  const keep = new Set<number>();
  const failed = steps.findIndex((s) => s.status === 'failed' || s.status === 'blocked');
  if (failed >= 0) {
    keep.add(failed);
    if (failed > 0) keep.add(failed - 1);
  }
  let last = steps.length - 1;
  while (last > 0 && steps[last]!.status === 'skipped') last--;
  if (last >= 0) keep.add(last);
  return keep;
}

/**
 * Minimal journey evidence, applied to the attempt that is reported: its failed step, the step before it and its
 * final step keep a screenshot. Attempts share file names, so the files of every attempt are deleted except the kept
 * ones, and only the reported attempt's steps stay linked.
 */
export function pruneJourneyScreenshots(
  runDir: string,
  reported: { steps: JourneyStepResult[] },
  attempts: { steps: JourneyStepResult[] }[] = [reported],
): void {
  const keep = journeyStepsToKeep(reported.steps);
  const kept = new Set(reported.steps.flatMap((s, i) => (keep.has(i) && s.screenshot ? [s.screenshot] : [])));
  for (const a of attempts)
    for (const s of a.steps)
      if (s.screenshot && !kept.has(s.screenshot)) rmSync(join(runDir, s.screenshot), { force: true });
  for (const s of reported.steps) if (s.screenshot && !kept.has(s.screenshot)) delete s.screenshot;
}
