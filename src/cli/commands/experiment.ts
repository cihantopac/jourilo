import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from '../../core/errors.js';
import type { ProductProfile } from '../../discovery/repo.js';
import { planExperiment, planMarkdown } from '../../experiment/plan.js';
import { analyze, sampleSize } from '../../experiment/stats.js';
import { type Command, type Context, flag, str } from '../framework.js';

function numOpt(ctx: Context, key: string): number | undefined {
  const v = str(ctx, key);
  if (v === undefined) return undefined;
  const n = Number(v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : v);
  if (!Number.isFinite(n)) throw new JouriloError('USAGE', `--${key} must be a number (e.g. 0.04 or 4%).`);
  return n;
}

function arm(
  spec: string | undefined,
  name: string,
): { name: string; visitors: number; conversions: number } {
  const m = spec?.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m)
    throw new JouriloError(
      'USAGE',
      `--${name} must be conversions/visitors, e.g. 120/2400 (your measured data).`,
    );
  return { name, conversions: Number(m[1]), visitors: Number(m[2]) };
}

export const experiment: Command = {
  name: 'experiment',
  summary:
    'Plan and analyze experiments: sample size, plans from conversion hypotheses, significance and SRM checks on your data.',
  usage: 'jourilo experiment <size|plan|analyze> …',
  options: {
    baseline: { type: 'string' },
    mde: { type: 'string' },
    absolute: { type: 'boolean' },
    alpha: { type: 'string' },
    power: { type: 'string' },
    variants: { type: 'string' },
    'daily-traffic': { type: 'string' },
    run: { type: 'string' },
    finding: { type: 'string' },
    control: { type: 'string' },
    variant: { type: 'string' },
    'expected-share': { type: 'string' },
    planned: { type: 'string' },
  },
  details: `Subcommands:
  size     --baseline 4% --mde 10% [--absolute] [--alpha 0.05] [--power 0.8] [--variants 2] [--daily-traffic N]
  plan     --finding <fingerprint> [--run latest] [--baseline 4%] [--mde 10%] [--daily-traffic N]
  analyze  --control 120/2400 --variant 150/2380 [--alpha 0.05] [--expected-share 0.5] [--planned N]

Jourilo never invents traffic, conversions or effects: every number comes from you or from the formulas.`,
  async run(ctx) {
    const sub = ctx.positionals[0];
    if (sub === 'size') {
      const baseline = numOpt(ctx, 'baseline');
      const mde = numOpt(ctx, 'mde');
      if (baseline === undefined || mde === undefined)
        throw new JouriloError('USAGE', 'size needs --baseline and --mde.');
      let r: ReturnType<typeof sampleSize>;
      try {
        r = sampleSize({
          baseline,
          mde,
          absolute: flag(ctx, 'absolute'),
          alpha: numOpt(ctx, 'alpha') ?? 0.05,
          power: numOpt(ctx, 'power') ?? 0.8,
          variants: numOpt(ctx, 'variants') ?? 2,
        });
      } catch (e) {
        throw new JouriloError('INVALID_INPUT', (e as Error).message);
      }
      const daily = numOpt(ctx, 'daily-traffic');
      const days = daily ? Math.ceil(r.total / daily) : null;
      return {
        data: { ...r, days },
        text: [
          `Detect ${(r.baseline * 100).toFixed(2)}% → ${(r.target * 100).toFixed(2)}% (α ${r.alpha}${r.variants > 2 ? `, ${r.alphaPerComparison.toFixed(4)} per comparison` : ''}, power ${r.power}, two-sided)`,
          `  ${r.perVariant.toLocaleString('en-US')} visitors per variant, ${r.total.toLocaleString('en-US')} total`,
          days
            ? `  ≈ ${days} day(s) at ${daily}/day — run whole weeks`
            : '  Add --daily-traffic to estimate duration.',
        ].join('\n'),
      };
    }
    if (sub === 'plan') {
      const fp = str(ctx, 'finding');
      if (!fp)
        throw new JouriloError(
          'USAGE',
          'plan needs --finding <fingerprint> (see the report or `jourilo report --format json`).',
        );
      const { run } = ctx.ws.loadRun(str(ctx, 'run') ?? 'latest');
      const f = run.findings.find((x) => x.fingerprint === fp);
      if (!f) throw new JouriloError('NOT_FOUND', `Finding ${fp} is not in run ${run.id}.`);
      if (f.kind !== 'hypothesis')
        ctx.log(`Note: ${f.ruleId} is a ${f.kind}; defects should usually be fixed, not A/B tested.`);
      const productFile = join(ctx.ws.root, 'product.json');
      const product = existsSync(productFile)
        ? (JSON.parse(readFileSync(productFile, 'utf8')) as ProductProfile)
        : null;
      const plan = planExperiment(run.id, f, {
        ...(numOpt(ctx, 'baseline') !== undefined ? { baseline: numOpt(ctx, 'baseline')! } : {}),
        ...(numOpt(ctx, 'mde') !== undefined ? { mde: numOpt(ctx, 'mde')! } : {}),
        ...(numOpt(ctx, 'daily-traffic') !== undefined
          ? { dailyTraffic: numOpt(ctx, 'daily-traffic')! }
          : {}),
        product,
      });
      const outDir = join(ctx.ws.root, 'experiments');
      mkdirSync(outDir, { recursive: true });
      const md = join(outDir, `${plan.id}.md`);
      writeFileSync(md, planMarkdown(plan));
      writeFileSync(join(outDir, `${plan.id}.json`), `${JSON.stringify(plan, null, 2)}\n`);
      return { data: { plan, file: md }, text: `${planMarkdown(plan)}\nSaved: ${md}` };
    }
    if (sub === 'analyze') {
      try {
        const r = analyze(arm(str(ctx, 'control'), 'control'), arm(str(ctx, 'variant'), 'variant'), {
          alpha: numOpt(ctx, 'alpha') ?? 0.05,
          expectedShare: numOpt(ctx, 'expected-share') ?? 0.5,
          ...(numOpt(ctx, 'planned') ? { plannedPerVariant: numOpt(ctx, 'planned')! } : {}),
        });
        return { data: r, text: r.interpretation.map((l) => `• ${l}`).join('\n') };
      } catch (e) {
        if (e instanceof JouriloError) throw e;
        throw new JouriloError('INVALID_INPUT', (e as Error).message);
      }
    }
    throw new JouriloError('USAGE', 'Use: experiment size | plan | analyze (see --help).');
  },
};
