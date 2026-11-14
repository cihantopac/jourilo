import { describe, expect, it } from 'vitest';
import { type SequentialResult, sequentialTest } from '../../src/experiment/stats.js';

// Seeded generator for the simulations only (mulberry32). Source code never draws random numbers.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function conversions(rand: () => number, visitors: number, rate: number): number {
  let x = 0;
  for (let i = 0; i < visitors; i++) if (rand() < rate) x++;
  return x;
}

/**
 * One simulated experiment, checked after every batch: returns the first look that said stop, or null.
 * Each look is a fresh call with the cumulative totals and the previous result, as a live check would make.
 */
function simulate(
  rand: () => number,
  rates: { a: number; b: number },
  opts: { peeks: number; batch: number; alpha: number },
): { look: number; result: SequentialResult } | null {
  const a = { n: 0, x: 0 };
  const b = { n: 0, x: 0 };
  let previous: SequentialResult | undefined;
  for (let look = 1; look <= opts.peeks; look++) {
    a.n += opts.batch;
    a.x += conversions(rand, opts.batch, rates.a);
    b.n += opts.batch;
    b.x += conversions(rand, opts.batch, rates.b);
    const result = sequentialTest(a, b, { alpha: opts.alpha, ...(previous ? { previous } : {}) });
    if (result.decision !== 'continue') return { look, result };
    previous = result;
  }
  return null;
}

describe('sequential testing (mSPRT)', () => {
  it('with no difference, 1000 simulated peeks keep the false stop rate under alpha', () => {
    const rand = mulberry32(20261113);
    const alpha = 0.05;
    const experiments = 200;
    let stops = 0;
    for (let i = 0; i < experiments; i++)
      if (simulate(rand, { a: 0.1, b: 0.1 }, { peeks: 1000, batch: 20, alpha })) stops++;
    // A fixed-horizon z-test checked at every one of these 1000 looks would stop far more often than alpha.
    expect(stops / experiments).toBeLessThan(alpha);
  });

  it.each([0.3, 0.5, 1])(
    'with no difference at small samples and tau %f, one visitor per arm per look keeps false stops under alpha',
    (tau) => {
      // The hard regime for a plug-in variance: rate 0.5, tiny n, one-sided early samples like 1/4 vs 4/4.
      const rand = mulberry32(1300 + tau * 10);
      const alpha = 0.05;
      const experiments = 1000;
      let stops = 0;
      for (let i = 0; i < experiments; i++) {
        const a = { n: 0, x: 0 };
        const b = { n: 0, x: 0 };
        for (let look = 0; look < 1000; look++) {
          a.n++;
          b.n++;
          if (rand() < 0.5) a.x++;
          if (rand() < 0.5) b.x++;
          if (sequentialTest(a, b, { alpha, tau }).decision !== 'continue') {
            stops++;
            break;
          }
        }
      }
      expect(stops / experiments).toBeLessThanOrEqual(alpha);
    },
  );

  it('a large true difference stops for the better variant', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const bBetter = simulate(rand, { a: 0.05, b: 0.1 }, { peeks: 1000, batch: 50, alpha: 0.05 });
      expect(bBetter?.result.decision).toBe('stop-b-better');
      expect(bBetter!.result.confidenceInterval[0]).toBeGreaterThan(0);
      const aBetter = simulate(rand, { a: 0.1, b: 0.05 }, { peeks: 1000, batch: 50, alpha: 0.05 });
      expect(aBetter?.result.decision).toBe('stop-a-better');
      expect(aBetter!.result.confidenceInterval[1]).toBeLessThan(0);
    }
  });

  it('chained looks equal the running minimum and intersection of independent single looks', () => {
    // The reference is computed here from memoryless calls (no `previous`), not by the code under test's own chain.
    const rand = mulberry32(42);
    const a = { n: 0, x: 0 };
    const b = { n: 0, x: 0 };
    let chained: SequentialResult | undefined;
    let minP = 1;
    let lo = -1;
    let hi = 1;
    let rose = false;
    let lastSingle = 1;
    for (let look = 0; look < 400; look++) {
      a.n += 25;
      a.x += conversions(rand, 25, 0.1);
      b.n += 25;
      b.x += conversions(rand, 25, 0.12);
      const single = sequentialTest(a, b, { alpha: 0.05 });
      if (single.pValue > lastSingle) rose = true;
      lastSingle = single.pValue;
      minP = Math.min(minP, single.pValue);
      const nlo = Math.max(lo, single.confidenceInterval[0]);
      const nhi = Math.min(hi, single.confidenceInterval[1]);
      if (nlo <= nhi) [lo, hi] = [nlo, nhi];
      chained = sequentialTest(a, b, { alpha: 0.05, ...(chained ? { previous: chained } : {}) });
      expect(chained.pValue).toBe(minP);
      expect(chained.confidenceInterval).toEqual([lo, hi]);
    }
    // One look on its own does go up and down, so the chain is doing real work.
    expect(rose).toBe(true);
    // A previous result that is worse than this look changes nothing; a better one is kept.
    const here = sequentialTest(a, b, { alpha: 0.05 });
    expect(
      sequentialTest(a, b, { alpha: 0.05, previous: { pValue: 1, confidenceInterval: [-1, 1] } }),
    ).toEqual(here);
    expect(
      sequentialTest(a, b, { alpha: 0.05, previous: { pValue: 1e-9, confidenceInterval: [0.01, 0.02] } })
        .pValue,
    ).toBe(1e-9);
  });

  it('needs a minimum sample in each arm before any stop', () => {
    // 0/1 vs 1000/1000: one arm has a single visitor. The p-value is tiny, but there is not enough data to stop.
    const tiny = sequentialTest({ n: 1, x: 0 }, { n: 1000, x: 1000 }, { alpha: 0.05 });
    expect(tiny.enoughData).toBe(false);
    expect(tiny.decision).toBe('continue');
    expect(tiny.pValue).toBeLessThan(0.05);
    // No conversions in one arm, or 99 visitors, also fall short; the floor is 100 visitors and 5 conversions.
    for (const [a, b] of [
      [
        { n: 1000, x: 0 },
        { n: 1000, x: 1000 },
      ],
      [
        { n: 1000, x: 4 },
        { n: 1000, x: 1000 },
      ],
      [
        { n: 99, x: 5 },
        { n: 1000, x: 1000 },
      ],
      [
        { n: 1000, x: 5 },
        { n: 99, x: 99 },
      ],
    ] as const) {
      const r = sequentialTest(a, b, { alpha: 0.05 });
      expect(r.enoughData).toBe(false);
      expect(r.decision).toBe('continue');
    }
    // Control: exactly at the floor, the same strong evidence does stop.
    const floor = sequentialTest({ n: 100, x: 5 }, { n: 100, x: 100 }, { alpha: 0.05 });
    expect(floor.enoughData).toBe(true);
    expect(floor.decision).toBe('stop-b-better');
    expect(sequentialTest({ n: 1000, x: 5 }, { n: 1000, x: 1000 }, { alpha: 0.05 }).decision).toBe(
      'stop-b-better',
    );
  });

  it('stops exactly when the confidence sequence excludes zero', () => {
    const cases: [number, number, number, number][] = [
      [10000, 500, 10000, 500],
      [10000, 500, 10000, 560],
      [10000, 500, 10000, 650],
      [10000, 650, 10000, 500],
      [2400, 120, 2380, 150],
      [1000, 5, 1000, 1000],
      [4, 1, 4, 4],
      [30, 0, 30, 30],
    ];
    for (const [na, xa, nb, xb] of cases) {
      const r = sequentialTest({ n: na, x: xa }, { n: nb, x: xb }, { alpha: 0.05 });
      const excludesZero = r.confidenceInterval[0] > 0 || r.confidenceInterval[1] < 0;
      // Below the minimum sample the interval may exclude zero, but the decision still says continue.
      expect(r.decision !== 'continue').toBe(excludesZero && r.enoughData);
      expect(r.pValue <= 0.05).toBe(excludesZero);
    }
  });

  it('is more conservative than the fixed-horizon test at one look, and default tau is 0.1', () => {
    // 650 vs 500 of 10000: fixed-horizon p ≈ 1e-5; the always-valid p-value pays for unlimited looks.
    const r = sequentialTest({ n: 10000, x: 500 }, { n: 10000, x: 650 }, { alpha: 0.05 });
    expect(r.pValue).toBeGreaterThan(1e-5);
    expect(r.pValue).toBeLessThan(0.05);
    expect(r.decision).toBe('stop-b-better');
    expect(sequentialTest({ n: 10000, x: 500 }, { n: 10000, x: 650 }, { alpha: 0.05, tau: 0.1 })).toEqual(r);
    // 120/2400 vs 150/2380: fixed-horizon p ≈ 0.051; not enough for a sequential stop.
    expect(sequentialTest({ n: 2400, x: 120 }, { n: 2380, x: 150 }, { alpha: 0.05 }).decision).toBe(
      'continue',
    );
  });

  it('gives no evidence only when every visitor did the same thing, and rejects impossible input', () => {
    const r = sequentialTest({ n: 100, x: 0 }, { n: 100, x: 0 }, { alpha: 0.05 });
    expect(r).toEqual({ pValue: 1, decision: 'continue', confidenceInterval: [-1, 1], enoughData: false });
    // Opposite extremes are the strongest evidence there is, not "no evidence".
    for (const [a, b, decision] of [
      [{ n: 1000, x: 5 }, { n: 1000, x: 1000 }, 'stop-b-better'],
      [{ n: 1000, x: 1000 }, { n: 1000, x: 5 }, 'stop-a-better'],
      [{ n: 120, x: 5 }, { n: 120, x: 120 }, 'stop-b-better'],
    ] as const) {
      const s = sequentialTest(a, b, { alpha: 0.05 });
      expect(s.decision).toBe(decision);
      expect(s.pValue).toBeLessThan(0.001);
    }
    // A one-sided small sample is not near-certain: 1/4 vs 4/4 (Fisher exact p ≈ 0.14) does not stop.
    expect(sequentialTest({ n: 4, x: 1 }, { n: 4, x: 4 }, { alpha: 0.05, tau: 0.3 }).decision).toBe(
      'continue',
    );
    expect(() => sequentialTest({ n: 0, x: 0 }, { n: 10, x: 1 }, { alpha: 0.05 })).toThrow(RangeError);
    expect(() => sequentialTest({ n: 10, x: 11 }, { n: 10, x: 1 }, { alpha: 0.05 })).toThrow(RangeError);
    expect(() => sequentialTest({ n: 10, x: 1 }, { n: 10, x: 1 }, { alpha: 1 })).toThrow(RangeError);
    for (const tau of [0, -0.1, 1.5, 1e200, Number.NaN])
      expect(() => sequentialTest({ n: 10, x: 1 }, { n: 10, x: 1 }, { alpha: 0.05, tau })).toThrow(
        RangeError,
      );
    expect(() =>
      sequentialTest(
        { n: 10, x: 1 },
        { n: 10, x: 1 },
        { alpha: 0.05, previous: { pValue: 2, confidenceInterval: [-1, 1] } },
      ),
    ).toThrow(RangeError);
  });
});
