// Records a judgment made by an AI agent or a person into a run, labelled with its provenance ("inferred" or
// "user") and tied to evidence that exists in the run. Measured and observed findings can only come from the
// toolchain itself; this command cannot create them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from '../../audit/engine.js';
import { makeFinding } from '../../audit/finding.js';
import { JouriloError } from '../../core/errors.js';
import { resolveInside } from '../../core/fs-safety.js';
import { excerpt } from '../../core/redact.js';
import type { Category, Confidence, FindingKind, Severity } from '../../core/types.js';
import { writeReports } from '../../report/index.js';
import { type Command, str } from '../framework.js';

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
    'jourilo finding add --run <id> --title … --category usability --description … --evidence screenshots/x.jpg [--by agent|user]',
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
  },
  async run(ctx) {
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
    run.summary = summarize(run.findings, run.summary.pages, run.summary.journeys);
    ctx.ws.saveRun(run);
    writeReports(dir, run, undefined, { history: ctx.ws.listRuns() });
    return {
      data: f,
      text: `Added ${f.provenance} finding ${f.fingerprint} to run ${run.id} (${join(dir, 'report.html')}).`,
    };
  },
};
