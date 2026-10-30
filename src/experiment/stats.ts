// Frequentist statistics for conversion experiments. Sources: docs/research/standards.md §4 (two-proportion
// sample size, peeking, SRM at p < 0.0005). Pure functions, no randomness, no data of their own.

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 via erf, |error| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('p must be in (0, 1)');
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  );
}

/** Regularized lower incomplete gamma P(a, x) (series / continued fraction, Numerical Recipes §6.2). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lnGammaA = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGammaA);
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGammaA) * h;
}

function lnGamma(z: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  z -= 1;
  let x = coef[0]!;
  for (let i = 1; i < g + 2; i++) x += coef[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Upper-tail p-value of a chi-square statistic. */
export function chiSquareP(stat: number, df: number): number {
  return 1 - gammaP(df / 2, stat / 2);
}

export interface SampleSizeInput {
  baseline: number;
  /** Minimum detectable effect: relative (0.1 = +10%) unless absolute is true. */
  mde: number;
  absolute?: boolean;
  alpha?: number;
  power?: number;
  /** Number of arms including control; alpha is Bonferroni-corrected across the treatment comparisons. */
  variants?: number;
}

export interface SampleSizeResult {
  perVariant: number;
  total: number;
  baseline: number;
  target: number;
  alpha: number;
  alphaPerComparison: number;
  power: number;
  variants: number;
}

export function sampleSize(i: SampleSizeInput): SampleSizeResult {
  const alpha = i.alpha ?? 0.05;
  const power = i.power ?? 0.8;
  const variants = Math.max(2, Math.round(i.variants ?? 2));
  if (!(i.baseline > 0 && i.baseline < 1))
    throw new RangeError('baseline must be a rate between 0 and 1 (e.g. 0.04)');
  if (!(i.mde > 0)) throw new RangeError('mde must be positive');
  const p1 = i.baseline;
  const p2 = i.absolute ? p1 + i.mde : p1 * (1 + i.mde);
  if (!(p2 > 0 && p2 < 1)) throw new RangeError('baseline + effect must stay between 0 and 1');
  const a = alpha / (variants - 1);
  const za = normInv(1 - a / 2);
  const zb = normInv(power);
  const pbar = (p1 + p2) / 2;
  const n =
    (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 /
    (p2 - p1) ** 2;
  const perVariant = Math.ceil(n);
  return {
    perVariant,
    total: perVariant * variants,
    baseline: p1,
    target: p2,
    alpha,
    alphaPerComparison: a,
    power,
    variants,
  };
}

export interface ArmData {
  name: string;
  visitors: number;
  conversions: number;
}

export interface AnalysisResult {
  control: ArmData & { rate: number };
  variant: ArmData & { rate: number };
  absoluteDiff: number;
  relativeLift: number;
  ciAbsolute: [number, number];
  ciRelative: [number, number] | null;
  z: number;
  pValue: number;
  significant: boolean;
  alpha: number;
  srm: { chiSquare: number; pValue: number; mismatch: boolean; expectedShare: number };
  /** Plain-language reading with the caveats that apply. */
  interpretation: string[];
}

export function analyze(
  control: ArmData,
  variant: ArmData,
  opts: { alpha?: number; expectedShare?: number; plannedPerVariant?: number } = {},
): AnalysisResult {
  for (const a of [control, variant]) {
    if (
      !Number.isInteger(a.visitors) ||
      !Number.isInteger(a.conversions) ||
      a.visitors <= 0 ||
      a.conversions < 0 ||
      a.conversions > a.visitors
    )
      throw new RangeError(`${a.name}: visitors must be a positive integer and 0 ≤ conversions ≤ visitors`);
  }
  const alpha = opts.alpha ?? 0.05;
  const p1 = control.conversions / control.visitors;
  const p2 = variant.conversions / variant.visitors;
  const pooled = (control.conversions + variant.conversions) / (control.visitors + variant.visitors);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / control.visitors + 1 / variant.visitors));
  const z = sePooled > 0 ? (p2 - p1) / sePooled : 0;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  const se = Math.sqrt((p1 * (1 - p1)) / control.visitors + (p2 * (1 - p2)) / variant.visitors);
  const zc = normInv(1 - alpha / 2);
  const ciAbsolute: [number, number] = [p2 - p1 - zc * se, p2 - p1 + zc * se];
  // Relative CI via the delta method on log(p2/p1); undefined when a rate is 0.
  let ciRelative: [number, number] | null = null;
  if (p1 > 0 && p2 > 0) {
    const seLog = Math.sqrt((1 - p1) / (p1 * control.visitors) + (1 - p2) / (p2 * variant.visitors));
    const l = Math.log(p2 / p1);
    ciRelative = [Math.exp(l - zc * seLog) - 1, Math.exp(l + zc * seLog) - 1];
  }
  // SRM: chi-square goodness of fit of the visitor split against the configured share.
  const share = opts.expectedShare ?? 0.5;
  const total = control.visitors + variant.visitors;
  const e1 = total * share;
  const e2 = total * (1 - share);
  const chi = (control.visitors - e1) ** 2 / e1 + (variant.visitors - e2) ** 2 / e2;
  const srmP = chiSquareP(chi, 1);
  const srm = { chiSquare: chi, pValue: srmP, mismatch: srmP < 0.0005, expectedShare: share };
  const significant = pValue < alpha;

  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const interpretation: string[] = [];
  if (srm.mismatch)
    interpretation.push(
      `Sample ratio mismatch (χ² p = ${srmP.toExponential(2)} < 0.0005): the traffic split is not what was configured. Do not trust the result until the cause (bucketing, redirects, logging) is found.`,
    );
  if (opts.plannedPerVariant && Math.min(control.visitors, variant.visitors) < opts.plannedPerVariant)
    interpretation.push(
      `Only ${Math.min(control.visitors, variant.visitors)} of the planned ${opts.plannedPerVariant} visitors per arm so far: stopping now inflates false positives (peeking). Wait for the planned sample.`,
    );
  interpretation.push(
    significant
      ? `${variant.name} converted at ${pct(p2)} vs ${pct(p1)} for ${control.name} (difference ${pct(p2 - p1)}, ${(1 - alpha) * 100}% CI ${pct(ciAbsolute[0])} to ${pct(ciAbsolute[1])}); p = ${pValue.toPrecision(3)} < ${alpha}. The difference is statistically significant for this sample.`
      : `No statistically significant difference: ${pct(p2)} vs ${pct(p1)}, p = ${pValue.toPrecision(3)} ≥ ${alpha}. The ${(1 - alpha) * 100}% CI for the difference (${pct(ciAbsolute[0])} to ${pct(ciAbsolute[1])}) includes effects of either sign or zero; "no evidence of a difference" is not evidence of no difference.`,
  );
  interpretation.push(
    'Check guardrail metrics (errors, latency, refunds, retention) before shipping; statistical significance is not business significance.',
  );
  return {
    control: { ...control, rate: p1 },
    variant: { ...variant, rate: p2 },
    absoluteDiff: p2 - p1,
    relativeLift: p1 > 0 ? p2 / p1 - 1 : Number.NaN,
    ciAbsolute,
    ciRelative,
    z,
    pValue,
    significant,
    alpha,
    srm,
    interpretation,
  };
}
