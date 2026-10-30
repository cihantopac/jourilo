import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import { planExperiment, planMarkdown } from '../../src/experiment/plan.js';
import { analyze, chiSquareP, normCdf, normInv, sampleSize } from '../../src/experiment/stats.js';

describe('distributions', () => {
  it('matches known normal quantiles and CDF values', () => {
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.8)).toBeCloseTo(0.841621, 5);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 5);
    expect(normCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
  });
  it('matches chi-square tail probabilities', () => {
    expect(chiSquareP(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquareP(5.991465, 2)).toBeCloseTo(0.05, 5);
    expect(chiSquareP(12.11567, 1)).toBeCloseTo(0.0005, 5);
  });
});

describe('sample size', () => {
  // Reference values: docs/research/standards.md §4.1 (two-sided α=0.05, power 0.8).
  it.each([
    [0.05, 0.1, 31234],
    [0.05, 0.2, 8158],
    [0.1, 0.1, 14751],
  ])('baseline %f, relative MDE %f → %i per group', (b, mde, n) => {
    expect(Math.abs(sampleSize({ baseline: b, mde }).perVariant - n)).toBeLessThanOrEqual(2);
  });
  it('corrects alpha for more variants and supports absolute effects', () => {
    expect(sampleSize({ baseline: 0.05, mde: 0.1, variants: 3 }).perVariant).toBeGreaterThan(31234);
    expect(sampleSize({ baseline: 0.05, mde: 0.01, absolute: true }).target).toBeCloseTo(0.06);
    expect(() => sampleSize({ baseline: 1.2, mde: 0.1 })).toThrow();
  });
});

describe('analysis', () => {
  it('detects a clear difference and reports a CI', () => {
    const r = analyze(
      { name: 'A', visitors: 10000, conversions: 500 },
      { name: 'B', visitors: 10000, conversions: 600 },
    );
    expect(r.significant).toBe(true);
    expect(r.pValue).toBeLessThan(0.01);
    expect(r.ciAbsolute[0]).toBeGreaterThan(0);
    expect(r.relativeLift).toBeCloseTo(0.2);
    expect(r.srm.mismatch).toBe(false);
  });
  it('does not call noise a win and explains absence of evidence', () => {
    const r = analyze(
      { name: 'A', visitors: 1000, conversions: 50 },
      { name: 'B', visitors: 1000, conversions: 55 },
    );
    expect(r.significant).toBe(false);
    expect(r.interpretation.join(' ')).toMatch(/not evidence of no difference/);
  });
  it('flags sample ratio mismatch and peeking', () => {
    const r = analyze(
      { name: 'A', visitors: 10000, conversions: 500 },
      { name: 'B', visitors: 9000, conversions: 470 },
      { plannedPerVariant: 30000 },
    );
    expect(r.srm.mismatch).toBe(true);
    expect(r.interpretation[0]).toMatch(/Sample ratio mismatch/);
    expect(r.interpretation[1]).toMatch(/peeking/);
  });
  it('rejects impossible data', () => {
    expect(() =>
      analyze({ name: 'A', visitors: 10, conversions: 11 }, { name: 'B', visitors: 10, conversions: 1 }),
    ).toThrow();
  });
});

describe('plans', () => {
  const f = makeFinding({
    ruleId: 'conv/signup-friction',
    title: 'Signup form asks for more than it needs',
    category: 'conversion',
    kind: 'hypothesis',
    severity: 'moderate',
    confidence: 'medium',
    provenance: 'heuristic',
    url: 'https://a.test/signup',
    viewport: 'mobile',
    description: 'The signup form has 7 fields.',
    impact: 'Hypothesis',
    recommendation: 'Test a shorter form.',
    standards: [],
    evidence: [],
  });
  it('keeps unknowns unknown', () => {
    const p = planExperiment('run1', f);
    expect(p.design.sampleSize).toBeNull();
    expect(p.design.baseline).toMatch(/unknown/);
    expect(planMarkdown(p)).toMatch(/does not predict/);
  });
  it('computes size and duration from user-supplied numbers', () => {
    const p = planExperiment('run1', f, { baseline: 0.05, mde: 0.2, dailyTraffic: 1000 });
    expect(p.design.sampleSize!.perVariant).toBeGreaterThan(8000);
    expect(p.design.duration).toMatch(/^17 day/);
    expect(p.primaryMetric.events).toContain('signup_completed');
  });
});
