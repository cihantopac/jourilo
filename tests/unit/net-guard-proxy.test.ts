// Upstream proxy: a tunnel is tried for every allowed address of a name, the time budget, the shape of the guard's own
// replies, and the certificate hint of Jourilo's own fetches.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { sendTargetHeaders, targetHeaders } from '../../src/browser/target-headers.js';
import { guardedFetch, openTunnel, startNetGuard } from '../../src/core/net-guard.js';
import type { AddressPolicy } from '../../src/core/url-safety.js';

const pub: AddressPolicy = { target: 'public', allowPrivate: false };
const listen = (s: net.Server) =>
  new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const closeServer = (s: net.Server) => new Promise((r) => s.close(r));
const resolveTo =
  (...ips: string[]) =>
  async () =>
    ips.map((address) => ({ address, family: 4 }));

/** A proxy that answers CONNECT per destination: a status line, or `tunnel` to the local origin. */
async function stubProxy(answer: (authority: string, n: number) => string, originPort?: number) {
  const seen: string[] = [];
  const proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on('connect', (req, client: net.Socket) => {
    seen.push(String(req.url));
    const a = answer(String(req.url), seen.length);
    if (a !== 'tunnel' || originPort === undefined) return void client.end(`HTTP/1.1 ${a}\r\n\r\n`);
    const up = net.connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
  });
  return { seen, proxy, port: await listen(proxy) };
}

const httpGet = (guardUrl: string, url: string) =>
  new Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const p = new URL(guardUrl);
    http
      .get(
        { host: p.hostname, port: p.port, path: url, headers: { host: new URL(url).host }, agent: false },
        (r) => {
          let body = '';
          r.on('data', (d) => (body += d));
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }));
        },
      )
      .on('error', reject);
  });

describe('upstream proxy: every allowed address is tried', () => {
  it('a 5xx for the first address moves on to the next; a 4xx or a 407 does not', async () => {
    const origin = http.createServer((_req, res) => res.end('origin'));
    const originPort = await listen(origin);
    const deps = { resolve: resolveTo('93.184.216.34', '93.184.216.35') };
    try {
      const flaky = await stubProxy((_a, n) => (n === 1 ? '502 Bad Gateway' : 'tunnel'), originPort);
      const res = await guardedFetch(
        'http://example.com/',
        { ...pub, upstream: { host: '127.0.0.1', port: flaky.port } },
        { timeoutMs: 3000, deps },
      );
      expect(await res.text()).toBe('origin');
      expect(flaky.seen).toEqual(['93.184.216.34:80', '93.184.216.35:80']);
      await closeServer(flaky.proxy);

      for (const refusal of ['403 Forbidden', '407 Proxy Authentication Required']) {
        const refusing = await stubProxy(() => refusal, originPort);
        await expect(
          guardedFetch(
            'http://example.com/',
            { ...pub, upstream: { host: '127.0.0.1', port: refusing.port } },
            { timeoutMs: 3000, deps },
          ),
        ).rejects.toThrow('the upstream proxy did not open a tunnel');
        // The same answer would come for the other address: one attempt only.
        expect(refusing.seen, refusal).toEqual(['93.184.216.34:80']);
        await closeServer(refusing.proxy);
      }
    } finally {
      await closeServer(origin);
    }
  });

  it('every address answered 5xx: the last answer is reported', async () => {
    const proxy = await stubProxy(() => '503 Service Unavailable');
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port: proxy.port } },
      { resolve: resolveTo('93.184.216.34', '93.184.216.35') },
    );
    try {
      const res = await httpGet(guard.url, 'http://example.com/');
      expect(res.status).toBe(502);
      expect(res.headers['x-jourilo-guard-upstream-error']).toBe(
        `${guard.token} the upstream proxy could not open the connection`,
      );
      expect(proxy.seen).toEqual(['93.184.216.34:80', '93.184.216.35:80']);
    } finally {
      await guard.close();
      await closeServer(proxy.proxy);
    }
  });

  it('a budget that ran out between attempts is a timeout, not the previous attempt code', async () => {
    const real = Date.now;
    let skew = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => real() + skew);
    // The first answer comes after the whole time budget has gone by.
    const proxy = await stubProxy(() => {
      skew = 10 * 60_000;
      return '502 Bad Gateway';
    });
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port: proxy.port } },
      { resolve: resolveTo('93.184.216.34', '93.184.216.35') },
    );
    try {
      const res = await httpGet(guard.url, 'http://example.com/');
      expect(res.status).toBe(502);
      expect(res.headers['x-jourilo-guard-upstream-error']).toBe(`${guard.token} the connection timed out`);
      expect(proxy.seen).toEqual(['93.184.216.34:80']);
    } finally {
      clock.mockRestore();
      await guard.close();
      await closeServer(proxy.proxy);
    }
  });

  it('openTunnel accepts any 2xx answer', async () => {
    const proxy = await stubProxy(() => '204 No Content');
    try {
      const s = await openTunnel({ host: '127.0.0.1', port: proxy.port }, '93.184.216.34', 443, 3000);
      s.destroy();
      expect(proxy.seen).toEqual(['93.184.216.34:443']);
    } finally {
      await closeServer(proxy.proxy);
    }
  });

  it('a loopback address a local target may reach connects directly, the public one through the proxy', async () => {
    const origin = http.createServer((_req, res) => res.end('direct'));
    const originPort = await listen(origin);
    const proxy = await stubProxy(() => '502 Bad Gateway');
    const policy: AddressPolicy = {
      target: 'local',
      allowPrivate: false,
      denyLocal: true,
      allowLoopbackPorts: [originPort],
      upstream: { host: '127.0.0.1', port: proxy.port },
    };
    const guard = await startNetGuard(policy, { resolve: resolveTo('127.0.0.1') });
    try {
      expect(await httpGet(guard.url, `http://127.0.0.1:${originPort}/`)).toMatchObject({
        status: 200,
        body: 'direct',
      });
      // Another loopback port stays refused with --deny-local, upstream or not.
      expect((await httpGet(guard.url, 'http://127.0.0.1:6379/')).status).toBe(403);
      expect(proxy.seen).toEqual([]);
    } finally {
      await guard.close();
      await closeServer(proxy.proxy);
      await closeServer(origin);
    }
  });
});

describe('the guard replies to a failed CONNECT', () => {
  const connectVia = (guardUrl: string, authority: string) =>
    new Promise<string>((resolve, reject) => {
      const p = new URL(guardUrl);
      const s = net.connect(Number(p.port), p.hostname, () =>
        s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      );
      let all = '';
      s.on('data', (d) => (all += d.toString('latin1')));
      s.on('close', () => resolve(all));
      s.on('error', reject);
    });

  it('a refusal carries the token and fixed wording, and no raw reason or address in its body', async () => {
    const guard = await startNetGuard(pub, { resolve: resolveTo('10.0.0.5') });
    try {
      const reply = await connectVia(guard.url, 'internal.example:443');
      expect(reply).toMatch(/^HTTP\/1\.1 403 Forbidden/);
      expect(reply).toContain(`x-jourilo-guard-upstream-error: ${guard.token} the network guard refused`);
      expect(reply).not.toContain('10.0.0.5');
      expect(reply.split('\r\n\r\n')[1]).toBe('Blocked by Jourilo network guard.');
      // The reason stays in the run's evidence.
      expect(guard.blocked[0]!.reason).toContain('10.0.0.5');
    } finally {
      await guard.close();
    }
  });

  it('a connection failure carries the token and its fixed wording', async () => {
    const probe = net.createServer();
    const port = await listen(probe);
    await closeServer(probe);
    const guard = await startNetGuard(
      { target: 'local', allowPrivate: false },
      { resolve: resolveTo('127.0.0.1') },
    );
    try {
      const reply = await connectVia(guard.url, `refused.test:${port}`);
      expect(reply).toMatch(/^HTTP\/1\.1 502 Bad Gateway/);
      expect(reply).toContain(`x-jourilo-guard-upstream-error: ${guard.token} the connection was refused`);
    } finally {
      await guard.close();
    }
  });

  it('a client that hangs up while the upstream connection is pending closes that socket', async () => {
    const proxy = http.createServer();
    const accepted: net.Socket[] = [];
    // The proxy accepts the connection and never answers CONNECT: the tunnel stays half open.
    proxy.on('connection', (s) => accepted.push(s));
    const proxyPort = await listen(proxy);
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port: proxyPort } },
      { resolve: resolveTo('93.184.216.34') },
    );
    try {
      const p = new URL(guard.url);
      const client = net.connect(Number(p.port), p.hostname, () =>
        client.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'),
      );
      await vi.waitFor(() => expect(accepted).toHaveLength(1));
      client.destroy();
      // The guard's socket to the proxy is closed at once, not after the 30 s tunnel time limit.
      await vi.waitFor(() => expect(accepted[0]!.destroyed).toBe(true), { timeout: 3000 });
    } finally {
      await guard.close();
      for (const s of accepted) s.destroy();
      await closeServer(proxy);
    }
  });
});

describe('a certificate error of Jourilo own fetch', () => {
  it('names the certificate, not just a code', async () => {
    const certs = join(import.meta.dirname, '..', 'certs');
    const site = https.createServer(
      {
        key: readFileSync(join(certs, 'localhost-key.pem')),
        cert: readFileSync(join(certs, 'localhost-cert.pem')),
      },
      (_req, res) => res.end('ok'),
    );
    const port = await listen(site);
    try {
      await expect(
        guardedFetch(
          `https://localhost:${port}/`,
          { target: 'local', allowPrivate: false },
          { timeoutMs: 3000, deps: { resolve: resolveTo('127.0.0.1') } },
        ),
      ).rejects.toThrow(/the TLS certificate was rejected \(\w+\)/);
    } finally {
      await closeServer(site);
    }
  });
});

describe('target headers: the guard signal needs the guard token', () => {
  /** Runs the registered route handler for one https request whose fetch answers with `headers`. */
  async function aborted(signalValue: string, guardToken: string) {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const ctx = {
      route: async (_p: string, h: typeof handler) => {
        handler = h;
      },
    };
    const scope = targetHeaders('https://site.test', { 'x-staging': 'secret' });
    scope.guardToken = guardToken;
    await sendTargetHeaders(ctx as never, scope, 1000);
    const calls: string[] = [];
    const response = {
      status: () => 502,
      headers: () => ({ 'x-jourilo-guard-upstream-error': signalValue }),
      dispose: async () => undefined,
    };
    await handler!({
      request: () => ({ url: () => 'https://site.test/', headers: () => ({}) }),
      fetch: async () => response,
      abort: async (code: string) => void calls.push(`abort:${code}`),
      fulfill: async () => void calls.push('fulfill'),
      fallback: async () => void calls.push('fallback'),
    });
    return calls;
  }

  it('a reply with the right token fails the request; a page with another token is handed over', async () => {
    expect(await aborted('tok123 the connection was refused', 'tok123')).toEqual(['abort:connectionfailed']);
    expect(await aborted('wrong the connection was refused', 'tok123')).toEqual(['fulfill']);
  });

  it('a request to another origin falls back, and a rejected fallback is swallowed', async () => {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const ctx = {
      route: async (_p: string, h: typeof handler) => {
        handler = h;
      },
    };
    await sendTargetHeaders(
      ctx as never,
      targetHeaders('https://site.test', { 'x-staging': 'secret' }),
      1000,
    );
    await expect(
      handler!({
        request: () => ({ url: () => 'https://other.test/', headers: () => ({}) }),
        fallback: async () => {
          throw new Error('context closed');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
