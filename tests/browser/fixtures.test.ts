// End-to-end: real Chromium against fixture sites with seeded defects. This is the quality gate for detection:
// every seeded defect must be found, nothing may be reported on the clean control site, and root causes must
// point at the right files.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchFixture } from '../../src/cli/commands/bench.js';

const ws = join(import.meta.dirname, '..', '.tmp', 'browser-ws');

describe('fixture benchmark', () => {
  it('finds every seeded defect in acme-saas with correct root-cause files', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/acme-saas'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.sourceMisses).toEqual([]);
  });
  it('reports no moderate-or-worse defects on the clean control site', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/clean-shop'), ws);
    expect(r.excessDefects).toEqual([]);
  });
});
