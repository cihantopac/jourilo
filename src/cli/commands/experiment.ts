import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from '../../core/errors.js';
import type { ProductProfile } from '../../discovery/repo.js';
import { ADAPTERS, adapterFor } from '../../experiment/adapters/index.js';
import type { AnalyticsAdapter, ExperimentData } from '../../experiment/adapters/types.js';
import { planExperiment, planMarkdown } from '../../experiment/plan.js';
import { analyze, GUARDRAIL_NOTE, sampleSize, sequentialTest, srmNote } from '../../experiment/stats.js';
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

type Arm = { name: string; visitors: number; conversions: number };

/** Where `--from` numbers came from: the adapter and its ExperimentData. */
type Source = { adapter: AnalyticsAdapter['name'] } & ExperimentData;

const VENDOR: Record<AnalyticsAdapter['name'], string> = {
  posthog: 'PostHog',
  growthbook: 'GrowthBook',
  amplitude: 'Amplitude',
};

/**
 * The two arms to analyze: typed in (`--control/--variant`), or read with `--from <adapter>:<id>` from PostHog,
 * GrowthBook or Amplitude (read-only, keys from the environment). Data the adapter reports as incomplete is refused
 * here, so no analysis ever runs on partial numbers.
 */
export async function armsFrom(ctx: Context): Promise<{ control: Arm; variant: Arm; source?: Source }> {
  const from = str(ctx, 'from');
  const fromOnly = ['metric', 'start', 'end', 'control-key'].filter((k) => str(ctx, k) !== undefined);
  if (from === undefined) {
    if (fromOnly.length)
      throw new JouriloError('USAGE', `--${fromOnly[0]} applies only with --from <adapter>:<id>.`);
    return { control: arm(str(ctx, 'control'), 'control'), variant: arm(str(ctx, 'variant'), 'variant') };
  }
  if (str(ctx, 'control') !== undefined || str(ctx, 'variant') !== undefined)
    throw new JouriloError('USAGE', '--from reads the numbers itself; leave out --control and --variant.');
  const m = from.match(/^([a-z]+):(.+)$/);
  if (!m)
    throw new JouriloError(
      'USAGE',
      `--from must be <adapter>:<id>, e.g. posthog:42 (adapters: ${ADAPTERS.join(', ')}).`,
    );
  const [, name, id] = m as unknown as [string, string, string];
  // Date range and control key exist only for Amplitude; PostHog and GrowthBook analyze the whole experiment.
  const amplitudeOnly = ['start', 'end', 'control-key'].filter((k) => str(ctx, k) !== undefined);
  if (name !== 'amplitude' && amplitudeOnly.length && (ADAPTERS as readonly string[]).includes(name))
    throw new JouriloError(
      'USAGE',
      `--${amplitudeOnly[0]} applies only to amplitude; ${name} reads the experiment's own analysis window and control.`,
      'Leave it out, or change the window in the experiment itself.',
    );
  const opt = (k: string) => str(ctx, k);
  const adapter = adapterFor(name, {
    env: process.env,
    proxy: (url) => proxyFrom(ctx, url),
    ...(opt('metric') !== undefined ? { metric: opt('metric')! } : {}),
    ...(opt('start') !== undefined ? { start: opt('start')! } : {}),
    ...(opt('end') !== undefined ? { end: opt('end')! } : {}),
    ...(opt('control-key') !== undefined ? { controlKey: opt('control-key')! } : {}),
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
  const [c, v] = data.variants as [ExperimentData['variants'][0], ExperimentData['variants'][0]];
  const toArm = (x: typeof c): Arm => ({ name: x.name, visitors: x.exposures, conversions: x.conversions });
  return { control: toArm(c), variant: toArm(v), source: { adapter: adapter.name, ...data } };
}

/**
 * Fixed-horizon (one look at a planned sample) or sequential (mSPRT, valid at every look). Sequential is the default
 * with `--from`, since a live experiment is checked again and again; `--fixed` opts out. Typed-in numbers default to
 * fixed; `--sequential` opts in.
 */
function analysisMode(ctx: Context, fromAdapter: boolean): 'fixed' | 'sequential' {
  const seq = flag(ctx, 'sequential');
  const fixed = flag(ctx, 'fixed');
  if (seq && fixed) throw new JouriloError('USAGE', 'Choose one of --sequential and --fixed.');
  if (str(ctx, 'tau') !== undefined && (fixed || (!seq && !fromAdapter)))
    throw new JouriloError('USAGE', '--tau applies only to a sequential analysis (--sequential, or --from).');
  const tau = numOpt(ctx, 'tau');
  if (tau !== undefined && !(tau > 0 && tau <= 1))
    throw new JouriloError(
      'USAGE',
      '--tau must be greater than 0 and at most 1 (a spread on the difference of two rates, e.g. 0.1).',
    );
  const mode = seq ? 'sequential' : fixed ? 'fixed' : fromAdapter ? 'sequential' : 'fixed';
  if (mode === 'sequential' && str(ctx, 'planned') !== undefined)
    throw new JouriloError(
      'USAGE',
      '--planned applies only to a fixed-horizon analysis; a sequential analysis is valid at every look.',
      fromAdapter ? 'Add --fixed to analyze at the planned sample instead.' : undefined,
    );
  return mode;
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** Sequential reading: the always-valid p-value and confidence sequence replace the fixed-horizon ones. */
function sequentialAnalysis(c: Arm, v: Arm, fixed: ReturnType<typeof analyze>, tau: number) {
  const alpha = fixed.alpha;
  const s = sequentialTest(
    { n: c.visitors, x: c.conversions },
    { n: v.visitors, x: v.conversions },
    { alpha, tau },
  );
  const level = `${(1 - alpha) * 100}%`;
  const p = s.pValue < 1e-6 ? 'p < 1e-6' : `p = ${s.pValue.toPrecision(3)}`;
  const ci = `${pct(s.confidenceInterval[0])} to ${pct(s.confidenceInterval[1])}`;
  const rates = `${v.name} ${pct(fixed.variant.rate)} vs ${c.name} ${pct(fixed.control.rate)}`;
  const interpretation: string[] = [];
  // The SRM warning still applies; the planned-sample (peeking) warning does not, since every look is valid.
  if (fixed.srm.mismatch) interpretation.push(srmNote(fixed.srm));
  interpretation.push(
    s.decision === 'continue'
      ? `Continue: ${rates}, always-valid ${p} > ${alpha}; the ${level} confidence sequence for the difference (${ci}) still includes zero. Check again as data arrives; every look is allowed.`
      : `Stop: ${s.decision === 'stop-b-better' ? v.name : c.name} is better (${rates}, always-valid ${p} ≤ ${alpha}; ${level} confidence sequence for the difference ${ci}). This holds however often the experiment was checked.`,
    `Sequential test (mSPRT, mixing τ = ${tau}): valid at every look, so peeking is safe, at the cost of a wider interval than a fixed-horizon test at its planned sample. Each run is one look with no memory: once a look says stop, act on it rather than waiting for a later look to agree.`,
    GUARDRAIL_NOTE,
  );
  return {
    mode: 'sequential' as const,
    control: fixed.control,
    variant: fixed.variant,
    absoluteDiff: fixed.absoluteDiff,
    relativeLift: fixed.relativeLift,
    pValue: s.pValue,
    decision: s.decision,
    confidenceInterval: s.confidenceInterval,
    alpha,
    tau,
    srm: fixed.srm,
    interpretation,
  };
}

/** The one analysis step for both paths: run the test on the arms and format the result. */
export function analyzeArms(
  ctx: Context,
  arms: { control: Arm; variant: Arm; source?: Source },
): CommandResult {
  const { control: c, variant: v, source } = arms;
  const mode = analysisMode(ctx, source !== undefined);
  const tau = numOpt(ctx, 'tau') ?? 0.1;
  let r: ({ mode: 'fixed' } & ReturnType<typeof analyze>) | ReturnType<typeof sequentialAnalysis>;
  try {
    const fixed = analyze(c, v, analyzeOptions(ctx));
    r = mode === 'sequential' ? sequentialAnalysis(c, v, fixed, tau) : { mode, ...fixed };
  } catch (e) {
    if (e instanceof JouriloError) throw e;
    const where = source ? `${source.adapter}:${source.id}: ` : '';
    throw new JouriloError('INVALID_INPUT', `${where}${(e as Error).message}`);
  }
  const bullets = r.interpretation.map((l) => `• ${l}`);
  if (!source) return { data: r, text: bullets.join('\n') };
  return {
    data: { ...r, source },
    text: [
      `${VENDOR[source.adapter]} experiment ${source.id}, metric ${source.metric}: ${c.name} ${c.conversions}/${c.visitors}, ${v.name} ${v.conversions}/${v.visitors}`,
      ...source.notes.map((n) => `Note: ${n}`),
      ...bullets,
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
    'control-key': { type: 'string' },
    sequential: { type: 'boolean' },
    fixed: { type: 'boolean' },
    tau: { type: 'string' },
  },
  details: `Subcommands:
  size     --baseline 4% --mde 10% [--absolute] [--alpha 0.05] [--power 0.8] [--variants 2] [--daily-traffic N]
  plan     --finding <fingerprint> [--run latest] [--baseline 4%] [--mde 10%] [--daily-traffic N]
  analyze  --control 120/2400 --variant 150/2380 [--alpha 0.05] [--expected-share 0.5] [--planned N]
           [--sequential [--tau 0.1]]
  analyze  --from <adapter>:<id> [--metric M] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--control-key K]
           [--alpha …] [--expected-share …] [--tau 0.1 | --fixed [--planned N]]

analyze modes:
  fixed        one look at a planned sample: two-proportion z-test, p-value and CI. Default for --control/--variant.
  --sequential mSPRT (mixture sequential probability ratio test): an always-valid p-value and confidence sequence,
               so the experiment may be checked after every batch and stopped at the first look that says stop.
               Default with --from, since a live experiment is checked repeatedly; --fixed opts out there.
  --tau T      standard deviation of the normal mixing distribution on the difference in rates, in (0, 1]
               (default 0.1); sequential only. Each run is one look without history: once a look says stop, act on it.
  --planned N  fixed only: warns about peeking while fewer than N visitors per arm have arrived.

--from reads the numbers, read-only, from an analytics tool (keys from the environment only, never printed):
  posthog:<id|flag-key>      POSTHOG_API_KEY (personal key: experiment:read, query:read); POSTHOG_HOST
                             (default https://us.posthog.com), POSTHOG_PROJECT_ID (default @current).
                             --metric picks a primary metric by name or uuid (default: the first); funnel
                             metrics only
  growthbook:<exp_id|key>    GROWTHBOOK_API_KEY; GROWTHBOOK_HOST (default https://api.growthbook.io).
                             --metric picks a metric by id or name (default: the first goal); binomial or
                             proportion metrics only
  amplitude:<flag-key>       AMPLITUDE_API_KEY and AMPLITUDE_SECRET_KEY; AMPLITUDE_HOST (default
                             https://amplitude.com). --metric EVENT (the conversion event) and --start are
                             required; --end defaults to today; --control-key names the control variant
                             (default control). Amplitude's funnel API does not list the flag's variants, so a
                             missing third arm of a multi-arm experiment cannot be detected
--start, --end and --control-key apply only to amplitude; PostHog and GrowthBook use the experiment's own window.
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
      analysisMode(ctx, str(ctx, 'from') !== undefined); // flag mistakes fail before any request is made
      return analyzeArms(ctx, await armsFrom(ctx));
    }
    throw new JouriloError('USAGE', 'Use: experiment size | plan | analyze (see --help).');
  },
};
