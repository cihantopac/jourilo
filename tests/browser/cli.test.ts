import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  it('--deny-local refuses local targets, as does JOURILO_DENY_LOCAL=1', () => {
    for (const t of ['localhost:3000', 'http://127.0.0.1/', 'http://[::1]/', 'http://app.test/']) {
      const r = jourilo('audit', t, '--deny-local', '--json');
      expect(r.status, t).toBe(3);
      expect(JSON.parse(r.stderr).error.code).toBe('UNSAFE_URL');
      expect(JSON.parse(r.stderr).error.message).toContain('--deny-local');
    }
    for (const value of ['1', 'true', 'yes']) {
      const r = spawnSync(
        process.execPath,
        [cli, 'discover', 'http://app.test/', '--workspace', ws, '--json'],
        { encoding: 'utf8', cwd: root, env: { ...process.env, JOURILO_DENY_LOCAL: value } },
      );
      expect(r.status, value).toBe(3);
    }
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'home.json'),
      JSON.stringify({
        version: 1,
        id: 'home',
        name: 'Home',
        start: '/',
        steps: [{ action: 'click', target: { role: 'link', name: 'Home' } }],
        success: [{ description: 'Stays home', url: '/' }],
      }),
    );
    const j = jourilo('journeys', 'run', 'home', '--base', 'http://localhost:1/', '--deny-local', '--json');
    expect(j.status).toBe(3);
  });
  it('JOURILO_DENY_LOCAL: off values allow local targets; on, yes and unrecognised values enable it (fail closed)', () => {
    for (const value of ['0', 'false', 'OFF', ' no ', 'on', 'yes', 'maybe']) {
      const r = spawnSync(
        process.execPath,
        [
          cli,
          'audit',
          'http://localhost:1/',
          '--pages',
          '1',
          '--viewports',
          'mobile',
          '--workspace',
          ws,
          '--json',
        ],
        { encoding: 'utf8', cwd: root, env: { ...process.env, JOURILO_DENY_LOCAL: value } },
      );
      const enabled = ['on', 'yes', 'maybe'].includes(value);
      if (enabled) expect(r.status, value).toBe(3);
      else expect(r.status, value).not.toBe(3);
      expect(r.stderr.includes('not recognised'), value).toBe(value === 'maybe');
      if (value === 'maybe') {
        // Under --json every stderr line stays JSON.
        for (const line of r.stderr.split('\n').filter(Boolean))
          expect(() => JSON.parse(line), line).not.toThrow();
      }
      expect(r.stdout).not.toContain('JOURILO_DENY_LOCAL');
    }
  }, 180_000);
  it('--deny-local with --browser webkit is refused up front (exit 3), before any browser starts', () => {
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'audit',
        'https://example.com/',
        '--deny-local',
        '--browser',
        'webkit',
        '--workspace',
        ws,
        '--json',
      ],
      { encoding: 'utf8', cwd: root },
    );
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('chromium or firefox');
    expect(r.stderr).not.toContain('Starting ');
  }, 60_000);
  it('--deny-local keeps confining a served directory: another loopback port is blocked, the page loads', async () => {
    const other = http.createServer((_req, res) => res.end('secret'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const port = (other.address() as AddressInfo).port;
    const dir = join(ws, 'deny-local-site');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Denied</title></head><body><main><h1>Hello</h1><script>fetch('http://127.0.0.1:${port}/').catch(()=>{})</script></main></body></html>`,
    );
    try {
      const r = await new Promise<{ status: number | null; stdout: string }>((resolve) => {
        const c = spawn(
          process.execPath,
          [
            cli,
            'audit',
            dir,
            '--pages',
            '1',
            '--viewports',
            'mobile',
            '--deny-local',
            '--json',
            '--workspace',
            ws,
          ],
          { cwd: root },
        );
        let stdout = '';
        c.stdout.on('data', (d) => (stdout += d));
        c.on('close', (status) => resolve({ status, stdout }));
      });
      expect(r.status).not.toBe(3);
      expect(r.status).not.toBe(5);
      const summary = JSON.parse(r.stdout.trim().split('\n').pop()!) as { runDir: string };
      const run = JSON.parse(readFileSync(join(summary.runDir, 'run.json'), 'utf8')) as Run;
      expect(run.pages.length).toBe(1);
      expect(run.limitations.join(' ')).toContain('--deny-local');
      expect(run.limitations.join(' ')).toContain(`127.0.0.1:${port}`);
    } finally {
      await new Promise((res) => other.close(res));
    }
  }, 180_000);
  it('without the option a local target is still allowed', () => {
    const r = jourilo('audit', 'http://localhost:1/', '--pages', '1', '--viewports', 'mobile', '--json');
    expect(r.status).not.toBe(3);
  }, 120_000);
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

describe('cli unresolvable local name', () => {
  it('an unresolvable .test name exits 5 quickly', () => {
    const t0 = Date.now();
    const r = jourilo(
      'audit',
      'http://does-not-exist.test/',
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '--json',
      '-q',
    );
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.status).toBe(5);
    expect(r.stdout).toContain('"outcome":"no-page-loaded"');
    const out = JSON.parse(r.stdout);
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
    expect(run.limitations.some((l: string) => l.includes('could not be resolved'))).toBe(true);
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
  it('verify --target that is neither a path nor an http(s) URL is INVALID_INPUT', () => {
    const vws = join(root, 'tests', '.tmp', 'cli-verify-ws');
    rmSync(vws, { recursive: true, force: true });
    mkdirSync(join(vws, 'runs', 'base-1'), { recursive: true });
    writeFileSync(
      join(vws, 'runs', 'base-1', 'run.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'base-1',
        mode: 'website',
        target: 'http://127.0.0.1:1/',
        startedAt: '2026-11-12T00:00:00.000Z',
        browser: { name: 'chromium', version: 'x' },
        viewports: [],
        settings: { scope: { urls: ['http://127.0.0.1:1/'], viewports: ['desktop'] } },
        pages: [],
        journeys: [],
        findings: [],
        limitations: [],
      }),
    );
    for (const t of ['package.json', 'no-such-dir', 'localhost:3000', 'htp://localhost:3000', 'ftp://x/']) {
      const r = spawnSync(
        process.execPath,
        [cli, 'verify', 'base-1', '--target', t, '--json', '--workspace', vws],
        { encoding: 'utf8', cwd: root },
      );
      expect(r.status, `${t}: ${r.stderr}`).toBe(2);
      const err = JSON.parse(r.stderr.trim().split('\n').pop()!).error;
      expect(err.code, t).toBe('INVALID_INPUT');
      expect(err.message, t).toContain(t);
    }
  });
});

describe('cli --run-id', () => {
  it('--run-id is refused when its directory exists', () => {
    const dir = join(ws, 'runs', 'left-by-a-crash');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'screenshots'), { recursive: true });
    writeFileSync(join(dir, 'screenshots', 'x.jpg'), 'old');
    const r = jourilo(
      'audit',
      'fixtures/sites/acme-saas',
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '--run-id',
      'left-by-a-crash',
      '--json',
    );
    expect(r.status, r.stderr).toBe(2);
    const err = JSON.parse(r.stderr.trim().split('\n').pop()!).error;
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('left-by-a-crash');
    // Untouched: no run.json, no report, no new screenshot.
    expect(readdirSync(dir)).toEqual(['screenshots']);
    expect(readdirSync(join(dir, 'screenshots'))).toEqual(['x.jpg']);
    expect(readFileSync(join(dir, 'screenshots', 'x.jpg'), 'utf8')).toBe('old');
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

describe('cli redirect loop', () => {
  it('a redirect loop is named with its chain', async () => {
    const srv = http.createServer((req, res) => {
      const next = req.url === '/a' ? '/b' : req.url === '/b' ? '/a' : '/';
      res.writeHead(req.url === '/' ? 307 : 302, { location: next }).end();
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
      expect(code).toBe(5);
      const out = JSON.parse(stdout);
      const f = out.findings.find((x: { ruleId: string }) => x.ruleId === 'jourilo/page-unreachable');
      expect(f.title).toBe('Page redirects to itself in a loop');
      expect(f.description).toContain('redirect loop');
      expect(f.description).toMatch(/307 \/ → \//);
      expect(f.recommendation).toMatch(/redirect|host/i);
    } finally {
      srv.close();
    }
  }, 120_000);
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

/** Runs `jourilo audit … --json -q` without blocking this process (the test's own servers must keep answering). */
async function auditAsync(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [cli, 'audit', ...args, '--json', '-q', '--workspace', ws], {
    cwd: root,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  return { code, stdout, stderr };
}

/** Every file of a run directory, as text (screenshots are skipped). */
function runFilesText(runDir: string): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (!/\.(jpe?g|png|zip)$/i.test(name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(runDir);
  return out.join('\n');
}

describe('cli request options (F16)', () => {
  const SECRET = 'Bearer s3cret-header-value';
  const UA = 'JouriloFieldTest/1.0 (+staging)';
  const targetSeen: { url: string; xTest?: string; auth?: string; ua?: string }[] = [];
  const otherSeen: { url: string; xTest?: string; auth?: string }[] = [];
  let target: http.Server;
  let other: http.Server;
  let result: { code: number | null; stdout: string; stderr: string };
  let run: Run;
  let runDir: string;

  beforeAll(async () => {
    other = http.createServer((req, res) => {
      otherSeen.push({
        url: req.url ?? '',
        xTest: req.headers['x-test'] as string | undefined,
        auth: req.headers.authorization,
      });
      if (req.url === '/s.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end('void 0;');
      else res.writeHead(200, { 'content-type': 'image/gif' }).end();
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    // Another origin: same host, another port.
    const otherOrigin = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    target = http.createServer((req, res) => {
      targetSeen.push({
        url: req.url ?? '',
        xTest: req.headers['x-test'] as string | undefined,
        auth: req.headers.authorization,
        ua: req.headers['user-agent'],
      });
      // A request to the target that redirects to another origin must not carry the headers there.
      if (req.url === '/away.gif') return res.writeHead(302, { location: `${otherOrigin}/landed.gif` }).end();
      // A redirect within the origin is followed too, without the headers, and listed in the limitations.
      if (req.url === '/hop.gif') return res.writeHead(302, { location: '/hop-landed.gif' }).end();
      if (req.url!.endsWith('.gif')) return res.writeHead(200, { 'content-type': 'image/gif' }).end();
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><html lang="en"><title>Headers</title><main><h1>Headers</h1>
<img src="/away.gif" alt="" width="1" height="1"><img src="/hop.gif" alt="" width="1" height="1">
<script src="${otherOrigin}/s.js"></script>
<script>document.title = navigator.userAgent;</script></main>`);
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    result = await auditAsync([
      `http://127.0.0.1:${(target.address() as AddressInfo).port}/`,
      '--pages',
      '1',
      '--viewports',
      'desktop',
      '--no-keyboard',
      '--no-forms',
      '--user-agent',
      UA,
      '--extra-header',
      'X-Test: 1',
      '--extra-header',
      `Authorization: ${SECRET}`,
    ]);
    runDir = JSON.parse(result.stdout).runDir;
    run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')) as Run;
  }, 180_000);

  afterAll(async () => {
    await new Promise((r) => target.close(r));
    await new Promise((r) => other.close(r));
  });

  it('extra headers reach only the target origin', () => {
    expect(result.code, result.stderr).toBe(0);
    const page = targetSeen.find((s) => s.url === '/');
    expect(page?.xTest).toBe('1');
    expect(page?.auth).toBe(SECRET);
    expect(targetSeen.find((s) => s.url === '/away.gif')?.xTest).toBe('1');
    // The script from the other origin, and the redirect from the target to it.
    expect(otherSeen.map((s) => s.url).sort()).toEqual(['/landed.gif', '/s.js']);
    for (const s of otherSeen) {
      expect(s.xTest, s.url).toBeUndefined();
      expect(s.auth, s.url).toBeUndefined();
    }
    expect(targetSeen.find((s) => s.url === '/hop.gif')?.xTest).toBe('1');
    expect(targetSeen.find((s) => s.url === '/hop-landed.gif')?.xTest).toBeUndefined();
    expect(
      run.limitations.some((l) => /redirect\(s\) within .*\/hop\.gif → .*\/hop-landed\.gif/.test(l)),
    ).toBe(true);
  });

  it('--user-agent is sent and recorded', () => {
    expect(targetSeen.find((s) => s.url === '/')?.ua).toBe(UA);
    expect(run.pages[0]!.title).toBe(UA);
    expect(run.settings.userAgent).toBe(UA);
  });

  it('header values are redacted in run.json settings', () => {
    expect(run.settings.extraHeaders).toEqual(['X-Test', 'Authorization']);
    expect(run.limitations.some((l) => l.includes('X-Test') && l.includes('Authorization'))).toBe(true);
    // Not in run.json, the manifest, the reports, or anything printed.
    const text = `${runFilesText(runDir)}\n${result.stdout}\n${result.stderr}`;
    expect(text).not.toContain('s3cret-header-value');
    expect(readFileSync(join(runDir, 'manifest.json'), 'utf8')).not.toContain('s3cret');
  });

  it('verify asks for the headers again: their values were never stored', () => {
    const r = jourilo('verify', run.id, '--json');
    expect(r.status).toBe(2);
    const err = JSON.parse(r.stderr.trim().split('\n').pop()!).error;
    expect(err.code).toBe('USAGE');
    expect(err.message).toContain('X-Test, Authorization');
    expect(r.stderr).not.toContain('s3cret');
  });
});

describe('cli --extra-header against an unreachable target (F16)', () => {
  it('an unreachable target with --extra-header exits 5 with no-page-loaded, not a "loaded" 502', async () => {
    // A port that was open a moment ago and is closed now: the guard's connection is refused.
    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', () => r()));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((r) => probe.close(r));
    for (const scheme of ['https', 'http']) {
      const r = await auditAsync([
        `${scheme}://127.0.0.1:${port}/`,
        '--pages',
        '1',
        '--viewports',
        'desktop',
        '--no-keyboard',
        '--no-forms',
        '--extra-header',
        'X-Test: s3cret-unreachable',
      ]);
      expect(r.code, `${scheme}: ${r.stderr}`).toBe(5);
      const out = JSON.parse(r.stdout);
      expect(out.outcome, scheme).toBe('no-page-loaded');
      const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
      expect(
        run.pages.every((p) => p.status === null || p.status < 400),
        scheme,
      ).toBe(true);
      expect(`${r.stdout}${r.stderr}${runFilesText(out.runDir)}`).not.toContain('s3cret-unreachable');
    }
  }, 240_000);
});

describe('cli --ignore-https-errors (F16)', () => {
  it('--ignore-https-errors audits a self-signed local https server and adds a limitation', async () => {
    const certs = join(root, 'tests', 'certs');
    const server = https.createServer(
      {
        key: readFileSync(join(certs, 'localhost-key.pem')),
        cert: readFileSync(join(certs, 'localhost-cert.pem')),
      },
      (_req, res) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<!doctype html><html lang="en"><title>TLS</title><main><h1>Self-signed</h1></main>');
      },
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const args = [url, '--pages', '1', '--viewports', 'desktop', '--no-keyboard', '--no-forms'];
      // Without the flag the certificate is refused: no page loaded.
      const refused = await auditAsync(args);
      expect(refused.code, refused.stderr).toBe(5);
      expect(JSON.parse(refused.stdout).outcome).toBe('no-page-loaded');

      const accepted = await auditAsync([...args, '--ignore-https-errors']);
      expect(accepted.code, accepted.stderr).toBe(0);
      const out = JSON.parse(accepted.stdout);
      expect(out.outcome).toBe('complete');
      const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
      expect(run.pages[0]!.title).toBe('TLS');
      expect(run.settings.ignoreHttpsErrors).toBe(true);
      expect(run.limitations.some((l) => /--ignore-https-errors/.test(l) && /certificate/i.test(l))).toBe(
        true,
      );
    } finally {
      await new Promise((r) => server.close(r));
    }
  }, 240_000);
});

describe('cli --chromium-sandbox and browser.pids (F21)', () => {
  const posix = process.platform !== 'win32';
  const sandboxWs = join(root, 'tests', '.tmp', 'sandbox-ws');
  let site: http.Server;
  let release: () => void = () => undefined;
  let held: Promise<void>;
  let url: string;

  beforeAll(async () => {
    rmSync(sandboxWs, { recursive: true, force: true });
    site = http.createServer((req, res) => {
      const send = () =>
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end('<!doctype html><html lang="en"><title>Held</title><main><h1>Held</h1></main>');
      // The page answers only when the test lets it, so the browser is alive while the test looks at it.
      if (req.url === '/') void held.then(send);
      else res.writeHead(404).end();
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    release();
    await new Promise((r) => site.close(r));
  });

  const commandLine = (pid: number) =>
    execFileSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  /** Starts an audit that is held at its first page; returns the browser's pids once the file appears. */
  async function holdAudit(extra: string[]) {
    held = new Promise<void>((r) => {
      release = r;
    });
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
        '--json',
        '-q',
        '--workspace',
        sandboxWs,
        ...extra,
      ],
      { cwd: root },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    const closed = new Promise<number | null>((r) => child.on('close', r));
    const runs = join(sandboxWs, 'runs');
    const deadline = Date.now() + 90_000;
    let file = '';
    while (!file && Date.now() < deadline) {
      for (const id of existsSync(runs) ? readdirSync(runs) : []) {
        const f = join(runs, id, 'browser.pids');
        if (existsSync(f)) file = f;
      }
      if (!file) await new Promise((r) => setTimeout(r, 100));
    }
    if (!file) {
      child.kill('SIGKILL');
      throw new Error(`browser.pids never appeared: ${stderr}`);
    }
    const pids = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(Number);
    return { file, pids, closed, result: () => ({ stdout, stderr }) };
  }

  it.skipIf(!posix)(
    '--chromium-sandbox launches without --no-sandbox; the default keeps it',
    async (t) => {
      // Some Linux CI kernels deny unprivileged user namespaces, so Chromium cannot start sandboxed there:
      // detect that by launching it, instead of assuming a platform.
      const { chromium } = await import('playwright-core');
      const probe = await chromium.launch({ chromiumSandbox: true }).catch(() => undefined);
      if (!probe) return t.skip();
      await probe.close();
      const plain = await holdAudit([]);
      expect(commandLine(plain.pids[0]!)).toContain('--no-sandbox');
      release();
      expect(await plain.closed, plain.result().stderr).toBe(0);

      const sandboxed = await holdAudit(['--chromium-sandbox']);
      const line = commandLine(sandboxed.pids[0]!);
      release();
      const code = await sandboxed.closed;
      expect(line).not.toContain('--no-sandbox');
      expect(code, sandboxed.result().stderr).toBe(0);
      const out = JSON.parse(sandboxed.result().stdout);
      const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
      expect(run.settings.chromiumSandbox).toBe(true);
    },
    240_000,
  );

  it('--chromium-sandbox with Firefox is a usage error', () => {
    const r = jourilo('audit', url, '--browser', 'firefox', '--chromium-sandbox', '--json');
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stderr.trim().split('\n').pop()!).error.message).toContain('--chromium-sandbox');
  });

  it('browser.pids lists live browser processes during the run and is gone after it', async () => {
    const live = await holdAudit([]);
    expect(live.pids.length).toBeGreaterThan(0);
    if (posix) for (const pid of live.pids) expect(alive(pid), `pid ${pid}`).toBe(true);
    release();
    expect(await live.closed, live.result().stderr).toBe(0);
    const out = JSON.parse(live.result().stdout);
    expect(existsSync(live.file)).toBe(false);
    const manifest = JSON.parse(readFileSync(join(out.runDir, 'manifest.json'), 'utf8')) as {
      files: { path: string }[];
    };
    expect(manifest.files.some((f) => f.path === 'browser.pids')).toBe(false);
    if (posix) for (const pid of live.pids) expect(alive(pid), `pid ${pid}`).toBe(false);
  }, 240_000);
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

interface TimedAudit {
  code: number | null;
  stdout: string;
  /** Every stderr line, parsed (all are JSON with --json). */
  lines: { type: string; message?: string; error?: { code: string; message: string } }[];
  wallMs: number;
  /** From spawn until the browser is up (the first progress line after "Starting …"). */
  launchMs: number;
  /** From the first signal until the process ended (0 without a signal). */
  afterSignalMs: number;
  /** Browser profiles left in the run's own temp directory and processes still using it. */
  leftovers: string[];
}

/**
 * Spawns an audit with --json and its own temp directory, so the browser profile Playwright creates there (and
 * every process started with it) belongs to this run alone. `signalWhen` decides, per progress line, whether to send
 * SIGTERM; it may fire more than once.
 */
async function timedAudit(
  args: string[],
  signalWhen?: (msg: string, signalsSent: number) => boolean,
): Promise<TimedAudit> {
  const tmp = mkdtempSync(join(root, 'tests', '.tmp', 'stop-tmp-'));
  const t0 = Date.now();
  const child = spawn(process.execPath, [cli, 'audit', ...args, '--json', '--workspace', ws], {
    cwd: root,
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp },
  });
  let stdout = '';
  let buffered = '';
  let starting = false;
  let launchMs = 0;
  let signals = 0;
  let signalledAt = 0;
  const lines: TimedAudit['lines'] = [];
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  child.stderr.on('data', (d) => {
    buffered += d;
    const parts = buffered.split('\n');
    buffered = parts.pop() ?? '';
    for (const part of parts) {
      let msg: TimedAudit['lines'][number];
      try {
        msg = JSON.parse(part) as TimedAudit['lines'][number];
      } catch {
        msg = { type: 'raw', message: part };
      }
      lines.push(msg);
      if (msg.type !== 'progress') continue;
      if (starting && !launchMs) launchMs = Date.now() - t0;
      if (msg.message?.startsWith('Starting ')) starting = true;
      if (signalWhen?.(msg.message ?? '', signals)) {
        signals++;
        signalledAt ||= Date.now();
        child.kill('SIGTERM');
      }
    }
  });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  const end = Date.now();
  if (buffered.trim()) lines.push(JSON.parse(buffered));
  const leftovers = readdirSync(tmp).filter((n) => n.startsWith('playwright'));
  if (process.platform !== 'win32') {
    const p = spawnSync('pgrep', ['-f', tmp], { encoding: 'utf8' });
    if (p.stdout?.trim()) leftovers.push(`processes ${p.stdout.trim().split('\n').join(', ')}`);
  }
  rmSync(tmp, { recursive: true, force: true });
  return {
    code,
    stdout,
    lines,
    wallMs: end - t0,
    launchMs,
    afterSignalMs: signalledAt ? end - signalledAt : 0,
    leftovers,
  };
}

/** A local site whose `/` page holds a required-field form and an image; `hang` decides which image requests never end. */
async function slowSite(hang: (n: number) => boolean) {
  let images = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }).end(
        `<!doctype html><html lang="en"><title>Sign in</title><main><h1>Sign in</h1>
<img src="/pixel.svg" width="10" height="10" alt="">
<form action="/login" method="post"><label>Email <input type="email" name="email" autocomplete="email" required></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required></label>
<button type="submit">Sign in</button></form></main></html>`,
      );
    } else if (req.url === '/pixel.svg') {
      // Never answered: the page's load event waits for it.
      if (hang(++images)) return;
      res
        .writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
        .end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return {
    url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`,
    close: () =>
      new Promise((r) => {
        srv.closeAllConnections();
        srv.close(r);
      }),
  };
}

describe('cli stop early', () => {
  const site = ['fixtures/sites/acme-saas', '--pages', '6', '--viewports', 'desktop', '--no-forms'];

  // Windows has no POSIX signals: a SIGTERM from another process ends it at once, with no handler.
  it.skipIf(process.platform === 'win32')(
    'SIGTERM during an audit writes a partial run and exits 6',
    async () => {
      // Stop when the second page starts, so the first one is complete: the page in progress gets only
      // STOP_GRACE_MS, and acme-saas's slow assets can take longer than that on a slow runner.
      let started = 0;
      const r = await auditUntil(
        site,
        (m) => m.startsWith('desktop') && m.includes('http') && ++started === 2,
      );
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
    },
    120_000,
  );

  it('--max-duration stops the run', async () => {
    const r = await auditUntil([...site, '--max-duration', '1'], null);
    expect(r.code).toBe(6);
    expect(r.run.outcome).toBe('partial');
    expect(r.run.stoppedBy).toBe('max-duration');
  }, 120_000);

  it('--max-duration stops within 5 s of the limit', async () => {
    // acme-saas with forms on: slow assets (up to 4.3 s) and form probes are in progress when the limit is reached.
    const r = await timedAudit([
      'fixtures/sites/acme-saas',
      '--pages',
      '6',
      '--viewports',
      'desktop',
      '--max-duration',
      '3',
    ]);
    console.log(`--max-duration 3: wall ${r.wallMs} ms, launch ${r.launchMs} ms`);
    expect(r.code).toBe(6);
    expect(JSON.parse(r.stdout).stoppedBy).toBe('max-duration');
    expect(r.launchMs).toBeGreaterThan(0);
    expect(r.wallMs).toBeLessThan((3 + 5) * 1000 + r.launchMs);
    expect(r.leftovers).toEqual([]);
  }, 120_000);

  it('--max-duration abandons a page that does not finish loading', async () => {
    const site = await slowSite(() => true);
    try {
      const r = await timedAudit([site.url, '--url', '/', '--viewports', 'desktop', '--max-duration', '3']);
      console.log(`--max-duration 3 on a hanging page: wall ${r.wallMs} ms, launch ${r.launchMs} ms`);
      expect(r.code).toBe(6);
      expect(r.wallMs).toBeLessThan((3 + 5) * 1000 + r.launchMs);
      expect(r.leftovers).toEqual([]);
      const out = JSON.parse(r.stdout) as { runDir: string };
      const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as Run;
      expect(run.stoppedBy).toBe('max-duration');
      // The abandoned page is left out, and the limitation counts it as not audited.
      expect(run.pages).toEqual([]);
      expect(run.limitations.some((l) => l.includes('1 of 1 planned page captures'))).toBe(true);
      expect(readdirSync(join(out.runDir, 'screenshots'))).toEqual([]);
    } finally {
      await site.close();
    }
  }, 120_000);

  it.skipIf(process.platform === 'win32')(
    'a stop during a form probe ends within 5 s',
    async () => {
      // The capture loads the image; the form probe's own visit waits for it forever.
      const site = await slowSite((n) => n > 1);
      try {
        const r = await timedAudit(
          [site.url, '--url', '/', '--viewports', 'desktop', '--no-keyboard'],
          (m, sent) => sent === 0 && m.startsWith('form'),
        );
        console.log(`stop during a form probe: ${r.afterSignalMs} ms after the signal`);
        expect(r.code).toBe(6);
        expect(r.afterSignalMs).toBeGreaterThan(0);
        expect(r.afterSignalMs).toBeLessThan(5000);
        expect(r.leftovers).toEqual([]);
        const run = JSON.parse(readFileSync(join(JSON.parse(r.stdout).runDir, 'run.json'), 'utf8')) as Run;
        expect(run.stoppedBy).toBe('signal');
        expect(run.pages).toHaveLength(1);
      } finally {
        await site.close();
      }
    },
    120_000,
  );

  it.skipIf(process.platform === 'win32')(
    'a second signal prints a line before exiting 130',
    async () => {
      const r = await timedAudit(
        ['fixtures/sites/acme-saas', '--pages', '6', '--viewports', 'desktop', '--no-forms'],
        (m, sent) => (sent === 0 && m.startsWith('desktop')) || (sent === 1 && m.startsWith('Stopping')),
      );
      expect(r.code).toBe(130);
      expect(r.stdout).toBe('');
      const last = r.lines.at(-1)!;
      expect(last.type).toBe('error');
      expect(last.error?.code).toBe('STOPPED_TWICE');
      expect(last.error?.message).toMatch(/second stop signal/i);
      expect(r.leftovers).toEqual([]);
    },
    120_000,
  );

  it.skipIf(process.platform === 'win32')(
    'stop before the first page',
    async () => {
      // The first progress line comes once the stop handlers are in place, before the browser is up.
      const r = await auditUntil(site, () => true);
      expect(r.code).toBe(6);
      expect(r.run.outcome).toBe('partial');
      expect(r.run.stoppedBy).toBe('signal');
      expect(r.run.pages).toHaveLength(0);
      expect(r.run.limitations.some((l) => /before pages were discovered/.test(l))).toBe(true);
      expect(r.afterSignalMs).toBeLessThan(10_000);
    },
    120_000,
  );
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

  it('every capture records its first-screen file', () => {
    for (const mode of ['full', 'minimal']) {
      const { run, runDir } = audit(['--evidence', mode]);
      expect(run.pages.length).toBeGreaterThan(0);
      for (const p of run.pages) {
        expect(p.foldScreenshot, `${p.url} ${p.viewport} (${mode})`).toBeTruthy();
        expect(existsSync(join(runDir, p.foldScreenshot!))).toBe(true);
      }
      if (mode === 'minimal') {
        const single = run.pages.filter((p) => p.foldScreenshot === p.screenshot);
        expect(single.length).toBeGreaterThan(0);
      }
    }
  }, 240_000);

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
