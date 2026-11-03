// The network guard must stop a public page from reaching services on this machine or the LAN, whatever the
// mechanism (literal IP, localhost, a host name that resolves privately, 0.0.0.0, a redirect, an iframe, fetch, a
// WebSocket), in every engine, while the page itself and its own resources still load.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser } from '../../src/browser/runtime.js';
import { startNetGuard } from '../../src/core/net-guard.js';
import { type AddressPolicy, addressVerdict } from '../../src/core/url-safety.js';

let pub: http.Server;
let priv: http.Server;
let pubPort = 0;
let privPort = 0;
const privateHits: string[] = [];
const publicHits: string[] = [];

function listen(s: http.Server): Promise<number> {
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
}

beforeAll(async () => {
  priv = http.createServer((req, res) => {
    privateHits.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'image/gif', 'access-control-allow-origin': '*' }).end('GIF89a');
  });
  priv.on('upgrade', (req, socket) => {
    privateHits.push(`ws ${req.url}`);
    socket.destroy();
  });
  privPort = await listen(priv);
  pub = http.createServer((req, res) => {
    publicHits.push(req.url ?? '');
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${privPort}/redirected` }).end();
      return;
    }
    if (req.url === '/ok.gif') {
      res.writeHead(200, { 'content-type': 'image/gif' }).end('GIF89a');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/html' })
      .end(`<!doctype html><html lang="en"><title>Public</title>
<h1>Public page</h1>
<img src="/ok.gif" alt="">
<img src="http://127.0.0.1:${privPort}/literal" alt="">
<img src="http://localhost:${privPort}/localhost" alt="">
<img src="http://0.0.0.0:${privPort}/zero" alt="">
<iframe src="/redirect" title="r"></iframe>
<script>
  fetch('http://internal.example:${privPort}/fetch-name', { mode: 'no-cors' }).catch(() => {});
  try { new WebSocket('ws://127.0.0.1:${privPort}/ws'); } catch {}
</script>`);
  });
  pubPort = await listen(pub);
});

afterAll(async () => {
  await new Promise((r) => pub.close(r));
  await new Promise((r) => priv.close(r));
});

describe.each(['chromium', 'firefox', 'webkit'] as const)('network guard in %s', (name) => {
  it('blocks loopback access from a public page and keeps the page working', async (ctx) => {
    const policy: AddressPolicy = { target: 'public', allowPrivate: false };
    // The test's "public" site really runs on 127.0.0.1; only that one port is treated as public.
    const guard = await startNetGuard(policy, {
      resolve: async (host) =>
        ['site.example', 'internal.example'].includes(host) ? [{ address: '127.0.0.1', family: 4 }] : [],
      verdict: (ip, port) =>
        ip === '127.0.0.1' && port === pubPort ? { ok: true } : addressVerdict(ip, policy),
    });
    let browser: Awaited<ReturnType<typeof launchBrowser>>;
    try {
      browser = await launchBrowser(name, false, guard);
    } catch {
      await guard.close();
      return ctx.skip();
    }
    privateHits.length = 0;
    publicHits.length = 0;
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`http://site.example:${pubPort}/`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      expect(await page.textContent('h1')).toBe('Public page');
      expect(publicHits).toContain('/ok.gif');
      expect(privateHits).toEqual([]);
      const hosts = guard.blocked.map((b) => `${b.host}:${b.port}`);
      expect(hosts).toContain(`127.0.0.1:${privPort}`);
      expect(guard.blocked.every((b) => b.reason.length > 0)).toBe(true);
    } finally {
      await browser.close();
      await guard.close();
    }
  });
});

describe('upstream-error signal', () => {
  const HEADER = 'x-jourilo-guard-upstream-error';
  let spoof: http.Server;
  let spoofPort = 0;
  beforeAll(async () => {
    spoof = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', [HEADER]: 'forged nothing' }).end('<h1>hi</h1>');
    });
    spoofPort = await listen(spoof);
  });
  afterAll(() => new Promise((r) => spoof.close(r)));

  function viaProxy(guard: { url: string }, target: string): Promise<http.IncomingMessage> {
    const p = new URL(guard.url);
    return new Promise((resolve, reject) => {
      http
        .get(
          { host: p.hostname, port: p.port, path: target, headers: { host: new URL(target).host } },
          (res) => {
            res.resume();
            resolve(res);
          },
        )
        .on('error', reject);
    });
  }

  const deps = {
    resolve: async (host: string) =>
      host === 'spoof.example'
        ? [{ address: '127.0.0.1', family: 4 }]
        : (() => {
            throw new Error('ENOTFOUND 203.0.113.5');
          })(),
    verdict: () => ({ ok: true as const }),
  };

  it('marks its own 502 with the token and fixed wording, never an IP', async () => {
    const guard = await startNetGuard({ target: 'public', allowPrivate: false }, deps);
    try {
      const res = await viaProxy(guard, 'http://dead.example/');
      expect(res.statusCode).toBe(502);
      const value = String(res.headers[HEADER]);
      expect(value.startsWith(`${guard.token} `)).toBe(true);
      expect(value).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
      const res2 = await viaProxy(guard, 'http://nowhere.example/');
      expect(String(res2.headers[HEADER])).toBe(`${guard.token} the host name could not be resolved`);
    } finally {
      await guard.close();
    }
  });
  it('does not mark a 403 policy refusal', async () => {
    const policy: AddressPolicy = { target: 'public', allowPrivate: false };
    const guard = await startNetGuard(policy, {
      resolve: async () => [{ address: '10.0.0.1', family: 4 }],
    });
    try {
      const res = await viaProxy(guard, 'http://internal.example/');
      expect(res.statusCode).toBe(403);
      expect(res.headers[HEADER]).toBeUndefined();
    } finally {
      await guard.close();
    }
  });
  it('strips the header when an upstream sends it', async () => {
    const guard = await startNetGuard(
      { target: 'public', allowPrivate: false },
      { resolve: deps.resolve, verdict: () => ({ ok: true }) },
    );
    try {
      const res = await viaProxy(guard, `http://spoof.example:${spoofPort}/`);
      expect(res.statusCode).toBe(200);
      expect(res.headers[HEADER]).toBeUndefined();
    } finally {
      await guard.close();
    }
  });
});
