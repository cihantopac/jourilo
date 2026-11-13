import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import { runs as runsCommand } from '../../src/cli/commands/runs.js';
import { parse } from '../../src/cli/framework.js';
import type { Finding, PageCapture, Run } from '../../src/core/types.js';
import { Workspace } from '../../src/core/workspace.js';
import { trendReport, trendSlice, trends } from '../../src/report/trends.js';
import { run } from '../helpers.js';

const TARGET = 'https://example.test/';
const defect = (path: string, viewport: string, severity: Finding['severity'], n: number): Finding =>
  ({
    ...makeFinding({
      ruleId: 'axe/x',
      title: `T ${n}`,
      category: 'accessibility',
      kind: 'defect',
      severity,
      confidence: 'high',
      provenance: 'measured',
      url: `https://example.test${path}`,
      viewport,
      description: 'd',
      impact: 'i',
      recommendation: 'r',
      standards: [],
      evidence: [],
      key: `${path}${viewport}${n}`,
    }),
  }) as Finding;

const page = (path: string, viewport: string, lcp?: number, status: number | null = 200): PageCapture =>
  ({
    url: `https://example.test${path}`,
    finalUrl: `https://example.test${path}`,
    status,
    title: 't',
    viewport,
    loadMs: 10,
    metrics: lcp === undefined ? [] : [{ name: 'LCP', value: lcp, unit: 'ms', source: 'lab' }],
    consoleErrors: 0,
    failedRequests: 0,
  }) as PageCapture;

const mk = (id: string, at: string, pages: PageCapture[], findings: Finding[], over: Partial<Run> = {}) =>
  run(findings, { id, startedAt: at, pages, ...over });

describe('trends', () => {
  it('trends normalize by captures and skip partial runs', () => {
    const a = mk(
      'r1',
      '2026-11-01T10:00:00Z',
      [page('/', 'desktop', 2000), page('/', 'mobile', 3000)],
      [
        defect('/', 'desktop', 'serious', 1),
        defect('/', 'desktop', 'minor', 2),
        defect('/', 'mobile', 'minor', 3),
      ],
    );
    // Same page captured twice (two visits): the count is divided by the captures.
    const b = mk(
      'r2',
      '2026-11-02T10:00:00Z',
      [page('/', 'desktop', 1800), page('/', 'desktop', 1900), page('/about', 'desktop')],
      [defect('/', 'desktop', 'serious', 1), defect('/', 'desktop', 'minor', 2)],
    );
    const partial = mk('r3', '2026-11-03T10:00:00Z', [page('/', 'desktop', 9000)], [], {
      stoppedBy: 'signal',
    });
    const empty = mk('r4', '2026-11-04T10:00:00Z', [page('/', 'desktop', undefined, null)], [], {
      outcome: 'no-page-loaded',
    });
    const other = mk('r5', '2026-11-05T10:00:00Z', [page('/', 'desktop', 1)], [], {
      target: 'https://other.test/',
    });
    const all = [partial, b, other, empty, a].map(trendSlice);

    const report = trendReport(all, { target: TARGET });
    expect(report.used).toBe(2);
    expect(report.skipped).toBe(2);
    const rows = trends(all, { target: TARGET });
    expect(rows.map((r) => `${r.url} ${r.viewport}`)).toEqual([
      'https://example.test/ desktop',
      'https://example.test/ mobile',
      'https://example.test/about desktop',
    ]);
    const home = rows[0]!;
    expect(home.points.map((p) => p.runId)).toEqual(['r1', 'r2']);
    expect(home.points.map((p) => p.defectsPerCapture)).toEqual([2, 1]);
    expect(home.points.map((p) => p.serious)).toEqual([1, 0.5]);
    expect(home.points.map((p) => p.lcp)).toEqual([2000, 1800]);
    expect(home.points[0]!.cls).toBeNull();
  });

  it('runs trend --json lists one row per page and viewport', async () => {
    const ws = new Workspace(mkdtempSync(join(tmpdir(), 'jourilo-trend-')));
    ws.saveRun(
      mk(
        '20261101-100000-aaaaaa',
        '2026-11-01T10:00:00Z',
        [page('/', 'desktop', 2000), page('/', 'mobile', 2500)],
        [defect('/', 'desktop', 'serious', 1)],
      ),
    );
    ws.saveRun(
      mk(
        '20261102-100000-bbbbbb',
        '2026-11-02T10:00:00Z',
        [page('/', 'desktop', 1500), page('/', 'mobile', 2400)],
        [],
      ),
    );
    ws.saveRun(
      mk('20261103-100000-cccccc', '2026-11-03T10:00:00Z', [page('/', 'desktop', 1)], [], {
        stoppedBy: 'max-duration',
      }),
    );
    const exec = async (argv: string[]) => {
      const ctx = parse(runsCommand, [...argv, '--workspace', ws.root]);
      ctx.log = () => undefined;
      return runsCommand.run(ctx);
    };
    const res = await exec(['trend', '--json']);
    const data = res.data as {
      target: string;
      used: number;
      skipped: number;
      rows: { viewport: string; points: unknown[] }[];
    };
    expect(data.target).toBe(TARGET);
    expect(data.used).toBe(2);
    expect(data.skipped).toBe(1);
    expect(data.rows).toHaveLength(2);
    expect(data.rows.map((r) => r.viewport)).toEqual(['desktop', 'mobile']);
    expect(data.rows.every((r) => r.points.length === 2)).toBe(true);
    expect(res.text).toContain('1 partial or empty run(s) left out');
    expect(res.text).toContain('2000 → 1500');
    const plain = (await exec([])).data as Record<string, unknown>[];
    expect(plain.map((r) => r.id)).toEqual([
      '20261101-100000-aaaaaa',
      '20261102-100000-bbbbbb',
      '20261103-100000-cccccc',
    ]);
    for (const r of plain) {
      expect(Object.keys(r).sort()).toEqual(
        ['defects', 'findings', 'id', 'journeys', 'kinds', 'pages', 'startedAt', 'target'].sort(),
      );
    }
    expect(Object.hasOwn(ws.listRuns()[0]!, 'trend')).toBe(false);
    expect(ws.listRuns({ trend: true })[0]!.trend?.id).toBe('20261101-100000-aaaaaa');
    // --target picks another target; one with no runs is empty, and skips nothing.
    const none = (await exec(['trend', '--target', 'https://nothing.test/', '--json'])).data;
    expect(none).toEqual({ target: 'https://nothing.test/', rows: [], used: 0, skipped: 0 });
    await expect(exec(['bogus'])).rejects.toMatchObject({ code: 'USAGE' });
  });

  it('counts a finding without a viewport at every viewport of its page', () => {
    const noViewport = { ...defect('/', 'desktop', 'serious', 9), viewport: undefined } as Finding;
    const a = mk('r1', '2026-11-01T10:00:00Z', [page('/', 'desktop'), page('/', 'mobile')], [noViewport]);
    const b = mk('r2', '2026-11-02T10:00:00Z', [page('/', 'desktop'), page('/', 'mobile')], []);
    const rows = trends([a, b].map(trendSlice), { target: TARGET });
    expect(rows.map((r) => [r.viewport, r.points.map((p) => p.defectsPerCapture)])).toEqual([
      ['desktop', [1, 0]],
      ['mobile', [1, 0]],
    ]);
  });

  it('says nothing for a workspace without runs', async () => {
    const ws = new Workspace(mkdtempSync(join(tmpdir(), 'jourilo-trend-')));
    const ctx = parse(runsCommand, ['trend', '--json', '--workspace', ws.root]);
    ctx.log = () => undefined;
    const res = await runsCommand.run(ctx);
    expect(res.data).toEqual({ target: null, rows: [], used: 0, skipped: 0 });
  });
});
