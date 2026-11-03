import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

describe('cli state options', () => {
  it('audits with a fixed clock and time zone', async () => {
    // Served from a throwaway local server so no fixture site (and no benchmark result) is affected.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><html lang="en"><title>x</title>
<main><h1>Clock</h1></main>
<script>document.title = new Date().getHours() + '|' + Intl.DateTimeFormat().resolvedOptions().timeZone;</script>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const child = spawn(
        process.execPath,
        [
          cli,
          'audit',
          url,
          '--pages',
          '1',
          '--viewports',
          'desktop',
          '--no-keyboard',
          '--no-forms',
          '--clock',
          '2026-11-03T22:30:00+03:00',
          '--timezone',
          'Europe/Istanbul',
          '--workspace',
          ws,
          '--json',
          '-q',
        ],
        { cwd: root },
      );
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      await new Promise((r) => child.on('close', r));
      const out = JSON.parse(stdout);
      const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
      expect(run.pages[0].title).toBe('22|Europe/Istanbul');
      expect(run.settings.timezoneId).toBe('Europe/Istanbul');
      expect(run.settings.clock).toBe('2026-11-03T22:30:00+03:00');
    } finally {
      await new Promise((r) => server.close(r));
    }
  }, 120_000);
});
