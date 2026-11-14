import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/audit/engine.js';
import { makeFinding } from '../../src/audit/finding.js';
import { finding } from '../../src/cli/commands/finding.js';
import { parse } from '../../src/cli/framework.js';
import { applyDismissals, type Dismissal, loadDismissals } from '../../src/core/dismissals.js';
import type { JouriloError } from '../../src/core/errors.js';
import type { Finding } from '../../src/core/types.js';
import { Workspace } from '../../src/core/workspace.js';
import { compareRuns } from '../../src/report/compare.js';
import { run } from '../helpers.js';

const f = (rule: string, path: string, over: Partial<Finding> = {}) =>
  ({
    ...makeFinding({
      ruleId: rule,
      title: `T ${rule}`,
      category: 'accessibility',
      kind: 'defect',
      severity: 'serious',
      confidence: 'high',
      provenance: 'measured',
      url: `https://example.test${path}`,
      viewport: 'desktop',
      description: 'd',
      impact: 'i',
      recommendation: 'r',
      standards: [],
      evidence: [],
    }),
    ...over,
  }) as Finding;

const dismissal = (x: Finding): Dismissal => ({
  fingerprint: x.fingerprint,
  ruleId: x.ruleId,
  url: x.url,
  reason: 'Decorative image, the alt text is intentionally empty.',
  by: 'user',
  at: '2026-11-03T10:00:00.000Z',
});

describe('dismissals', () => {
  it('applyDismissals moves matching findings out and keeps the rest', () => {
    const a = f('axe/a', '/');
    const b = f('axe/b', '/pricing');
    const { kept, dismissed } = applyDismissals([a, b], [dismissal(a)]);
    expect(kept.map((x) => x.fingerprint)).toEqual([b.fingerprint]);
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0]!.fingerprint).toBe(a.fingerprint);
    expect(dismissed[0]!.dismissal.reason).toContain('Decorative');
  });

  it('a dismissed finding is reported as dismissed in a comparison, not as fixed', () => {
    const a = f('axe/a', '/');
    const gone = f('axe/gone', '/');
    const base = run([a, gone], {
      pages: [{ url: 'https://example.test/', viewport: 'desktop', metrics: [] } as never],
    });
    const head = run([], {
      pages: [{ url: 'https://example.test/', viewport: 'desktop', metrics: [] } as never],
      dismissed: applyDismissals([a], [dismissal(a)]).dismissed,
    });
    const cmp = compareRuns(base, head);
    expect(cmp.fixed.map((x) => x.fingerprint)).toEqual([gone.fingerprint]);
    expect(cmp.dismissed.map((x) => x.fingerprint)).toEqual([a.fingerprint]);
  });

  describe('across a collapse (F44)', () => {
    const collapsedOver = (paths: string[]) => {
      const first = f('jourilo/console-errors', paths[0]!);
      return {
        ...first,
        fingerprint: 'collapsed00000000',
        url: `https://example.test${paths[0]}`,
        pages: paths.map((p) => `https://example.test${p}`),
      } as Finding;
    };
    const paths = ['/', '/pricing', '/about'];
    const perPage = paths.map((p) => f('jourilo/console-errors', p));

    it('old per-page dismissals dismiss the collapsed finding when every one of its pages was dismissed', () => {
      const c = collapsedOver(paths);
      const { kept, dismissed } = applyDismissals([c], perPage.map(dismissal));
      expect(kept).toEqual([]);
      expect(dismissed[0]!.fingerprint).toBe(c.fingerprint);
    });
    it('control: a page that was never dismissed keeps the collapsed finding, and another rule is unaffected', () => {
      const c = collapsedOver(paths);
      expect(applyDismissals([c], perPage.slice(0, 2).map(dismissal)).kept).toEqual([c]);
      const other = perPage.map((p) => ({ ...dismissal(p), ruleId: 'axe/other' }));
      expect(applyDismissals([c], other).kept).toEqual([c]);
    });
    it('a dismissal of a collapsed finding does not reach a single page', () => {
      const c = collapsedOver(paths);
      const d = { ...dismissal(c), pages: c.pages };
      const single = f('jourilo/console-errors', '/');
      expect(applyDismissals([single], [d]).kept).toEqual([single]);
    });
    it('compare: a base page finding now covered by a dismissed collapse is dismissed, not fixed', () => {
      const base = run(perPage, {
        pages: paths.map(
          (p) =>
            ({ url: `https://example.test${p}`, viewport: 'desktop', status: 200, metrics: [] }) as never,
        ),
      });
      const head = run([], {
        pages: base.pages,
        dismissed: applyDismissals([collapsedOver(paths)], perPage.map(dismissal)).dismissed,
      });
      const cmp = compareRuns(base, head);
      expect(cmp.fixed).toEqual([]);
      expect(cmp.dismissed).toHaveLength(3);
    });
  });

  it('a finding with the same rule at a new URL is kept and comes back as new', () => {
    const old = f('axe/a', '/');
    const moved = f('axe/a', '/new-page');
    expect(moved.fingerprint).not.toBe(old.fingerprint);
    const { kept, dismissed } = applyDismissals([moved], [dismissal(old)]);
    expect(kept).toHaveLength(1);
    expect(dismissed).toHaveLength(0);
    const page = { url: 'https://example.test/', viewport: 'desktop', metrics: [] } as never;
    const cmp = compareRuns(run([old], { pages: [page] }), run(kept, { pages: [page], dismissed: [] }));
    expect(cmp.introduced.map((x) => x.fingerprint)).toEqual([moved.fingerprint]);
    expect(cmp.dismissed).toEqual([]);
  });

  it('a corrupt dismissed.json fails fast, before any browser launches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-bad-'));
    const ws = new Workspace(dir);
    const opts = { target: 'https://example.test/' } as never;
    for (const content of ['{not json', '{"a":1}', '[{"fingerprint":"x","reason":"r"}]', '[null]']) {
      writeFileSync(join(dir, 'dismissed.json'), content);
      expect(() => loadDismissals(ws), content).toThrow(/not a valid dismissal list/);
      // runAudit reads the list before parsing the target or opening a browser.
      await expect(runAudit(ws, opts), content).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });

  it('dismiss requires a reason and an unambiguous id', async () => {
    const ws = new Workspace(mkdtempSync(join(tmpdir(), 'jourilo-dismiss-')));
    const a = f('axe/a', '/', { fingerprint: 'aaaaaaaa11111111' });
    const b = f('axe/b', '/', { fingerprint: 'aaaaaaaa22222222' });
    const r = run([a, b]);
    ws.saveRun(r);
    const exec = async (argv: string[]) => {
      const ctx = parse(finding, [...argv, '--workspace', ws.root]);
      ctx.log = () => undefined;
      return finding.run(ctx);
    };
    const fails = async (argv: string[]) => {
      try {
        await exec(argv);
      } catch (err) {
        return (err as JouriloError).code;
      }
      return 'no error';
    };
    expect(await fails(['dismiss', 'aaaaaaaa11111111', '--run', r.id])).toBe('USAGE');
    expect(await fails(['dismiss', 'aaaaaaaa', '--run', r.id, '--reason', 'intended'])).toBe('INVALID_INPUT');
    expect(await fails(['dismiss', 'aaaa', '--run', r.id, '--reason', 'intended'])).toBe('INVALID_INPUT');

    await exec(['dismiss', 'aaaaaaaa1111', '--run', r.id, '--reason', 'intended', '--by', 'agent']);
    const saved = ws.loadRun(r.id).run;
    expect(saved.findings.map((x) => x.fingerprint)).toEqual([b.fingerprint]);
    expect(saved.dismissed?.[0]?.dismissal).toMatchObject({ reason: 'intended', by: 'agent' });
    await exec(['undismiss', 'aaaaaaaa1111']);
    expect(await fails(['undismiss', 'aaaaaaaa1111'])).toBe('NOT_FOUND');
  });
});
