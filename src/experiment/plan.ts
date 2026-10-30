// Experiment plans from conversion hypotheses. A plan states what to change, what to measure, how much traffic it
// needs and how it will be judged — before any data exists. Numbers Jourilo does not know stay "unknown".

import type { Finding } from '../core/types.js';
import type { ProductProfile } from '../discovery/repo.js';
import { type SampleSizeResult, sampleSize } from './stats.js';

export interface ExperimentPlan {
  schemaVersion: 1;
  id: string;
  source: { runId: string; finding: string; ruleId: string; url: string };
  hypothesis: string;
  change: string;
  primaryMetric: { name: string; definition: string; events: string[] };
  guardrails: { name: string; why: string }[];
  design: {
    type: 'A/B';
    split: string;
    audience: string;
    alpha: number;
    power: number;
    mde: string;
    baseline: string;
    sampleSize: SampleSizeResult | null;
    duration: string;
    stoppingRule: string;
  };
  implementation: { tooling: string[]; notes: string[] };
  analysis: string[];
  risks: string[];
  status: 'planned';
}

const METRICS: Record<string, { name: string; definition: string; events: string[] }> = {
  'conv/no-primary-cta-above-fold': {
    name: 'Landing CTA click-through',
    definition: 'visitors who click the primary CTA ÷ visitors who view the landing page',
    events: ['landing_viewed', 'primary_cta_clicked'],
  },
  'conv/competing-ctas': {
    name: 'Primary CTA click-through',
    definition: 'clicks on the primary CTA ÷ landing views',
    events: ['landing_viewed', 'primary_cta_clicked', 'secondary_cta_clicked'],
  },
  'conv/unclear-value-proposition': {
    name: 'Landing → next step rate',
    definition: 'visitors who reach the next funnel step ÷ landing views',
    events: ['landing_viewed', 'funnel_step_2_viewed'],
  },
  'conv/vague-cta-label': {
    name: 'CTA click-through',
    definition: 'clicks on the control ÷ views of the page',
    events: ['page_viewed', 'cta_clicked'],
  },
  'conv/signup-friction': {
    name: 'Signup completion',
    definition: 'accounts created ÷ visitors who started the signup form',
    events: ['signup_form_started', 'signup_completed'],
  },
  'conv/forced-account-checkout': {
    name: 'Checkout completion',
    definition: 'orders ÷ checkout starts',
    events: ['checkout_started', 'order_completed'],
  },
  'conv/no-trust-signals': {
    name: 'Form completion',
    definition: 'form submissions ÷ form starts',
    events: ['form_started', 'form_submitted'],
  },
  'conv/pricing-period-unclear': {
    name: 'Pricing → plan selection',
    definition: 'plan selections ÷ pricing page views',
    events: ['pricing_viewed', 'plan_selected'],
  },
};

export interface PlanOptions {
  baseline?: number;
  mde?: number;
  dailyTraffic?: number;
  alpha?: number;
  power?: number;
  product?: ProductProfile | null;
}

export function planExperiment(runId: string, f: Finding, opts: PlanOptions = {}): ExperimentPlan {
  const metric = METRICS[f.ruleId] ?? {
    name: 'Primary conversion',
    definition: 'define the conversion event this change should move',
    events: ['exposure', 'conversion'],
  };
  const alpha = opts.alpha ?? 0.05;
  const power = opts.power ?? 0.8;
  let size: SampleSizeResult | null = null;
  if (opts.baseline !== undefined && opts.mde !== undefined)
    size = sampleSize({ baseline: opts.baseline, mde: opts.mde, alpha, power });
  const days = size && opts.dailyTraffic ? Math.ceil(size.total / opts.dailyTraffic) : null;
  const tooling: string[] = [];
  const p = opts.product;
  if (p) {
    for (const x of [...p.featureFlags, ...p.analytics]) tooling.push(`${x.value} (found in ${x.source})`);
  }
  const notes = tooling.length
    ? [
        'Use the existing flag/analytics tooling above for assignment and events; keep assignment server-side or before first paint to avoid flicker.',
      ]
    : [
        'No feature-flag or analytics library was detected: assignment and the events above must be added before the test can run.',
      ];
  return {
    schemaVersion: 1,
    id: `exp-${f.fingerprint}`,
    source: { runId, finding: f.fingerprint, ruleId: f.ruleId, url: f.url },
    hypothesis: `If we address "${f.title}" (${f.recommendation}), then ${metric.name.toLowerCase()} will increase, because ${f.description.replace(/\.$/, '')}.`,
    change: f.recommendation,
    primaryMetric: metric,
    guardrails: [
      {
        name: 'Downstream conversion',
        why: 'a click-through gain must not come from less qualified traffic',
      },
      { name: 'JavaScript errors and failed requests', why: 'the variant must not break the page' },
      { name: 'LCP / INP (field data where available)', why: 'the change must not slow the page' },
      { name: 'Refunds, cancellations or support contacts', why: 'catch misleading or confusing variants' },
    ],
    design: {
      type: 'A/B',
      split: '50/50, randomized per visitor',
      audience: `visitors who reach ${f.url}${f.viewport ? ` (finding seen on ${f.viewport})` : ''}`,
      alpha,
      power,
      mde:
        opts.mde !== undefined
          ? `${(opts.mde * 100).toFixed(1)}% relative`
          : 'unknown — choose the smallest effect worth shipping',
      baseline:
        opts.baseline !== undefined
          ? `${(opts.baseline * 100).toFixed(2)}% (user-supplied)`
          : 'unknown — measure the current rate first',
      sampleSize: size,
      duration: days
        ? `${days} day(s) at ${opts.dailyTraffic} eligible visitors/day; run whole weeks (at least ${Math.max(7, Math.ceil(days / 7) * 7)} days) to cover weekly cycles`
        : 'unknown — needs baseline, MDE and daily traffic',
      stoppingRule:
        'Fixed horizon: analyze once at the planned sample size. Do not stop early on significance (peeking inflates false positives) unless a guardrail is breached.',
    },
    implementation: { tooling, notes },
    analysis: [
      'Check sample ratio mismatch first (chi-square, p < 0.0005 blocks analysis): `jourilo experiment analyze … --expected-share 0.5`.',
      `Two-sided two-proportion test at α = ${alpha}; report the confidence interval of the difference, not only the p-value.`,
      'Review guardrails; segment only with pre-registered segments (device, new vs returning).',
    ],
    risks: [
      'Novelty effects can fade; consider a holdout or a longer run for UI changes.',
      'This hypothesis comes from a heuristic page analysis, not from user research or analytics; it may not be the biggest opportunity.',
    ],
    status: 'planned',
  };
}

export function planMarkdown(p: ExperimentPlan): string {
  const s = p.design.sampleSize;
  return [
    `# Experiment plan ${p.id}`,
    '',
    `Source: finding \`${p.source.finding}\` (${p.source.ruleId}) in run \`${p.source.runId}\` on ${p.source.url}`,
    '',
    '## Hypothesis',
    '',
    p.hypothesis,
    '',
    '## Primary metric',
    '',
    `**${p.primaryMetric.name}**: ${p.primaryMetric.definition}. Events: ${p.primaryMetric.events.map((e) => `\`${e}\``).join(', ')}.`,
    '',
    '## Guardrails',
    '',
    ...p.guardrails.map((g) => `- **${g.name}** — ${g.why}`),
    '',
    '## Design',
    '',
    `- ${p.design.type}, ${p.design.split}; audience: ${p.design.audience}`,
    `- α = ${p.design.alpha}, power = ${p.design.power}, baseline ${p.design.baseline}, MDE ${p.design.mde}`,
    s
      ? `- Sample size: **${s.perVariant.toLocaleString('en-US')} per variant** (${s.total.toLocaleString('en-US')} total) to detect ${(s.baseline * 100).toFixed(2)}% → ${(s.target * 100).toFixed(2)}%`
      : '- Sample size: unknown until baseline and MDE are supplied',
    `- Duration: ${p.design.duration}`,
    `- Stopping rule: ${p.design.stoppingRule}`,
    '',
    '## Implementation',
    '',
    ...(p.implementation.tooling.length ? p.implementation.tooling.map((t) => `- ${t}`) : []),
    ...p.implementation.notes.map((n) => `- ${n}`),
    '',
    '## Analysis plan',
    '',
    ...p.analysis.map((a) => `- ${a}`),
    '',
    '## Risks',
    '',
    ...p.risks.map((r) => `- ${r}`),
    '',
    '_No result exists yet. Jourilo does not predict the effect of this change._',
    '',
  ].join('\n');
}
