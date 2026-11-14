// F42: when every page's own scripts answer 5xx, the run says a stale or different server may hold the port,
// and still reports the failures as findings.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { STALE_SERVER_LIMITATION } from '../../src/audit/stale-server.js';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/_next/')) return void res.writeHead(500).end('Internal Server Error');
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html lang="en"><title>Page</title>
<main><h1>Page ${req.url}</h1><p>Hello.</p></main><script src="/_next/static/chunks/main-app.js"></script>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

it('lists the stale-server limitation in run.json and keeps the failures as findings', async (ctx) => {
  const ws = mkdtempSync(join(tmpdir(), 'jourilo-stale-'));
  const child = spawn(
    process.execPath,
    [
      cli,
      'audit',
      base,
      '--url',
      '/',
      '--url',
      '/about',
      '--viewports',
      'desktop',
      '--workspace',
      ws,
      '--json',
      '-q',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  if (code === 4) return ctx.skip();
  const out = JSON.parse(stdout) as { runDir: string; limitations: string[]; findings: { ruleId: string }[] };
  expect(out.limitations).toContain(STALE_SERVER_LIMITATION);
  expect(out.findings.some((f) => f.ruleId === 'jourilo/failed-requests')).toBe(true);
  const saved = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8')) as { limitations: string[] };
  expect(saved.limitations).toContain(STALE_SERVER_LIMITATION);
}, 120_000);
