import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Run } from '../../src/core/types.js';

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

describe('cli no page loaded', () => {
  it('an unresolvable host exits 5 and still writes the run', () => {
    const r = jourilo(
      'audit',
      'http://does-not-exist.invalid/',
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '--json',
      '-q',
    );
    expect(r.status).toBe(5);
    expect(r.stdout).toContain('"outcome":"no-page-loaded"');
    const out = JSON.parse(r.stdout);
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
    expect(run.outcome).toBe('no-page-loaded');
    expect(run.findings.some((f: { ruleId: string }) => f.ruleId === 'jourilo/page-unreachable')).toBe(true);
    const text = jourilo(
      'audit',
      'http://does-not-exist.invalid/',
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '-q',
    );
    expect(text.status).toBe(5);
    expect(text.stdout).toContain('No page could be loaded from http://does-not-exist.invalid/.');
  });
});

describe('cli verify against an unreachable target', () => {
  it('claims no fixes and exits 5', () => {
    const a = jourilo(
      'audit',
      'fixtures/sites/acme-saas',
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '--json',
      '-q',
    );
    expect(JSON.parse(a.stdout).findings.length).toBeGreaterThan(0);
    const runId = JSON.parse(a.stdout).runId;
    const v = jourilo('verify', runId, '--target', 'http://does-not-exist.invalid/', '--json', '-q');
    expect(v.status, v.stderr).toBe(5);
    const out = JSON.parse(v.stdout);
    expect(out.outcome).toBe('no-page-loaded');
    expect(out.fixed).toEqual([]);
    const text = jourilo('verify', runId, '--target', 'http://does-not-exist.invalid/', '-q');
    expect(text.status).toBe(5);
    expect(text.stdout).toMatch(/no comparison was possible/i);
    expect(text.stdout).not.toMatch(/fixed \d/);
  });
});

describe('cli forged guard signal', () => {
  it('still audits a page that sends the guard header itself', async () => {
    const srv = http.createServer((_req, res) => {
      res
        .writeHead(200, { 'content-type': 'text/html', 'x-jourilo-guard-upstream-error': 'forged refused' })
        .end('<!doctype html><html lang="en"><title>Hi</title><h1>Hi</h1>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as AddressInfo).port;
    try {
      const child = spawn(
        process.execPath,
        [
          cli,
          'audit',
          `http://127.0.0.1:${port}/`,
          '--pages',
          '1',
          '--viewports',
          'desktop',
          '--json',
          '-q',
          '--workspace',
          ws,
        ],
        { cwd: root },
      );
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d;
      });
      const code = await new Promise((r) => child.on('close', r));
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.outcome).toBe('complete');
      expect(out.findings.some((f: { ruleId: string }) => f.ruleId === 'jourilo/page-unreachable')).toBe(
        false,
      );
    } finally {
      srv.close();
    }
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

/** Spawns an audit with --json, sends `signal` once a progress line matches `when`, and returns the outcome. */
async function auditUntil(
  args: string[],
  when: ((msg: string) => boolean) | null,
): Promise<{
  code: number | null;
  out: { runDir: string; outcome: string };
  run: Run;
  afterSignalMs: number;
}> {
  const child = spawn(process.execPath, [cli, 'audit', ...args, '--json', '--workspace', ws], { cwd: root });
  let stdout = '';
  let buffered = '';
  let signalledAt = 0;
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    buffered += d;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      const msg = JSON.parse(line) as { type: string; message: string };
      if (!signalledAt && when && msg.type === 'progress' && when(msg.message)) {
        signalledAt = Date.now();
        child.kill('SIGTERM');
      }
    }
  });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  const out = JSON.parse(stdout);
  const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
  return { code, out, run, afterSignalMs: signalledAt ? Date.now() - signalledAt : 0 };
}

describe('cli stop early', () => {
  const site = ['fixtures/sites/acme-saas', '--pages', '6', '--viewports', 'desktop', '--no-forms'];

  it('SIGTERM during an audit writes a partial run and exits 6', async () => {
    const r = await auditUntil(site, (m) => m.startsWith('desktop') && m.includes('http'));
    expect(r.code).toBe(6);
    expect(r.out.outcome).toBe('partial');
    expect(r.run.outcome).toBe('partial');
    expect(r.run.stoppedBy).toBe('signal');
    expect(r.run.pages.length).toBeGreaterThanOrEqual(1);
    expect(r.run.pages.length).toBeLessThan(6);
    const stop = r.run.limitations.find((l) => l.startsWith('The run was stopped early'));
    const planned = (r.run.settings.scope as { urls: string[] }).urls.length;
    expect(planned).toBe(6);
    expect(stop).toMatch(new RegExp(`${planned - r.run.pages.length} of ${planned} planned page captures`));
    expect(existsSync(join(r.out.runDir, 'report.html'))).toBe(true);
  }, 120_000);

  it('--max-duration stops the run', async () => {
    const r = await auditUntil([...site, '--max-duration', '1'], null);
    expect(r.code).toBe(6);
    expect(r.run.outcome).toBe('partial');
    expect(r.run.stoppedBy).toBe('max-duration');
  }, 120_000);

  it('stop before the first page', async () => {
    // The first progress line comes once the stop handlers are in place, before the browser is up.
    const r = await auditUntil(site, () => true);
    expect(r.code).toBe(6);
    expect(r.run.outcome).toBe('partial');
    expect(r.run.stoppedBy).toBe('signal');
    expect(r.run.pages).toHaveLength(0);
    expect(r.run.limitations.some((l) => /before pages were discovered/.test(l))).toBe(true);
    expect(r.afterSignalMs).toBeLessThan(10_000);
  }, 120_000);
});

describe('cli --evidence minimal', () => {
  const site = [
    'fixtures/sites/acme-saas',
    '--pages',
    '6',
    '--viewports',
    'desktop,mobile',
    '--no-forms',
    '--no-keyboard',
  ];
  const audit = (extra: string[]) => {
    const r = spawnSync(
      process.execPath,
      [cli, 'audit', ...site, ...extra, '--json', '-q', '--workspace', ws],
      {
        encoding: 'utf8',
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const out = JSON.parse(r.stdout) as { runDir: string };
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
    const shots = join(out.runDir, 'screenshots');
    const bytes = readdirSync(shots).reduce((n, f) => n + statSync(join(shots, f)).size, 0);
    return { run, bytes, runDir: out.runDir };
  };

  it('--evidence minimal at least halves the evidence on acme-saas', () => {
    const full = audit([]);
    const min = audit(['--evidence', 'minimal']);
    console.log(
      `evidence bytes: full=${full.bytes} minimal=${min.bytes} ratio=${(min.bytes / full.bytes).toFixed(3)}`,
    );
    expect(min.bytes).toBeLessThanOrEqual(full.bytes * 0.5);
    const fps = (r: Run) => r.findings.map((f) => f.fingerprint).sort();
    expect(fps(min.run)).toEqual(fps(full.run));
    expect(min.run.settings.evidence).toBe('minimal');
    expect(full.run.settings.evidence).toBeUndefined();
    expect(min.run.limitations.some((l) => /first screen/.test(l))).toBe(true);
    // Every screenshot the run names still exists.
    for (const p of min.run.pages)
      if (p.screenshot) expect(existsSync(join(min.runDir, p.screenshot))).toBe(true);
    for (const f of min.run.findings)
      for (const e of f.evidence) if (e.file) expect(existsSync(join(min.runDir, e.file))).toBe(true);
    // Every file the manifest lists exists.
    const manifest = JSON.parse(readFileSync(join(min.runDir, 'manifest.json'), 'utf8')) as {
      files: { path: string }[];
    };
    for (const a of manifest.files) expect(existsSync(join(min.runDir, a.path))).toBe(true);
  }, 240_000);
});
