// A journey whose outcome depends on timing must be reported as flaky with --repeat, and a stable one as stable.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
let server: http.Server;
let base = '';
let visits = 0;

beforeAll(async () => {
  // Every other visit, the confirmation renders too late for the journey's wait (a race in the "product").
  server = http.createServer((req, res) => {
    const slow = req.url === '/' && visits++ % 2 === 1;
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html lang="en"><title>Race</title>
<main><h1>Race</h1><button id="go">Show status</button><p id="out"></p></main>
<script>document.getElementById('go').onclick = () => setTimeout(() => {
  document.getElementById('out').textContent = 'Ready';
}, ${slow ? 4000 : 50});</script>`);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

// Async spawn: the test's own server must keep answering while the CLI runs.
async function run(journey: object, repeat: number) {
  const ws = mkdtempSync(join(tmpdir(), 'jourilo-flaky-'));
  mkdirSync(join(ws, 'journeys'));
  writeFileSync(join(ws, 'journeys', 'race.json'), JSON.stringify(journey));
  const child = spawn(process.execPath, [
    cli,
    'journeys',
    'run',
    '--base',
    base,
    '--repeat',
    String(repeat),
    '--timeout',
    '2',
    '--workspace',
    ws,
    '--json',
    '-q',
  ]);
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d;
  });
  const code = await new Promise<number | null>((r) => child.on('close', r));
  if (code === 4) return null;
  return JSON.parse(stdout) as {
    journeys: { stability?: string; status: string; attempts?: { status: string }[] }[];
    findings: { ruleId: string; title: string }[];
  };
}

const journey = (target: object) => ({
  version: 1,
  id: 'race',
  name: 'Race',
  start: '/',
  steps: [
    { action: 'click', target: { css: '#go' } },
    { action: 'wait', target },
  ],
  success: [{ description: 'status shown', visible: target }],
});

it('flags a journey that passes only sometimes', async (ctx) => {
  visits = 0;
  const out = await run(journey({ text: 'Ready', exact: true }), 4);
  if (!out) return ctx.skip();
  expect(out.journeys[0]!.stability).toBe('flaky');
  expect(out.journeys[0]!.attempts!.map((a) => a.status)).toEqual(['passed', 'failed', 'passed', 'failed']);
  expect(out.findings.map((f) => f.ruleId)).toContain('journey/flaky');
});

it('reports a consistent journey as stable', async (ctx) => {
  visits = 0;
  const out = await run(journey({ css: '#go' }), 3);
  if (!out) return ctx.skip();
  expect(out.journeys[0]!.stability).toBe('stable');
  expect(out.journeys[0]!.status).toBe('passed');
  expect(out.findings.map((f) => f.ruleId)).not.toContain('journey/flaky');
});
