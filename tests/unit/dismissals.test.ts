import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import { finding } from '../../src/cli/commands/finding.js';
import { parse } from '../../src/cli/framework.js';
import { applyDismissals, type Dismissal } from '../../src/core/dismissals.js';
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
