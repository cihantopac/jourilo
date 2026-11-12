// Records a judgment made by an AI agent or a person into a run, labelled with its provenance ("inferred" or
// "user") and tied to evidence that exists in the run. Measured and observed findings can only come from the
// toolchain itself; this command cannot create them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from '../../audit/engine.js';
import { makeFinding } from '../../audit/finding.js';
import {
  type DismissedFinding,
  loadDismissals,
  removeDismissal,
  resolveFingerprint,
  saveDismissal,
} from '../../core/dismissals.js';
import { JouriloError } from '../../core/errors.js';
import { resolveInside } from '../../core/fs-safety.js';
import { excerpt } from '../../core/redact.js';
import type { Category, Confidence, FindingKind, Run, Severity } from '../../core/types.js';
import { writeReports } from '../../report/index.js';
import { type Command, type Context, str } from '../framework.js';

const CATEGORIES: Category[] = [
  'accessibility',
  'usability',
  'responsive',
  'performance',
  'conversion',
  'reliability',
  'content',
  'design-system',
];
const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor', 'info'];

export const finding: Command = {
  name: 'finding',
  summary:
    'Add a judgment (AI inference or user input) to a run, tied to evidence in that run; never mixed with measurements.',
  usage:
    'jourilo finding add --run <id> --title … --category usability --description … --evidence screenshots/x.jpg [--by agent|user] | finding dismiss <id> --run <run> --reason "<text>" [--by user|agent] | finding undismiss <id> [--run <run>]',
  options: {
    run: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string' },
    kind: { type: 'string' },
    severity: { type: 'string' },
    confidence: { type: 'string' },
    description: { type: 'string' },
    impact: { type: 'string' },
    recommendation: { type: 'string' },
    url: { type: 'string' },
    viewport: { type: 'string' },
    evidence: { type: 'string', multiple: true },
    by: { type: 'string' },
    reason: { type: 'string' },
  },
  details: `Subcommands:
  add                  Record a judgment tied to evidence in a run
  dismiss <id>         Mark a finding as not a problem; it is kept out of later runs and listed as dismissed
  undismiss <id>       Remove a dismissal; the next run reports the finding again

add options:
  --run ID             Run to add to (default latest)
  --title TEXT         Short title (required)
  --category NAME      accessibility, usability, responsive, performance, conversion, reliability, content or design-system (required)
  --description TEXT   What is wrong and why it matters (required)
  --evidence FILE      Screenshot or file inside the run, e.g. screenshots/home-desktop.jpg (required, repeatable)
  --kind KIND          defect, hypothesis or needs-review (default: hypothesis for conversion, else needs-review)
  --severity LEVEL     critical, serious, moderate, minor or info (default minor)
  --confidence LEVEL   low, medium or high (AI judgments are capped at medium)
  --impact TEXT        Who is affected and how
  --recommendation TEXT  What to change
  --url URL            Page the finding is about (default: the run's first page)
  --viewport NAME      Viewport the finding was seen in (e.g. desktop, mobile)
  --by WHO             agent (default) or user

dismiss options:
  --run ID             Run to apply it to now (default latest)
  --reason TEXT        Why this is not a problem (required)
  --by WHO             user (default) or agent

undismiss options:
  --run ID             Also bring the finding back into this run`,
  async run(ctx) {
    if (ctx.positionals[0] === 'dismiss') return dismiss(ctx);
    if (ctx.positionals[0] === 'undismiss') return undismiss(ctx);
    if (ctx.positionals[0] !== 'add') throw new JouriloError('USAGE', `Usage: ${finding.usage}`);
    const { run, dir } = ctx.ws.loadRun(str(ctx, 'run') ?? 'latest');
    const need = (k: string) => {
      const v = str(ctx, k);
      if (!v) throw new JouriloError('USAGE', `--${k} is required.`);
      return v;
    };
    const category = need('category') as Category;
    if (!CATEGORIES.includes(category))
      throw new JouriloError('USAGE', `--category must be one of ${CATEGORIES.join(', ')}`);
    const severity = (str(ctx, 'severity') ?? 'minor') as Severity;
    if (!SEVERITIES.includes(severity))
      throw new JouriloError('USAGE', `--severity must be one of ${SEVERITIES.join(', ')}`);
    const kind = (str(ctx, 'kind') ??
      (category === 'conversion' ? 'hypothesis' : 'needs-review')) as FindingKind;
    if (!['defect', 'hypothesis', 'needs-review'].includes(kind))
      throw new JouriloError('USAGE', '--kind must be defect, hypothesis or needs-review');
    const by = str(ctx, 'by') ?? 'agent';
    const evidenceFiles = (ctx.values.evidence as string[] | undefined) ?? [];
    if (!evidenceFiles.length)
      throw new JouriloError(
        'USAGE',
        'At least one --evidence file from the run (e.g. screenshots/home-…-desktop.jpg) is required: judgments must point at what they judge.',
      );
    for (const e of evidenceFiles)
      if (!existsSync(resolveInside(dir, e)))
        throw new JouriloError('NOT_FOUND', `Evidence ${e} is not in run ${run.id}.`);
    const url = str(ctx, 'url') ?? run.pages[0]?.url ?? run.target;
    const f = makeFinding({
      ruleId: `${by === 'user' ? 'user' : 'ai'}/${need('title')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)}`,
      title: excerpt(need('title'), 120),
      category,
      kind,
      severity,
      // AI judgments are capped at medium confidence: they are not reproducible measurements.
      confidence:
        by === 'user'
          ? ((str(ctx, 'confidence') ?? 'high') as Confidence)
          : str(ctx, 'confidence') === 'low'
            ? 'low'
            : 'medium',
      provenance: by === 'user' ? 'user' : 'inferred',
      url,
      ...(str(ctx, 'viewport') ? { viewport: str(ctx, 'viewport')! } : {}),
      description: excerpt(need('description'), 1200),
      impact: excerpt(
        str(ctx, 'impact') ??
          (kind === 'hypothesis'
            ? 'Hypothesis; validate with an experiment or analytics.'
            : 'Judgment; confirm with users or a usability test.'),
        600,
      ),
      recommendation: excerpt(str(ctx, 'recommendation') ?? 'See description.', 800),
      standards: [],
      evidence: evidenceFiles.map((file) => ({
        type: 'screenshot' as const,
        file,
        note: by === 'user' ? 'Referenced by the user' : 'Referenced by the AI reviewer',
      })),
      reproduction: [
        `Open ${url}${str(ctx, 'viewport') ? ` at the ${str(ctx, 'viewport')} viewport` : ''} and look at the referenced screenshot.`,
      ],
    });
    run.findings = run.findings.filter((x) => x.fingerprint !== f.fingerprint);
    run.findings.push(f);
    run.summary = { ...run.summary, ...summarize(run.findings, run.summary.pages, run.summary.journeys) };
    ctx.ws.saveRun(run);
    writeReports(dir, run, undefined, { history: ctx.ws.listRuns() });
    return {
      data: f,
      text: `Added ${f.provenance} finding ${f.fingerprint} to run ${run.id} (${join(dir, 'report.html')}).`,
    };
  },
};

/** Moves a finding of a saved run into `dismissed` (or back) and rewrites that run's reports. */
function refreshRun(ctx: Context, runRef: string, change: (run: Run) => void): string {
  const { run, dir } = ctx.ws.loadRun(runRef);
  change(run);
  if (run.dismissed && !run.dismissed.length) delete run.dismissed;
  run.summary = { ...run.summary, ...summarize(run.findings, run.summary.pages, run.summary.journeys) };
  ctx.ws.saveRun(run);
  writeReports(dir, run, undefined, { history: ctx.ws.listRuns() });
  return run.id;
}

function dismiss(ctx: Context) {
  const reason = str(ctx, 'reason')?.trim();
  if (!reason)
    throw new JouriloError(
      'USAGE',
      '--reason is required: say why this is not a problem, so the next person can check it.',
    );
  const idArg = ctx.positionals[1];
  if (!idArg) throw new JouriloError('USAGE', `Usage: ${finding.usage}`);
  const by = str(ctx, 'by') ?? 'user';
  if (by !== 'user' && by !== 'agent') throw new JouriloError('USAGE', '--by must be user or agent');
  const runRef = str(ctx, 'run') ?? 'latest';
  const { run } = ctx.ws.loadRun(runRef);
  const fp = resolveFingerprint(
    idArg,
    run.findings.map((f) => f.fingerprint),
  );
  const f = run.findings.find((x) => x.fingerprint === fp)!;
  const d = {
    fingerprint: fp,
    ruleId: f.ruleId,
    url: f.url,
    reason: excerpt(reason, 400),
    by,
    at: new Date().toISOString(),
  } as const;
  saveDismissal(ctx.ws, d);
  const runId = refreshRun(ctx, runRef, (r) => {
    r.findings = r.findings.filter((x) => x.fingerprint !== fp);
    r.dismissed = [...(r.dismissed ?? []).filter((x) => x.fingerprint !== fp), { ...f, dismissal: d }];
  });
  return {
    data: d,
    text: `Dismissed ${fp} (${f.title}) in run ${runId}; later runs keep it out. Undo with: jourilo finding undismiss ${fp}`,
  };
}

function undismiss(ctx: Context) {
  const idArg = ctx.positionals[1];
  if (!idArg) throw new JouriloError('USAGE', `Usage: ${finding.usage}`);
  const fp = resolveFingerprint(
    idArg,
    loadDismissals(ctx.ws).map((d) => d.fingerprint),
  );
  removeDismissal(ctx.ws, fp);
  // Bring the finding back into the run it was dismissed in, when that run is named.
  const runRef = str(ctx, 'run');
  if (runRef)
    refreshRun(ctx, runRef, (r) => {
      const back = (r.dismissed ?? []).find((x) => x.fingerprint === fp) as DismissedFinding | undefined;
      if (!back) return;
      const { dismissal: _dismissal, ...restored } = back;
      r.dismissed = (r.dismissed ?? []).filter((x) => x.fingerprint !== fp);
      r.findings.push(restored);
    });
  return {
    data: { fingerprint: fp },
    text: `Removed the dismissal of ${fp}; the next run reports it again.`,
  };
}
