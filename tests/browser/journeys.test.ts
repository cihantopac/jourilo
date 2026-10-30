// Journeys end-to-end on the acme-saas fixture: suggestion derives the expected journeys from real pages, the
// runner reports real outcomes, and the safety policy blocks risky steps.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const ws = join(root, 'tests', '.tmp', 'journeys-ws');

const jourilo = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args, '--workspace', ws, '--json', '-q'], {
    encoding: 'utf8',
    cwd: root,
  });

beforeAll(() => {
  rmSync(ws, { recursive: true, force: true });
  spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
});

describe('journeys', () => {
  it('suggests journeys from the pages it found', () => {
    const r = jourilo('journeys', 'suggest', 'fixtures/sites/acme-saas');
    expect(r.status, r.stderr).toBe(0);
    const ids = JSON.parse(r.stdout).journeys.map((j: { id: string }) => j.id);
    expect(ids).toEqual(
      expect.arrayContaining(['landing-primary-cta', 'signup-signup', 'login-login', 'pricing-to-signup']),
    );
  });

  it('runs them and reports real outcomes with evidence', () => {
    const r = jourilo(
      'journeys',
      'run',
      'login-login',
      'pricing-to-signup',
      'signup-signup',
      '--base',
      'fixtures/sites/acme-saas',
    );
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const status = Object.fromEntries(
      out.journeys.map((j: { id: string; status: string }) => [j.id, j.status]),
    );
    expect(status).toEqual({
      'login-login': 'passed',
      'pricing-to-signup': 'passed',
      'signup-signup': 'failed',
    });
    const signup = out.journeys.find((j: { id: string }) => j.id === 'signup-signup');
    expect(signup.steps.every((s: { screenshot?: string }) => s.screenshot)).toBe(true);
    // Password values never appear in step descriptions.
    expect(JSON.stringify(signup.steps)).not.toMatch(/Jr-/);
    expect(out.findings.some((f: { ruleId: string }) => f.ruleId === 'journey/failed')).toBe(true);
  });

  it('blocks payment actions unless explicitly allowed on a local host', () => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'pay.json'),
      JSON.stringify({
        version: 1,
        id: 'pay',
        name: 'Pay for the Starter plan (sandbox)',
        start: '/checkout',
        steps: [
          { action: 'fill', target: { label: 'Card number' }, value: '{{testCard}}' },
          { action: 'click', target: { role: 'button', name: 'Pay $19' } },
        ],
        success: [{ description: 'Arrives at the dashboard', url: '/dashboard' }],
      }),
    );
    const blocked = JSON.parse(
      jourilo('journeys', 'run', 'pay', '--base', 'fixtures/sites/acme-saas').stdout,
    );
    expect(blocked.journeys[0].status).toBe('blocked');
    expect(blocked.journeys[0].steps[2].error).toMatch(/--allow-destructive/);
    expect(blocked.findings.some((f: { ruleId: string }) => f.ruleId === 'journey/blocked-by-policy')).toBe(
      true,
    );
    const allowed = JSON.parse(
      jourilo('journeys', 'run', 'pay', '--base', 'fixtures/sites/acme-saas', '--allow-destructive').stdout,
    );
    expect(allowed.journeys[0].status).toBe('passed');
  });

  it('blocks a Turkish payment action ("Ödemeyi tamamla") on a local host by default', () => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'odeme.json'),
      JSON.stringify({
        version: 1,
        id: 'odeme',
        name: 'Siparişi tamamla',
        start: '/odeme',
        steps: [{ action: 'click', target: { role: 'link', name: 'Ödemeyi tamamla' } }],
        success: [{ description: 'Teşekkürler sayfası', url: '/tesekkurler' }],
      }),
    );
    const out = JSON.parse(jourilo('journeys', 'run', 'odeme', '--base', 'fixtures/sites/tr-dukkan').stdout);
    expect(out.journeys[0].status).toBe('blocked');
  });

  it('rejects invalid journey files with clear messages', () => {
    const invalid = join(ws, 'invalid.json');
    writeFileSync(
      invalid,
      JSON.stringify({ version: 1, id: 'Bad Id', name: 'x', start: '/', steps: [], success: [] }),
    );
    const v = jourilo('journeys', 'validate', invalid);
    expect(v.status).toBe(2);
    const msg = JSON.parse(v.stderr).error.message;
    expect(msg).toMatch(/id must be/);
    expect(msg).toMatch(/success must/);
  });
});
