// End-to-end: real Chromium against fixture sites with seeded defects. This is the quality gate for detection:
// every seeded defect must be found, nothing may be reported on the clean control site, and root causes must
// point at the right files.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { benchFixture } from '../../src/cli/commands/bench.js';
import { Workspace } from '../../src/core/workspace.js';

const ws = join(import.meta.dirname, '..', '.tmp', 'browser-ws');

describe('fixture benchmark', () => {
  it('finds every seeded defect in acme-saas with correct root-cause files', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/acme-saas'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.sourceMisses).toEqual([]);
  });
  it('checks design consistency against a locked Markilo brand', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/brand-site'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
  });
  it('operates dialogs and disclosures with the keyboard without flagging correct ones', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/widgets-lab'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.excessDefects).toEqual([]);
    expect(r.sourceMisses).toEqual([]);
    // The keyboard walk records the element's markup, so its class and state reach source location.
    const { run } = new Workspace(ws).loadRun('latest');
    const focus = run.findings.find(
      (f) => f.ruleId === 'jourilo/focus-visible' && f.url.endsWith('/pressed-tools'),
    );
    expect(focus?.evidence[0]?.snippet).toBe('<button class="tool" aria-pressed="true">Saw');
  });
  it('applies conversion, form and field-purpose heuristics to a Turkish site', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/tr-dukkan'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
  });
  it('checks form grouping, data tables and image alternatives', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/structure-lab'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.excessDefects).toEqual([]);
  });
  it('decides contrast over images from the rendered pixels (F8)', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/contrast-lab'), ws);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.excessDefects).toEqual([]);
    const { run } = new Workspace(ws).loadRun('latest');
    const at = (path: string) =>
      run.findings.find((f) => f.ruleId === 'jourilo/contrast-over-image' && f.url.endsWith(path))
        ?.evidence[0]?.data as { worstRatio: number; bestRatio: number; required: number } | undefined;
    expect(at('/light')!.worstRatio).toBeLessThan(3);
    // Review Focus 1: the dark half passes, the light half does not; the worst case decides.
    expect(at('/mixed')!.worstRatio).toBeLessThan(3);
    expect(at('/mixed')!.bestRatio).toBeGreaterThanOrEqual(7);
  });
  it('reports no moderate-or-worse defects on the clean control site', async () => {
    const r = await benchFixture(join(import.meta.dirname, '../../fixtures/sites/clean-shop'), ws);
    expect(r.excessDefects).toEqual([]);
  });
});
