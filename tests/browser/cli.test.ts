import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const ws = join(root, 'tests', '.tmp', 'cli-ws');

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
});

function jourilo(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args, '--workspace', ws], { encoding: 'utf8', cwd: root });
}

describe('cli', () => {
  it('prints help and version', () => {
    expect(jourilo('--help').stdout).toContain('Usage: jourilo <command>');
    expect(jourilo('--version').stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
  it('returns stable JSON errors', () => {
    const r = jourilo('audit', 'file:///etc/passwd', '--json');
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stderr).error.code).toBe('UNSAFE_URL');
    expect(jourilo('nope').status).toBe(2);
  });
  it('audits a static directory, writes reports and gates on severity', () => {
    const r = jourilo(
      'audit',
      'fixtures/sites/acme-saas',
      '--pages',
      '1',
      '--viewports',
      'mobile',
      '--json',
      '--fail-on',
      'serious',
      '--sarif',
      '-q',
    );
    expect(r.status).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out.gateFailed).toBe(true);
    expect(existsSync(out.reports.html)).toBe(true);
    expect(existsSync(out.reports.sarif)).toBe(true);
    const html = readFileSync(out.reports.html, 'utf8');
    expect(html).toContain('Experience Observatory');
    expect(out.findings.some((f: { ruleId: string }) => f.ruleId === 'jourilo/horizontal-overflow')).toBe(
      true,
    );
    const runs = JSON.parse(jourilo('runs', '--json').stdout);
    expect(runs.length).toBeGreaterThan(0);
  });
});
