// The full improvement loop on a disposable git copy of the acme-saas fixture:
// audit → optimize (dry run, then apply with checkpoint) → verify (fixed, no regressions) → idempotency → rollback.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const tmp = join(root, 'tests', '.tmp', 'repair-loop');
const app = join(tmp, 'app');
const ws = join(tmp, 'ws');

const jourilo = (...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--workspace', ws, '--json', '-q'], {
    encoding: 'utf8',
    cwd: app,
  });
  if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const git = (...args: string[]) => execFileSync('git', args, { cwd: app, encoding: 'utf8' });

beforeAll(() => {
  rmSync(tmp, { recursive: true, force: true });
  cpSync(join(root, 'fixtures/sites/acme-saas'), app, { recursive: true });
  git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init');
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
});

describe('repair loop', () => {
  let baseRun = '';
  it('plans fixes without writing anything', () => {
    baseRun = jourilo('audit', '.', '--viewports', 'desktop,mobile').runId;
    const plan = jourilo('optimize', baseRun);
    expect(plan.applied).toBe(false);
    expect(plan.fixes.map((f: { ruleId: string }) => f.ruleId).sort()).toEqual([
      'axe/html-has-lang',
      'jourilo/focus-visible',
      'jourilo/input-purpose',
      'jourilo/missing-viewport-meta',
      'jourilo/paste-blocked',
    ]);
    expect(git('status', '--short')).toBe('');
  });

  it('applies with a checkpoint, verifies improvements and no regressions', () => {
    const applied = jourilo('optimize', baseRun, '--apply');
    expect(applied.checkpoint).toBeTruthy();
    const v = jourilo('verify', baseRun);
    expect(v.regressionFree).toBe(true);
    expect(v.introduced).toEqual([]);
    const fixedTitles = v.fixed.map((f: { title: string }) => f.title).join('\n');
    for (const t of ['lang attribute', 'focus is not visible', 'viewport meta', 'Pasting', 'autocomplete'])
      expect(fixedTitles).toContain(t);
    // charset stays first
    expect(readFileSync(join(app, 'pricing.html'), 'utf8')).toMatch(
      /<meta charset="utf-8">\n<meta name="viewport"/,
    );
  });

  it('is idempotent', () => {
    const again = jourilo('optimize', baseRun, '--apply');
    expect(again.fixes).toEqual([]);
    expect(readFileSync(join(app, 'style.css'), 'utf8').match(/:focus-visible/g)?.length).toBe(3);
  });

  it('rolls back to the checkpoint', () => {
    const cps = jourilo('runs');
    expect(cps.length).toBeGreaterThan(0);
    const r = jourilo('rollback', 'latest', '--yes');
    expect(r.restored.length).toBe(5);
    expect(git('status', '--short')).toBe('');
  });
});
