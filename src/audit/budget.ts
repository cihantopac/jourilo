import { THRESHOLDS } from '../browser/vitals.js';
import { JouriloError } from '../core/errors.js';
import type { PageCapture, Run } from '../core/types.js';

export interface BudgetSpec {
  metric: string;
  limit: number;
}

type BudgetResult = NonNullable<Run['budgets']>[number];

/** `--budget LCP=2000,CLS=0.05`: metric names follow THRESHOLDS; values are in the metric's own unit. */
export function parseBudgets(value: string | undefined): BudgetSpec[] {
  if (value === undefined) return [];
  const known = Object.keys(THRESHOLDS).join(', ');
  const usage = (why: string) =>
    new JouriloError('USAGE', `--budget ${why}`, `Example: --budget LCP=2000,CLS=0.05 (metrics: ${known}).`);
  const specs: BudgetSpec[] = [];
  for (const part of value.split(',').map((s) => s.trim())) {
    const [name = '', raw, ...rest] = part.split('=').map((s) => s.trim());
    const metric = name.toUpperCase();
    if (!(metric in THRESHOLDS)) throw usage(`has an unknown metric "${name}" (known: ${known}).`);
    const limit = Number(raw);
    if (raw === undefined || rest.length || raw === '' || !Number.isFinite(limit) || limit < 0)
      throw usage(`needs a number of 0 or more for ${metric} (got "${raw ?? ''}").`);
    if (specs.some((s) => s.metric === metric)) throw usage(`names ${metric} twice.`);
    specs.push({ metric, limit });
  }
  return specs;
}

/**
 * Compare each budget with the metric of every capture (already the median with `--runs N`); the worst capture
 * decides. A metric no capture measured is `ok: null`: it is neither a pass nor a fail.
 */
export function evaluateBudgets(pages: PageCapture[], specs: BudgetSpec[]): BudgetResult[] {
  return specs.map(({ metric, limit }) => {
    let worst: { value: number; page: PageCapture } | undefined;
    for (const page of pages) {
      const m = page.metrics.find((x) => x.name === metric);
      if (m && (!worst || m.value > worst.value)) worst = { value: m.value, page };
    }
    if (!worst) return { metric, limit, worst: null, url: null, viewport: null, ok: null };
    return {
      metric,
      limit,
      worst: worst.value,
      url: worst.page.url,
      viewport: worst.page.viewport,
      ok: worst.value <= limit,
    };
  });
}

export function budgetFailed(budgets: Run['budgets']): boolean {
  return !!budgets?.some((b) => b.ok === false);
}

export function budgetLimitation(b: BudgetResult): string {
  return `Budget ${b.metric}=${b.limit} was not checked: ${b.metric} was not measured on any page of this run${b.metric === 'INP' ? ' (it needs a real interaction, which a scripted visit does not produce)' : ''}.`;
}

/** One line for the text output and the HTML report, e.g. `Budget exceeded: LCP 4200 ms over 2000 ms (/ [mobile])`. */
export function budgetLine(b: BudgetResult): string {
  const unit = b.metric === 'CLS' ? '' : ' ms';
  if (b.ok === null) return `Budget not measured: ${b.metric} (limit ${b.limit}${unit})`;
  let path = b.url ?? '';
  try {
    path = new URL(path).pathname;
  } catch {}
  return b.ok
    ? `Budget met: ${b.metric} ${b.worst}${unit} within ${b.limit}${unit} (worst: ${path} [${b.viewport}])`
    : `Budget exceeded: ${b.metric} ${b.worst}${unit} over ${b.limit}${unit} (worst: ${path} [${b.viewport}])`;
}
