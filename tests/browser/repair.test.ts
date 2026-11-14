// The full improvement loop on a disposable git copy of the acme-saas fixture:
// audit → optimize (dry run, then apply as a transaction) → verify (fixed, no regressions) → idempotency → rollback.
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
  let firstCheckpoint = '';
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
      'jourilo/placeholder-label',
    ]);
    expect(git('status', '--short')).toBe('');
  });

  it('applies with a checkpoint, verifies improvements and no regressions', () => {
    const applied = jourilo('optimize', baseRun, '--apply');
    expect(applied.checkpoint).toBeTruthy();
    firstCheckpoint = applied.checkpoint;
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

  it('reserves image space and removes the layout shift it caused', () => {
    const run = jourilo('audit', '.', '--url', '/launch', '--runs', '3').runId;
    const plan = jourilo('optimize', run);
    expect(plan.fixes.map((f: { ruleId: string }) => f.ruleId)).toContain('jourilo/unsized-images');
    jourilo('optimize', run, '--apply', '--rule', 'jourilo/unsized-images');
    expect(readFileSync(join(app, 'launch.html'), 'utf8')).toContain('width="800" height="400"');
    const v = jourilo('verify', run);
    expect(v.fixed.map((f: { title: string }) => f.title).join(' ')).toMatch(/reserved space/);
    for (const m of v.metrics.filter((x: { name: string }) => x.name === 'CLS'))
      expect(m.after).toBeLessThan(0.02);
  });

  it('is idempotent', () => {
    const again = jourilo('optimize', baseRun, '--apply');
    expect(again.fixes).toEqual([]);
    expect(readFileSync(join(app, 'style.css'), 'utf8').match(/:focus-visible/g)?.length).toBe(3);
  });

  it('rolls back each change, newest first, without conflicts', () => {
    const cps = jourilo('runs');
    expect(cps.length).toBeGreaterThan(0);
    // `latest` is the image-size change; it touched launch.html only.
    const second = jourilo('rollback', 'latest', '--yes');
    expect(second.restored).toEqual(['launch.html']);
    // The first change: the five files of the first fix round, all still as Jourilo wrote them.
    const first = jourilo('rollback', firstCheckpoint, '--yes');
    expect(first.restored.length).toBe(5);
    expect(first.conflicts).toEqual([]);
    expect(git('status', '--short')).toBe('');
  });
});

// The two Next-3 fixers on their own fixture repo: type="button" for a typeless button that submits its form, and
// scroll-padding-top for a focused element a sticky header covers. Each: exact edit, verify shows it fixed, rollback.
describe('type="button" and scroll-padding fixers', () => {
  const tmp2 = join(root, 'tests', '.tmp', 'repair-fixers');
  const app2 = join(tmp2, 'app');
  const ws2 = join(tmp2, 'ws');
  const run2 = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--workspace', ws2, '--json', '-q'], {
      encoding: 'utf8',
      cwd: app2,
    });
    if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
  };
  const read = (f: string) => readFileSync(join(app2, f), 'utf8');
  const original: Record<string, string> = {};
  let runId = '';
  const titles = (v: { fixed: { title: string }[] }) => v.fixed.map((f) => f.title).join('\n');

  beforeAll(() => {
    rmSync(tmp2, { recursive: true, force: true });
    cpSync(join(root, 'fixtures/apps/fixer-lab'), app2, { recursive: true });
    for (const f of ['login.html', 'site.css']) original[f] = read(f);
    execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
    runId = run2('audit', '.', '--viewports', 'desktop,mobile').runId;
  });

  it('adds type="button" to the Show password button and leaves the Sign in submit alone', () => {
    const plan = run2('optimize', runId, '--rule', 'jourilo/button-implicit-submit');
    expect(plan.fixes.map((f: { ruleId: string }) => f.ruleId)).toEqual(['jourilo/button-implicit-submit']);
    expect(readFileSync(join(app2, 'login.html'), 'utf8')).toBe(original['login.html']);
    run2('optimize', runId, '--rule', 'jourilo/button-implicit-submit', '--apply');
    expect(read('login.html')).toBe(
      original['login.html']!.replace(
        '<button id="show-password" class="ghost">',
        '<button type="button" id="show-password" class="ghost">',
      ),
    );
    expect(titles(run2('verify', runId))).toMatch(/Show password|submits/i);
  });

  it('adds scroll-padding-top for the sticky header height to html in the stylesheet', () => {
    const plan = run2('optimize', runId, '--rule', 'jourilo/focus-obscured');
    expect(plan.fixes.map((f: { ruleId: string }) => f.ruleId)).toEqual(['jourilo/focus-obscured']);
    run2('optimize', runId, '--rule', 'jourilo/focus-obscured', '--apply');
    expect(read('site.css')).toBe(`${original['site.css']}\nhtml {\n  scroll-padding-top: 56px;\n}\n`);
    expect(titles(run2('verify', runId))).toMatch(/hidden behind other content/);
  });

  it('rolls both changes back byte for byte', () => {
    const second = run2('rollback', 'latest', '--yes');
    expect(second.conflicts).toEqual([]);
    const first = run2('rollback', 'latest', '--yes');
    expect(first.conflicts).toEqual([]);
    for (const f of ['login.html', 'site.css']) expect(read(f)).toBe(original[f]);
  });
});
