// Adversarial journeys against a local app with a persistent store: no interaction mechanism may delete, pay or
// leave the site without --allow-destructive (and never on non-local hosts). The server records every request
// that would change data; it must record none.

import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GuardedSession, openGuardedBrowser } from '../../src/browser/session.js';
import { runJourney } from '../../src/journeys/runner.js';
import type { JourneySpec, Step } from '../../src/journeys/schema.js';

const mutations: string[] = [];
let server: http.Server;
let base: URL;
let session: GuardedSession;

const PAGE = `<!doctype html><html lang="en"><title>App</title>
<svg style="display:none"><symbol id="icon-trash" viewBox="0 0 1 1"></symbol></svg>
<main>
<button class="icon-btn" onclick="fetch('/api/items/1', { method: 'DELETE' })"><svg width="16" height="16"><use href="#icon-trash"></use></svg></button>
<a id="next" href="/account/delete?confirm=1">Continue</a>
<form action="/subscriptions/cancel" method="post"><button>Confirm</button></form>
<button id="done" onclick="fetch('/api/items/2', { method: 'DELETE' }).catch(() => {})">Done</button>
<form id="pay" action="/orders" method="post"><label>Card <input name="cardnumber"></label><button>Continue to review</button></form>
<button id="del" onclick="fetch('/api/projects/1', { method: 'DELETE' }).catch(() => {})">Delete project</button>
<form id="quick" action="/checkout/pay" method="post"><label>Code <input name="code"></label></form>
<a id="partner" href="https://partner.example/">Partner</a>
<a id="pricing" href="/pricing">Pricing</a>
<button id="save" onclick="fetch('/api/profile', { method: 'POST', body: '{}' }).then(() => { document.body.dataset.saved = 1 })">Save</button>
</main>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') mutations.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith('/account/delete')) mutations.push(`GET ${req.url}`);
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(req.url === '/pricing' ? '<h1>Pricing</h1>' : PAGE);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  session = await openGuardedBrowser('chromium', false, { target: 'local', allowPrivate: false });
});

afterAll(async () => {
  await session?.close();
  await new Promise((r) => server.close(r));
});

async function journey(steps: Step[], allowDestructive = false) {
  const spec: JourneySpec = {
    version: 1,
    id: 'adversarial',
    name: 'adversarial',
    start: '/',
    steps,
    success: [{ description: 'no page errors', noPageErrors: true }],
  };
  const { result } = await runJourney(session.browser, spec, {
    base,
    runDir: mkdtempSync(join(tmpdir(), 'jourilo-safety-')),
    hostClass: 'local',
    policy: { hostClass: 'local', allowSubmit: false, allowDestructive },
    data: {},
    trace: false,
    stepTimeoutMs: 5000,
  });
  return result;
}

describe('journey action safety (local app with persistent data)', () => {
  it.each<[string, Step[]]>([
    ['icon-only delete button', [{ action: 'click', target: { css: '.icon-btn' } }]],
    ['innocent link to a destructive GET endpoint', [{ action: 'click', target: { css: '#next' } }]],
    [
      '"Confirm" posting to a cancel endpoint',
      [{ action: 'click', target: { role: 'button', name: 'Confirm' } }],
    ],
    ['"Done" that sends DELETE from script', [{ action: 'click', target: { css: '#done' } }]],
    [
      '"Continue" in a payment form',
      [{ action: 'click', target: { role: 'button', name: 'Continue to review' } }],
    ],
    [
      'Enter without a target on a focused delete button',
      [
        { action: 'press', target: { css: '#del' }, key: 'Shift' },
        { action: 'press', key: 'Enter' },
      ],
    ],
    ['Space on a delete button', [{ action: 'press', target: { css: '#del' }, key: 'Space' }]],
    [
      'Enter in a field of a form that posts to a payment endpoint',
      [{ action: 'press', target: { label: 'Code' }, key: 'Enter' }],
    ],
    ['link to another site', [{ action: 'click', target: { css: '#partner' } }]],
    ['goto a destructive URL', [{ action: 'goto', url: '/account/delete?confirm=1' }]],
  ])('blocks %s', async (_name, steps) => {
    mutations.length = 0;
    const r = await journey(steps);
    expect(r.status).toBe('blocked');
    expect(r.steps.find((s) => s.status === 'blocked')?.error).toBeTruthy();
    expect(mutations).toEqual([]);
  });

  it('still performs ordinary steps', async () => {
    mutations.length = 0;
    const r = await journey([
      { action: 'click', target: { css: '#save' } },
      { action: 'click', target: { css: '#pricing' } },
      { action: 'expect', url: '/pricing' },
    ]);
    expect(r.status).toBe('passed');
    expect(mutations).toEqual(['POST /api/profile']);
  });

  it('performs a destructive step on a local host only with --allow-destructive', async () => {
    mutations.length = 0;
    const r = await journey([{ action: 'click', target: { css: '#done' } }], true);
    expect(r.status).toBe('passed');
    await new Promise((res) => setTimeout(res, 300));
    expect(mutations).toEqual(['DELETE /api/items/2']);
  });
});

describe('form validation probe on a local app with persistent data', () => {
  const store: string[] = [];
  let app: http.Server;
  let appUrl = '';
  const SIGNUP = `<!doctype html><html lang="en"><title>Sign up</title><main><h1>Create your account</h1>
<form id="signup" action="/signup" method="post" novalidate>
<label>Email <input name="email" type="email" autocomplete="email"></label>
<label>Password <input name="password" type="password" autocomplete="new-password"></label>
<button type="submit">Create account</button></form>
<form id="js" action="/api/register" method="post" novalidate>
<label>Name <input name="name" required autocomplete="name"></label>
<button type="submit">Register</button></form>
<script>document.getElementById('js').addEventListener('submit', (e) => { e.preventDefault();
  fetch('/api/register', { method: 'POST', body: new FormData(e.target) }); });</script></main>`;

  beforeAll(async () => {
    app = http.createServer((req, res) => {
      if (req.method === 'POST') store.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'content-type': 'text/html' }).end(SIGNUP);
    });
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
    appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}/`;
  });
  afterAll(async () => {
    await new Promise((r) => app.close(r));
  });

  async function audit(allowSubmit: boolean) {
    const { runAudit } = await import('../../src/audit/engine.js');
    const { Workspace } = await import('../../src/core/workspace.js');
    const { parseViewports } = await import('../../src/browser/viewports.js');
    return runAudit(new Workspace(mkdtempSync(join(tmpdir(), 'jourilo-forms-'))), {
      target: appUrl,
      viewports: parseViewports('desktop'),
      maxPages: 1,
      maxDepth: 1,
      browser: 'chromium',
      headed: false,
      respectRobots: true,
      allowPrivate: false,
      allowSubmit,
      keyboard: true,
      throttle: false,
      timeoutMs: 30_000,
      mask: [],
      mode: 'website',
    });
  }

  it('writes nothing by default and says what was not tested', async () => {
    store.length = 0;
    const { run } = await audit(false);
    expect(store).toEqual([]);
    expect(run.limitations.join('\n')).toMatch(/simulated.*nothing was written.*--allow-submit/s);
    expect(run.findings.filter((f) => f.ruleId === 'ux/no-validation-feedback')).toEqual([]);
  });

  it('sends the empty submissions only with --allow-submit', async () => {
    store.length = 0;
    const { run } = await audit(true);
    expect(store).toContain('POST /signup');
    expect(run.findings.some((f) => f.ruleId === 'ux/no-validation-feedback')).toBe(true);
  });
});
