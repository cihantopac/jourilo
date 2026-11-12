// The network guard must stop a public page from reaching services on this machine or the LAN, whatever the
// mechanism (literal IP, localhost, a host name that resolves privately, 0.0.0.0, a redirect, an iframe, fetch, a
// WebSocket), in every engine, while the page itself and its own resources still load.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { launchBrowser } from '../../src/browser/runtime.js';
import { networkLimitations, openGuardedBrowser } from '../../src/browser/session.js';
import { audit } from '../../src/cli/commands/audit.js';
import { parse } from '../../src/cli/framework.js';
import { startNetGuard } from '../../src/core/net-guard.js';
import type { Run } from '../../src/core/types.js';
import { type AddressPolicy, addressVerdict, hostListsFor } from '../../src/core/url-safety.js';

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
    if (req.url === '/tracked') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><html lang="en"><title>Tracked</title>
<h1>Tracked page</h1>
<img src="http://pixel.tracker.test/p.gif" alt="">
<script>fetch('https://beacon.tracker.test/b', { mode: 'no-cors' }).catch(() => {});</script>`);
      return;
    }
    if (req.url === '/third-party') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><html lang="en"><title>Third party</title>
<h1>Third-party page</h1>
<img src="http://img.cdn.example.com:${pubPort}/ok.gif?cdn" alt="">
<img src="http://localhost:${privPort}/not-allowed" alt="">`);
      return;
    }
    if (req.url === '/ok.gif' || req.url === '/ok.gif?cdn') {
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

/** Sends CONNECT to the guard and resolves with the status line, and the socket for the tunnel. */
function connectVia(
  guard: { url: string },
  authority: string,
): Promise<{ status: string; socket: net.Socket }> {
  const p = new URL(guard.url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(p.port), p.hostname, () =>
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
    );
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString('latin1');
      if (!buf.includes('\r\n\r\n')) return;
      socket.off('data', onData);
      resolve({ status: buf.split('\r\n')[0]!, socket });
    };
    socket.on('data', onData);
    socket.on('error', reject);
  });
}

/** Sends one HTTP/1.1 request over an open tunnel and resolves with the raw response. */
function requestOver(socket: net.Socket, host: string): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    socket.on('data', (d) => (out += d.toString('latin1')));
    socket.on('close', () => resolve(out));
    socket.write(`GET /through HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
  });
}

describe('upstream proxy', () => {
  let origin: http.Server;
  let proxy: http.Server;
  let originPort = 0;
  let proxyPort = 0;
  const connects: { line: string; auth?: string }[] = [];
  const originHits: { url: string; host?: string }[] = [];

  beforeAll(async () => {
    origin = http.createServer((req, res) => {
      originHits.push({ url: req.url ?? '', host: req.headers.host });
      res.writeHead(200, { 'content-type': 'text/plain' }).end('origin ok');
    });
    originPort = await listen(origin);
    // A stub corporate proxy: records the CONNECT line and its credentials, then tunnels to the local origin,
    // whatever address was asked for (the test cannot reach 93.184.216.34).
    proxy = http.createServer((_req, res) => res.writeHead(405).end());
    proxy.on('connect', (req, client: net.Socket, head: Buffer) => {
      connects.push({
        line: `${req.method} ${req.url}`,
        ...(req.headers['proxy-authorization'] ? { auth: String(req.headers['proxy-authorization']) } : {}),
      });
      const up = net.connect(originPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) up.write(head);
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    proxyPort = await listen(proxy);
  });
  afterAll(async () => {
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => origin.close(r));
  });

  const resolveExample = async (host: string) =>
    host === 'example.com'
      ? [{ address: '93.184.216.34', family: 4 }]
      : host === 'internal.example'
        ? [{ address: '10.0.0.1', family: 4 }]
        : [];

  it('the guard tunnels through an upstream proxy with the checked IP', async () => {
    connects.length = 0;
    originHits.length = 0;
    const policy: AddressPolicy = {
      target: 'public',
      allowPrivate: false,
      upstream: { host: '127.0.0.1', port: proxyPort, auth: 'jourilo:s3cret' },
    };
    const guard = await startNetGuard(policy, { resolve: resolveExample });
    try {
      // HTTPS and WebSockets: CONNECT by name to the guard, CONNECT by checked address to the proxy.
      const t = await connectVia(guard, 'example.com:443');
      expect(t.status).toMatch(/^HTTP\/1\.1 200/);
      expect(await requestOver(t.socket, 'example.com')).toContain('origin ok');
      expect(connects[0]).toEqual({
        line: 'CONNECT 93.184.216.34:443',
        auth: `Basic ${Buffer.from('jourilo:s3cret').toString('base64')}`,
      });
      // Plain HTTP takes the same tunnel, so the proxy again sees only the checked address.
      const res = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const p = new URL(guard.url);
        http
          .get(
            {
              host: p.hostname,
              port: p.port,
              path: 'http://example.com/plain?x=1',
              headers: { host: 'example.com' },
            },
            (r) => {
              let body = '';
              r.on('data', (d) => (body += d));
              r.on('end', () => resolve({ status: r.statusCode, body }));
            },
          )
          .on('error', reject);
      });
      expect(res).toEqual({ status: 200, body: 'origin ok' });
      expect(connects[1]?.line).toBe('CONNECT 93.184.216.34:80');
      expect(originHits.at(-1)).toEqual({ url: '/plain?x=1', host: 'example.com' });
      expect(connects.every((c) => !c.line.includes('example.com'))).toBe(true);
    } finally {
      await guard.close();
    }
    // Without credentials in the proxy URL there is no Proxy-Authorization header.
    connects.length = 0;
    const bare = await startNetGuard(
      { target: 'public', allowPrivate: false, upstream: { host: '127.0.0.1', port: proxyPort } },
      { resolve: resolveExample },
    );
    try {
      const t = await connectVia(bare, 'example.com:443');
      t.socket.destroy();
      expect(connects).toEqual([{ line: 'CONNECT 93.184.216.34:443' }]);
    } finally {
      await bare.close();
    }
  });

  it('a private destination is still refused with an upstream proxy', async () => {
    connects.length = 0;
    const policy: AddressPolicy = {
      target: 'public',
      allowPrivate: false,
      upstream: { host: '127.0.0.1', port: proxyPort },
    };
    const guard = await startNetGuard(policy, { resolve: resolveExample });
    try {
      for (const authority of ['internal.example:443', '169.254.169.254:80', `127.0.0.1:${originPort}`]) {
        const t = await connectVia(guard, authority);
        t.socket.destroy();
        expect(t.status, authority).toMatch(/^HTTP\/1\.1 403/);
      }
      expect(connects).toEqual([]);
      expect(guard.blocked.map((b) => `${b.host}:${b.port}`)).toContain('internal.example:443');
    } finally {
      await guard.close();
    }
  });

  it('a loopback destination a local target may reach connects directly, not through the proxy', async () => {
    connects.length = 0;
    const guard = await startNetGuard({
      target: 'local',
      allowPrivate: false,
      upstream: { host: '127.0.0.1', port: proxyPort },
    });
    try {
      const t = await connectVia(guard, `127.0.0.1:${originPort}`);
      expect(t.status).toMatch(/^HTTP\/1\.1 200/);
      expect(await requestOver(t.socket, `127.0.0.1:${originPort}`)).toContain('origin ok');
      expect(connects).toEqual([]);
    } finally {
      await guard.close();
    }
  });

  it('a proxy that refuses the tunnel is a 502, not a page from the target', async () => {
    const refusing = http.createServer();
    refusing.on('connect', (_req, client: net.Socket) =>
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'),
    );
    const port = await listen(refusing);
    const guard = await startNetGuard(
      { target: 'public', allowPrivate: false, upstream: { host: '127.0.0.1', port } },
      { resolve: resolveExample },
    );
    try {
      const t = await connectVia(guard, 'example.com:443');
      t.socket.destroy();
      expect(t.status).toMatch(/^HTTP\/1\.1 502/);
    } finally {
      await guard.close();
      await new Promise((r) => refusing.close(r));
    }
  });
});

describe('host lists in chromium', () => {
  it("--block-hosts '*.tracker.test' blocks those requests and lists them in the network report", async (ctx) => {
    const policy: AddressPolicy = {
      target: 'local',
      allowPrivate: false,
      ...hostListsFor(new URL(`http://127.0.0.1:${pubPort}/`), [], ['*.tracker.test']),
    };
    let session: Awaited<ReturnType<typeof openGuardedBrowser>>;
    try {
      session = await openGuardedBrowser('chromium', false, policy);
    } catch {
      return ctx.skip();
    }
    try {
      const page = await (await session.browser.newContext()).newPage();
      await page.goto(`http://127.0.0.1:${pubPort}/tracked`, { waitUntil: 'load' });
      await page.waitForTimeout(1000);
      expect(await page.textContent('h1')).toBe('Tracked page');
      const report = session.report();
      const hosts = report.blocked.map((b) => `${b.host}:${b.port}`);
      expect(hosts).toContain('pixel.tracker.test:80');
      expect(hosts).toContain('beacon.tracker.test:443');
      expect(report.blocked.every((b) => b.reason.includes('--block-hosts'))).toBe(true);
      expect(networkLimitations(report).join(' ')).toMatch(/--block-hosts.*pixel\.tracker\.test:80/);
    } finally {
      await session.close();
    }
  });

  it('--allow-hosts example.com,*.cdn.example.com blocks every other third-party host', async (ctx) => {
    publicHits.length = 0;
    privateHits.length = 0;
    const target = new URL(`http://127.0.0.1:${pubPort}/third-party`);
    const policy: AddressPolicy = {
      target: 'local',
      allowPrivate: false,
      ...hostListsFor(target, ['example.com', '*.cdn.example.com'], []),
    };
    const guard = await startNetGuard(policy, {
      resolve: async (host) => (host === 'img.cdn.example.com' ? [{ address: '127.0.0.1', family: 4 }] : []),
    });
    let browser: Awaited<ReturnType<typeof launchBrowser>>;
    try {
      browser = await launchBrowser('chromium', false, guard);
    } catch {
      await guard.close();
      return ctx.skip();
    }
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(target.toString(), { waitUntil: 'load' });
      await page.waitForTimeout(1000);
      // The target's own host is always allowed; an allowed CDN host loads; any other host is refused by name.
      expect(await page.textContent('h1')).toBe('Third-party page');
      expect(publicHits).toContain('/ok.gif?cdn');
      expect(privateHits).toEqual([]);
      const refused = guard.blocked.find((b) => b.host === 'localhost');
      expect(refused?.port).toBe(privPort);
      expect(refused?.reason).toContain('--allow-hosts');
    } finally {
      await browser.close();
      await guard.close();
    }
  });
});

describe('proxy credentials', () => {
  it('proxy credentials never appear in run.json or progress lines', async (testCtx) => {
    const proxy = http.createServer();
    proxy.on('connect', (_req, client: net.Socket) => client.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
    const proxyPort = await listen(proxy);
    const ws = mkdtempSync(join(tmpdir(), 'jourilo-proxy-'));
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    let data: unknown;
    try {
      const ctx = parse(audit, [
        `http://127.0.0.1:${pubPort}/tracked`,
        '--pages',
        '1',
        '--viewports',
        'desktop',
        '--no-keyboard',
        '--no-forms',
        '--proxy',
        `http://jourilo:s3cret-pass@127.0.0.1:${proxyPort}`,
        '--block-hosts',
        '*.tracker.test',
        '--json',
        '--workspace',
        ws,
      ]);
      data = (await audit.run(ctx)).data;
    } catch (err) {
      if ((err as { code?: string }).code === 'BROWSER_UNAVAILABLE') return testCtx.skip();
      throw err;
    } finally {
      spy.mockRestore();
      await new Promise((r) => proxy.close(r));
    }
    try {
      const secrets = ['s3cret-pass', Buffer.from('jourilo:s3cret-pass').toString('base64')];
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!/\.(png|jpe?g|webp)$/.test(f)) files.push(p);
        }
      };
      walk(ws);
      expect(files.some((f) => f.endsWith('run.json'))).toBe(true);
      expect(files.some((f) => f.endsWith('manifest.json'))).toBe(true);
      for (const f of files) {
        const text = readFileSync(f, 'utf8');
        for (const s of secrets) expect(text.includes(s), `${f} contains a proxy credential`).toBe(false);
      }
      expect(written.length).toBeGreaterThan(0);
      for (const s of secrets) {
        expect(written.join('').includes(s)).toBe(false);
        expect(JSON.stringify(data).includes(s)).toBe(false);
      }
      const run = JSON.parse(readFileSync(files.find((f) => f.endsWith('run.json'))!, 'utf8')) as Run;
      expect(run.settings.proxy).toBe(`http://127.0.0.1:${proxyPort}`);
      expect(run.settings.blockHosts).toEqual(['*.tracker.test']);
      expect(run.limitations.join(' ')).toContain(`http://127.0.0.1:${proxyPort}`);
      expect(run.network?.blocked.map((b) => b.host)).toContain('pixel.tracker.test');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 180_000);
});
