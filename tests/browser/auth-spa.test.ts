// Signed-in, client-rendered dashboard: a sign-in journey with the fixture's test account saves the session,
// audits use it to reach pages behind login, and problems that only exist there are found.
import { spawnSync } from 'node:child_process';
import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const ws = join(root, 'tests', '.tmp', 'auth-spa');
const app = 'fixtures/apps/pulse-dashboard';
const auth = join(ws, 'auth.json');

const jourilo = (...args: string[]) => {
  const r = spawnSync(process.execPath, [cli, ...args, '--workspace', ws, '--json', '-q'], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const rules = (out: { findings: { ruleId: string; url: string }[] }) =>
  out.findings.map((f) => `${f.ruleId} ${new URL(f.url).pathname}`);

beforeAll(() => {
  rmSync(ws, { recursive: true, force: true });
  spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
});

describe('signed-in SPA', () => {
  it('signs in with the test account and saves the session privately', () => {
    const out = jourilo(
      'journeys',
      'run',
      `${app}/journeys/sign-in.json`,
      '--base',
      app,
      '--var',
      'email=demo@example.test',
      '--var',
      'password=demo-password',
      '--save-auth',
      auth,
    );
    expect(out.journeys[0].status).toBe('passed');
    if (process.platform !== 'win32') expect(statSync(auth).mode & 0o777).toBe(0o600);
  });

  it('without the session, pages redirect to sign-in', () => {
    const out = jourilo('audit', app, '--url', '/analytics', '--viewports', 'desktop', '--no-forms');
    expect(out.findings.some((f: { ruleId: string }) => f.ruleId === 'jourilo/keyboard-trap')).toBe(false);
  });

  it('with the session, finds the trap, focus hidden under the help bar, and no false form finding', () => {
    const out = jourilo(
      'audit',
      app,
      '--auth',
      auth,
      '--url',
      '/analytics',
      '--url',
      '/settings',
      '--viewports',
      'desktop',
    );
    const r = rules(out);
    expect(r).toContain('jourilo/keyboard-trap /analytics');
    expect(r).toContain('jourilo/focus-obscured /analytics');
    expect(r.filter((x) => x.startsWith('ux/no-validation-feedback'))).toEqual([]);
  });

  it('measures slow interactions during a journey (lab INP)', () => {
    const out = jourilo(
      'journeys',
      'run',
      `${app}/journeys/refresh-report.json`,
      '--base',
      app,
      '--auth',
      auth,
    );
    expect(out.journeys[0].status).toBe('passed');
    expect(out.findings.map((f: { ruleId: string }) => f.ruleId)).toContain('perf/inp');
  });
});
