import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from '../../core/errors.js';
import type { ProductProfile } from '../../discovery/repo.js';
import { ADAPTERS, adapterFor } from '../../experiment/adapters/index.js';
import { planExperiment, planMarkdown } from '../../experiment/plan.js';
import { analyze, sampleSize } from '../../experiment/stats.js';
import { type Command, type CommandResult, type Context, flag, proxyFrom, str } from '../framework.js';

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

function analyzeOptions(ctx: Context) {
  return {
    alpha: numOpt(ctx, 'alpha') ?? 0.05,
    expectedShare: numOpt(ctx, 'expected-share') ?? 0.5,
    ...(numOpt(ctx, 'planned') ? { plannedPerVariant: numOpt(ctx, 'planned')! } : {}),
  };
}

/**
 * `analyze --from <adapter>:<id>`: reads the numbers from PostHog, GrowthBook or Amplitude (read-only, keys from the
 * environment) and refuses to compute on data the adapter reports as incomplete.
 */
async function analyzeFrom(ctx: Context, from: string): Promise<CommandResult> {
  if (str(ctx, 'control') !== undefined || str(ctx, 'variant') !== undefined)
    throw new JouriloError('USAGE', '--from reads the numbers itself; leave out --control and --variant.');
  const m = from.match(/^([a-z]+):(.+)$/);
  if (!m)
    throw new JouriloError(
      'USAGE',
      `--from must be <adapter>:<id>, e.g. posthog:42 (adapters: ${ADAPTERS.join(', ')}).`,
    );
  const [, name, id] = m as unknown as [string, string, string];
  const metric = str(ctx, 'metric');
  const start = str(ctx, 'start');
  const end = str(ctx, 'end');
  const adapter = adapterFor(name, {
    env: process.env,
    proxy: (url) => proxyFrom(ctx, url),
    ...(metric !== undefined ? { metric } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  });
  const data = await adapter.experiment(id);
  const label = `${name}:${id}`;
  if (!data.complete)
    throw new JouriloError(
      'INVALID_INPUT',
      `Not analyzed: ${label} returned incomplete data, and Jourilo does not compute on partial numbers.\n${data.notes.map((n) => `  - ${n}`).join('\n')}`,
      'Rerun when the vendor has the full numbers (after a rate limit, wait for the Retry-After time).',
    );
  if (data.variants.length !== 2)
    throw new JouriloError(
      'INVALID_INPUT',
      `Not analyzed: ${label} has ${data.variants.length} variants (${data.variants.map((v) => v.name).join(', ')}); analyze compares two arms.`,
      'Pass the two arms you want to compare with --control and --variant.',
    );
  const [c, v] = data.variants as [(typeof data.variants)[0], (typeof data.variants)[0]];
  let r: ReturnType<typeof analyze>;
  try {
    r = analyze(
      { name: c.name, visitors: c.exposures, conversions: c.conversions },
      { name: v.name, visitors: v.exposures, conversions: v.conversions },
      analyzeOptions(ctx),
    );
  } catch (e) {
    throw new JouriloError('INVALID_INPUT', `${label}: ${(e as Error).message}`);
  }
  const vendor = { posthog: 'PostHog', growthbook: 'GrowthBook', amplitude: 'Amplitude' }[adapter.name];
  return {
    data: { ...r, source: { adapter: adapter.name, ...data } },
    text: [
      `${vendor} experiment ${id}, metric ${data.metric}: ${c.name} ${c.conversions}/${c.exposures}, ${v.name} ${v.conversions}/${v.exposures}`,
      ...data.notes.map((n) => `Note: ${n}`),
      ...r.interpretation.map((l) => `• ${l}`),
    ].join('\n'),
  };
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
    from: { type: 'string' },
    metric: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
  },
  details: `Subcommands:
  size     --baseline 4% --mde 10% [--absolute] [--alpha 0.05] [--power 0.8] [--variants 2] [--daily-traffic N]
  plan     --finding <fingerprint> [--run latest] [--baseline 4%] [--mde 10%] [--daily-traffic N]
  analyze  --control 120/2400 --variant 150/2380 [--alpha 0.05] [--expected-share 0.5] [--planned N]
  analyze  --from <adapter>:<id> [--metric M] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--alpha …]

--from reads the numbers, read-only, from an analytics tool (keys from the environment only, never printed):
  posthog:<id|flag-key>      POSTHOG_API_KEY (personal key: experiment:read, query:read); POSTHOG_HOST
                             (default https://us.posthog.com), POSTHOG_PROJECT_ID (default @current).
                             --metric picks a primary metric by name or uuid (default: the first); funnel only
  growthbook:<exp_id|key>    GROWTHBOOK_API_KEY; GROWTHBOOK_HOST (default https://api.growthbook.io).
                             --metric picks a metric by id or name (default: the first goal)
  amplitude:<flag-key>       AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY; AMPLITUDE_HOST (default
                             https://amplitude.com). --metric EVENT (the conversion event) and --start are
                             required; --end defaults to today
Requests go through Jourilo's network guard and HTTPS_PROXY / NO_PROXY. A rate limit (429), a failed page or a
missing variant makes the data incomplete: analyze then refuses and says why, instead of computing on partial numbers.

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
      const from = str(ctx, 'from');
      if (from !== undefined) return analyzeFrom(ctx, from);
      try {
        const r = analyze(
          arm(str(ctx, 'control'), 'control'),
          arm(str(ctx, 'variant'), 'variant'),
          analyzeOptions(ctx),
        );
        return { data: r, text: r.interpretation.map((l) => `• ${l}`).join('\n') };
      } catch (e) {
        if (e instanceof JouriloError) throw e;
        throw new JouriloError('INVALID_INPUT', (e as Error).message);
      }
    }
    throw new JouriloError('USAGE', 'Use: experiment size | plan | analyze (see --help).');
  },
};
