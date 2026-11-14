// Node-side fetches (robots.txt, sitemaps) and the guard's resolver must apply the address policy on every hop.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GuardBlockedError,
  guardedFetch,
  guardedFetchText,
  loopbackRedirectVerdict,
  redirectEscape,
  resolveAllowed,
  startNetGuard,
  upstreamFailureWording,
  viaUpstream,
} from '../../src/core/net-guard.js';
import {
  type AddressPolicy,
  addressVerdict,
  checkTarget,
  checkTargetDetailed,
  classifyIp,
  isLocalHostname,
  LookupFailed,
  resolveInChild,
} from '../../src/core/url-safety.js';

const pub: AddressPolicy = { target: 'public', allowPrivate: false };

describe('resolveAllowed', () => {
  const answers = (...ips: string[]) => ({
    resolve: async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  });
  it('connects only to allowed addresses of a mixed answer', async () => {
    expect(await resolveAllowed('a.example', 443, pub, answers('127.0.0.1', '93.184.216.34'))).toEqual({
      address: '93.184.216.34',
      family: 4,
    });
  });
  it('blocks names with no allowed address and literal private IPs', async () => {
    expect(await resolveAllowed('a.example', 443, pub, answers('10.0.0.1', '::1'))).toHaveProperty('blocked');
    expect(await resolveAllowed('169.254.169.254', 80, pub)).toHaveProperty('blocked');
    expect(await resolveAllowed('[::ffff:127.0.0.1]', 80, pub)).toHaveProperty('blocked');
    expect(
      await resolveAllowed('169.254.169.254', 80, { target: 'local', allowPrivate: true }),
    ).toHaveProperty('blocked');
  });
  it('lets local targets reach loopback but not the LAN', async () => {
    const local: AddressPolicy = { target: 'local', allowPrivate: false };
    expect(await resolveAllowed('127.0.0.1', 3000, local)).toEqual({ address: '127.0.0.1', family: 4 });
    expect(await resolveAllowed('192.168.1.20', 80, local)).toHaveProperty('blocked');
  });
});

describe('redirect checks', () => {
  it('refuses redirects to loopback from a public page only', () => {
    const from = new URL('https://shop.example/a');
    expect(loopbackRedirectVerdict('http://127.0.0.1:6379/', from, pub)).toMatch(/refused/);
    expect(loopbackRedirectVerdict('http://localhost/admin', from, pub)).toMatch(/refused/);
    expect(loopbackRedirectVerdict('http://api.localhost/', from, pub)).toMatch(/refused/);
    expect(loopbackRedirectVerdict('http://[::1]/', from, pub)).toMatch(/refused/);
    expect(loopbackRedirectVerdict('/b', from, pub)).toBeNull();
    expect(loopbackRedirectVerdict('https://cdn.example/x', from, pub)).toBeNull();
    expect(
      loopbackRedirectVerdict('http://localhost:3000/', from, { target: 'local', allowPrivate: false }),
    ).toBeNull();
    const served = {
      target: 'local' as const,
      allowPrivate: false,
      denyLocal: true,
      allowLoopbackPorts: [4321],
    };
    const page = new URL('http://127.0.0.1:4321/');
    expect(loopbackRedirectVerdict('http://127.0.0.1:4321/b', page, served)).toBeNull();
    expect(loopbackRedirectVerdict('http://localhost:4321/b', page, served)).toMatch(/refused/);
    expect(loopbackRedirectVerdict('http://127.0.0.1:9999/b', page, served)).toMatch(/refused/);
    expect(redirectEscape('http://127.0.0.1/', null, pub)).toBeNull();
    expect(redirectEscape('http://127.0.0.1/', 'https://shop.example/', pub)).toMatch(/refused/);
  });
});

describe('guardedFetchText', () => {
  let site: http.Server;
  let internal: http.Server;
  let sitePort = 0;
  let internalPort = 0;
  const internalHits: string[] = [];
  const listen = (s: http.Server) =>
    new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));

  beforeAll(async () => {
    internal = http.createServer((req, res) => {
      internalHits.push(req.url ?? '');
      res.end('secret');
    });
    internalPort = await listen(internal);
    site = http.createServer((req, res) => {
      if (req.url === '/robots.txt') return void res.end('User-agent: *\nDisallow: /admin\n');
      if (req.url === '/to-internal')
        return void res.writeHead(302, { location: `http://127.0.0.1:${internalPort}/x` }).end();
      if (req.url === '/to-internal-name')
        return void res.writeHead(302, { location: `http://internal.example:${internalPort}/y` }).end();
      if (req.url === '/hop') return void res.writeHead(301, { location: '/robots.txt' }).end();
      res.writeHead(404).end();
    });
    sitePort = await listen(site);
  });
  afterAll(async () => {
    await new Promise((r) => site.close(r));
    await new Promise((r) => internal.close(r));
  });

  // The test site runs on 127.0.0.1; only its port counts as public.
  const deps = () => ({
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    verdict: (ip: string, port: number) =>
      port === sitePort ? ({ ok: true } as const) : addressVerdict(ip, pub),
  });
  const get = (path: string, host = 'site.example') =>
    guardedFetchText(`http://${host}:${sitePort}${path}`, pub, {
      timeoutMs: 3000,
      userAgent: 'test',
      deps: deps(),
    });

  it('fetches allowed resources and follows same-origin redirects', async () => {
    expect(await get('/robots.txt')).toContain('Disallow: /admin');
    expect(await get('/hop')).toContain('Disallow');
  });
  it('never connects to a private address reached by redirect', async () => {
    internalHits.length = 0;
    expect(await get('/to-internal')).toBeNull();
    expect(await get('/to-internal-name')).toBeNull();
    expect(internalHits).toEqual([]);
  });
  it('refuses a literal private target', async () => {
    expect(
      await guardedFetchText(`http://127.0.0.1:${internalPort}/robots.txt`, pub, {
        timeoutMs: 3000,
        userAgent: 'test',
      }),
    ).toBeNull();
    expect(internalHits).toEqual([]);
  });
  it('fetches through the upstream proxy with the checked address, and honours --block-hosts', async () => {
    const connects: string[] = [];
    const proxy = http.createServer();
    proxy.on('connect', (req, client: net.Socket) => {
      connects.push(req.url ?? '');
      const up = net.connect(sitePort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', () => client.destroy());
    });
    const proxyPort = await listen(proxy);
    const policy: AddressPolicy = {
      ...pub,
      upstream: { host: '127.0.0.1', port: proxyPort },
      blockHosts: ['*.tracker.test'],
    };
    const opts = {
      timeoutMs: 3000,
      userAgent: 'test',
      deps: { resolve: async () => [{ address: '93.184.216.34', family: 4 }] },
    };
    try {
      expect(await guardedFetchText(`http://site.example:${sitePort}/robots.txt`, policy, opts)).toContain(
        'Disallow: /admin',
      );
      expect(connects).toEqual([`93.184.216.34:${sitePort}`]);
      expect(await guardedFetchText('http://x.tracker.test/robots.txt', policy, opts)).toBeNull();
      expect(connects).toHaveLength(1);
    } finally {
      await new Promise((r) => proxy.close(r));
    }
  });
});

describe('guardedFetch (analytics adapters)', () => {
  let site: http.Server;
  let sitePort = 0;
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
  beforeAll(async () => {
    site = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
        if (req.url === '/hop') return void res.writeHead(302, { location: '/data' }).end();
        if (req.url === '/away') return void res.writeHead(302, { location: 'http://other.example/x' }).end();
        if (req.url === '/limited') return void res.writeHead(429, { 'retry-after': '7' }).end('{}');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, body }));
      });
    });
    sitePort = await new Promise<number>((r) =>
      site.listen(0, '127.0.0.1', () => r((site.address() as AddressInfo).port)),
    );
  });
  afterAll(() => new Promise((r) => site.close(r)));
  const deps = () => ({
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    verdict: (ip: string, port: number) =>
      port === sitePort ? ({ ok: true } as const) : addressVerdict(ip, pub),
  });
  const at = (path: string) => `http://api.example:${sitePort}${path}`;

  it('sends GET and read-only POST with headers, following same-origin GET redirects only', async () => {
    seen.length = 0;
    const get = await guardedFetch(at('/hop'), pub, {
      headers: { authorization: 'Bearer k' },
      timeoutMs: 3000,
      deps: deps(),
    });
    expect(get.status).toBe(200);
    expect(seen.map((s) => [s.method, s.url, s.auth])).toEqual([
      ['GET', '/hop', 'Bearer k'],
      ['GET', '/data', 'Bearer k'],
    ]);
    const post = await guardedFetch(at('/query'), pub, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"q":1}',
      timeoutMs: 3000,
      deps: deps(),
    });
    expect(await post.json()).toEqual({ ok: true, body: '{"q":1}' });
    const limited = await guardedFetch(at('/limited'), pub, { timeoutMs: 3000, deps: deps() });
    expect([limited.status, limited.headers.get('retry-after')]).toEqual([429, '7']);
  });
  it('never follows a redirect to another origin, and refuses private destinations', async () => {
    await expect(
      guardedFetch(at('/away'), pub, {
        headers: { authorization: 'Bearer k' },
        timeoutMs: 3000,
        deps: deps(),
      }),
    ).rejects.toBeInstanceOf(GuardBlockedError);
    await expect(guardedFetch('http://10.0.0.5/x', pub, { timeoutMs: 3000 })).rejects.toBeInstanceOf(
      GuardBlockedError,
    );
  });
});

describe('resolver timeout', () => {
  it('rejects with the unresolved wording when the resolver never answers', async () => {
    const never = () => new Promise<never>(() => undefined);
    const err = await resolveAllowed('slow.example', 80, pub, {
      resolve: never,
      resolveTimeoutMs: 50,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(upstreamFailureWording((err as Error).message)).toBe('the host name could not be resolved');
  });
});

describe('checkTargetDetailed', () => {
  it('marks an unresolvable .test name and leaves .localhost alone', async () => {
    const never = () => new Promise<never>(() => undefined);
    const bad = await checkTargetDetailed(new URL('http://nope.test/'), {
      resolver: never,
      resolveTimeoutMs: 50,
    });
    expect(bad).toEqual({ hostClass: 'local', unresolved: true });
    const ok = await checkTargetDetailed(new URL('http://app.localhost/'), { resolver: never });
    expect(ok).toEqual({ hostClass: 'local' });
  });
});

describe('checkTarget', () => {
  it('does not pre-resolve a local name (only the audit engine needs the answer)', async () => {
    let called = false;
    const resolver = async () => {
      called = true;
      throw new Error('nope');
    };
    expect(await checkTarget(new URL('http://nope.test/'), { resolver })).toBe('local');
    expect(called).toBe(false);
  });
});

describe('resolveInChild', () => {
  it('resolves a real name through the child', async () => {
    const answers = await resolveInChild('localhost', 5000);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0]).toHaveProperty('address');
  });

  it('passes an option-like host as data and executes nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-inject-'));
    try {
      const marker = join(dir, 'marker');
      const hosts = [
        `--eval=require("fs").writeFileSync(${JSON.stringify(marker)},"x");x.test`,
        '--eval=process.exit(7);x.test',
        '--require=x.test',
        '-p',
      ];
      for (const host of hosts) {
        const out = await resolveInChild(host, 5000).catch((e: unknown) => e);
        // A normal outcome: a lookup failure (or, never executed, an empty/real answer) - not an exit-7 crash.
        expect(Array.isArray(out) || out instanceof LookupFailed).toBe(true);
      }
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a lookup error as LookupFailed', async () => {
    await expect(resolveInChild('does-not-exist.invalid', 5000)).rejects.toBeInstanceOf(LookupFailed);
  });

  it('fails open when the child cannot be started or crashes', async () => {
    const spawnError = (_f: string, _a: string[], _o: unknown, cb: (e: Error, out: string) => void) => {
      cb(Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }), '');
    };
    expect(await resolveInChild('app.test', 5000, spawnError as never)).toEqual([]);
    const crash = (_f: string, _a: string[], _o: unknown, cb: (e: Error, out: string) => void) => {
      cb(Object.assign(new Error('boom'), { code: 1 }), '');
    };
    expect(await resolveInChild('app.test', 5000, crash as never)).toEqual([]);
    const throws = () => {
      throw new Error('sync spawn failure');
    };
    expect(await resolveInChild('app.test', 5000, throws as never)).toEqual([]);
  });

  it('counts the timeout kill as unresolved', async () => {
    const killed = (_f: string, _a: string[], _o: unknown, cb: (e: Error, out: string) => void) => {
      cb(Object.assign(new Error('killed'), { killed: true }), '');
    };
    await expect(resolveInChild('app.test', 5000, killed as never)).rejects.toBeInstanceOf(LookupFailed);
  });
});

describe('--deny-local', () => {
  const deny = { allowPrivate: false, denyLocal: true } as const;
  const refused = (u: string) => checkTarget(new URL(u), { denyLocal: true });

  it('refuses localhost, 127.0.0.1, [::1] and *.test / *.localhost with UNSAFE_URL, before any lookup', async () => {
    let looked = false;
    const resolver = async () => {
      looked = true;
      return [];
    };
    for (const u of [
      'http://localhost:3000/',
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://app.test/',
      'http://app.localhost/',
    ]) {
      await expect(refused(u)).rejects.toMatchObject({ code: 'UNSAFE_URL' });
      await expect(checkTargetDetailed(new URL(u), { denyLocal: true, resolver })).rejects.toThrow(
        /--deny-local is set/,
      );
    }
    expect(looked).toBe(false);
  });
  it('still allows local targets without the option, and public hosts with it', async () => {
    expect(await checkTarget(new URL('http://localhost:3000/'))).toBe('local');
    expect(await checkTarget(new URL('http://app.test/'))).toBe('local');
    expect(await checkTarget(new URL('https://example.com/'), { denyLocal: true, resolveDns: false })).toBe(
      'public',
    );
  });
  it('blocks loopback destinations even for a local target or with --allow-private', async () => {
    expect(addressVerdict('127.0.0.1', { target: 'local', allowPrivate: true, denyLocal: true }).ok).toBe(
      false,
    );
    expect(addressVerdict('127.0.0.1', { target: 'local', allowPrivate: false }).ok).toBe(true);
    expect(await resolveAllowed('127.0.0.1', 80, { target: 'local', ...deny })).toHaveProperty('blocked');
  });
  it('blocks a redirect from a public page to localhost or a *.test name, and says so', async () => {
    const from = new URL('https://example.test.public/a');
    const policy: AddressPolicy = { target: 'public', allowPrivate: true, denyLocal: true };
    expect(loopbackRedirectVerdict('http://127.0.0.1/', from, policy)).toMatch(/--deny-local/);
    expect(loopbackRedirectVerdict('http://app.test/', from, policy)).toMatch(/--deny-local/);
    expect(redirectEscape('http://localhost/', 'https://shop.example/', policy)).toMatch(/--deny-local/);
    // The guard resolves a public name for the first hop and refuses the loopback hop.
    const resolve = async (h: string) =>
      h === 'example.test.public' ? [{ address: '93.184.216.34', family: 4 }] : [];
    expect(await resolveAllowed('example.test.public', 443, policy, { resolve })).toMatchObject({
      address: '93.184.216.34',
    });
    expect(await resolveAllowed('127.0.0.1', 80, policy, { resolve })).toHaveProperty('blocked');
  });
});

describe('--deny-local hardening', () => {
  it('normalises a trailing dot', async () => {
    for (const h of ['localhost.', 'foo.localhost.', 'app.test.', 'LOCALHOST.'])
      expect(isLocalHostname(h)).toBe(true);
    await expect(checkTarget(new URL('http://localhost./'), { denyLocal: true })).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
    await expect(checkTarget(new URL('http://app.test./'), { denyLocal: true })).rejects.toMatchObject({
      code: 'UNSAFE_URL',
    });
  });
  it('refuses a public-looking name that resolves to loopback', async () => {
    const resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(
      checkTarget(new URL('http://127.0.0.1.nip.io/'), { denyLocal: true, resolver }),
    ).rejects.toThrow(/--deny-local is set/);
    expect(await checkTarget(new URL('http://127.0.0.1.nip.io/'), { resolver }).catch((e) => e.code)).toBe(
      'UNSAFE_URL',
    ); // still refused as before: a public target may not reach loopback
  });
  it('refuses a redirect to every loopback form, also with --allow-private', () => {
    const from = new URL('https://shop.example/a');
    const policy: AddressPolicy = { target: 'public', allowPrivate: true, denyLocal: true };
    for (const to of [
      'http://[::ffff:127.0.0.1]/',
      'http://localhost./',
      'http://127.1.2.3:6379/',
      'http://[::1]/',
      'http://0.0.0.0/',
      'http://app.test./',
    ])
      expect(loopbackRedirectVerdict(to, from, policy), to).toMatch(/--deny-local/);
  });
  it('lets a directory target reach only its own static server port', () => {
    const policy: AddressPolicy = {
      target: 'local',
      allowPrivate: false,
      denyLocal: true,
      allowLoopbackPorts: [4173],
    };
    expect(addressVerdict('127.0.0.1', policy, 4173).ok).toBe(true);
    expect(addressVerdict('127.0.0.1', policy, 6379).ok).toBe(false);
    expect(addressVerdict('::1', policy, 4173).ok).toBe(false);
    const from = new URL('http://127.0.0.1:4173/');
    expect(loopbackRedirectVerdict('http://127.0.0.1:4173/b', from, policy)).toBeNull();
    expect(loopbackRedirectVerdict('http://localhost:6379/', from, policy)).toMatch(/--deny-local/);
  });
  it('the guard answers 403 and records --deny-local for a redirect hop to localhost', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'http://localhost:6379/' }).end();
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const port = (upstream.address() as AddressInfo).port;
    const guard = await startNetGuard(
      { target: 'local', allowPrivate: false, denyLocal: true, allowLoopbackPorts: [port] },
      { resolve: async () => [{ address: '127.0.0.1', family: 4 }] },
    );
    const proxy = new URL(guard.url);
    const viaProxy = (url: string) =>
      new Promise<{ status: number; location?: string }>((resolve, reject) => {
        http
          .get(
            { host: proxy.hostname, port: proxy.port, path: url, headers: { host: new URL(url).host } },
            (res) => {
              res.resume();
              resolve({ status: res.statusCode ?? 0, location: res.headers.location });
            },
          )
          .on('error', reject);
      });
    try {
      // The guard reads the upstream's 302 and refuses it before the browser could follow it.
      expect((await viaProxy(`http://127.0.0.1:${port}/`)).status).toBe(403);
      expect(guard.blocked[0]!.reason).toContain('--deny-local');
      expect(guard.blocked[0]!.reason).toContain('localhost:6379');
      // A direct request to another loopback port is refused too.
      expect((await viaProxy('http://localhost:6379/')).status).toBe(403);
      expect(guard.blocked[1]).toMatchObject({ host: 'localhost', port: 6379 });
      expect(guard.blocked[1]!.reason).toContain('--deny-local');
    } finally {
      await guard.close();
      await new Promise((r) => upstream.close(r));
    }
  });
});

describe('upstream proxy: NO_PROXY per destination', () => {
  const upstream = { host: 'proxy.corp', port: 3128 };
  const policy = (noProxy: string): AddressPolicy => ({ ...pub, upstream: { ...upstream, noProxy } });
  it('a target in NO_PROXY goes direct while a CDN host still goes through the proxy', () => {
    const p = policy('example.com');
    expect(viaUpstream(p, 'example.com', '93.184.216.34', 443)).toBeUndefined();
    expect(viaUpstream(p, 'www.example.com', '93.184.216.34', 443)).toBeUndefined();
    expect(viaUpstream(p, 'cdn.other.net', '151.101.1.1', 443)).toMatchObject(upstream);
  });
  it('the reverse: a CDN host in NO_PROXY goes direct while the target goes through the proxy', () => {
    const p = policy('cdn.other.net:443');
    expect(viaUpstream(p, 'cdn.other.net', '151.101.1.1', 443)).toBeUndefined();
    expect(viaUpstream(p, 'cdn.other.net', '151.101.1.1', 80)).toMatchObject(upstream);
    expect(viaUpstream(p, 'example.com', '93.184.216.34', 443)).toMatchObject(upstream);
  });
  it('an IP entry matches a literal-IP destination; loopback is always direct', () => {
    expect(viaUpstream(policy('10.1.2.3'), '10.1.2.3', '10.1.2.3', 80)).toBeUndefined();
    expect(viaUpstream(policy(''), 'localhost', '127.0.0.1', 8080)).toBeUndefined();
    expect(viaUpstream({ ...pub, upstream }, 'example.com', '93.184.216.34', 443)).toMatchObject(upstream);
  });
});

describe('upstream proxy: plain HTTP, request framing and the guard lifetime', () => {
  const listen = (s: net.Server) =>
    new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
  const resolveExample = async () => [{ address: '93.184.216.34', family: 4 }];
  const closeServer = (s: net.Server) => new Promise((r) => s.close(r));

  /** GET through the guard as a browser sends plain HTTP to a proxy (absolute URI, Proxy-* headers). */
  const getVia = (guardUrl: string, url: string, headers: Record<string, string> = {}) =>
    new Promise<{ status?: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const p = new URL(guardUrl);
      http
        .get({ host: p.hostname, port: p.port, path: url, headers, agent: false }, (r) => {
          let body = '';
          r.on('data', (d) => (body += d));
          r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body }));
        })
        .on('error', reject);
    });

  it('plain HTTP is tunnelled to the checked IP (CONNECT ip:80) and the origin gets the original Host', async () => {
    const seen: { line: string; auth?: string }[] = [];
    const originHosts: string[] = [];
    const origin = http.createServer((req, res) => {
      originHosts.push(String(req.headers.host));
      res.end(`origin ${req.url}`);
    });
    const originPort = await listen(origin);
    let requestsByName = 0;
    // The stub tunnels any CONNECT to the local origin (the test cannot reach 93.184.216.34).
    const proxy = http.createServer((_req, res) => {
      requestsByName++;
      res.writeHead(405).end();
    });
    proxy.on('connect', (req, client: net.Socket) => {
      seen.push({
        line: `${req.method} ${req.url}`,
        ...(req.headers['proxy-authorization'] ? { auth: String(req.headers['proxy-authorization']) } : {}),
      });
      const up = net.connect(originPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.pipe(client);
        client.pipe(up);
      });
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    const proxyPort = await listen(proxy);
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port: proxyPort, auth: 'jourilo:s3cret' } },
      { resolve: resolveExample },
    );
    try {
      const res = await getVia(guard.url, 'http://example.com/plain?x=1', {
        host: 'example.com',
        'proxy-authorization': 'Basic browser-own',
      });
      expect(res).toMatchObject({ status: 200, body: 'origin /plain?x=1' });
      expect(seen).toEqual([
        {
          line: 'CONNECT 93.184.216.34:80',
          auth: `Basic ${Buffer.from('jourilo:s3cret').toString('base64')}`,
        },
      ]);
      expect(originHosts).toEqual(['example.com']);
      expect(requestsByName).toBe(0);
    } finally {
      await guard.close();
      await closeServer(proxy);
      await closeServer(origin);
    }
  });

  it('a proxy that refuses CONNECT to port 80 is a 502 with the token and fixed wording, never its page', async () => {
    let requestsByName = 0;
    const proxy = http.createServer((_req, res) => {
      requestsByName++;
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>proxy page</html>');
    });
    proxy.on('connect', (_req, client: net.Socket) => {
      client.end('HTTP/1.1 403 Forbidden\r\ncontent-type: text/html\r\n\r\n<html>proxy denied page</html>');
    });
    const proxyPort = await listen(proxy);
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port: proxyPort } },
      { resolve: resolveExample },
    );
    try {
      const res = await getVia(guard.url, 'http://example.com/', { host: 'example.com' });
      expect(res.status).toBe(502);
      expect(res.body).not.toMatch(/proxy (denied )?page/);
      expect(String(res.headers['x-jourilo-guard-upstream-error'])).toBe(
        `${guard.token} the upstream proxy refuses tunnels to port 80; give the target's https:// URL`,
      );
      expect(requestsByName).toBe(0);
    } finally {
      await guard.close();
      await closeServer(proxy);
    }
  });

  it('a 4xx CONNECT answer is a port refusal; a 5xx is a connection failure, not a refusal', async () => {
    for (const [answer, wording] of [
      [
        '405 Method Not Allowed',
        "the upstream proxy refuses tunnels to port 80; give the target's https:// URL",
      ],
      ['502 Bad Gateway', 'the upstream proxy could not open the connection'],
      ['503 Service Unavailable', 'the upstream proxy could not open the connection'],
    ] as const) {
      const proxy = http.createServer((_req, res) => res.writeHead(200).end('<html>proxy page</html>'));
      proxy.on('connect', (_req, client: net.Socket) =>
        client.end(`HTTP/1.1 ${answer}\r\ncontent-type: text/html\r\n\r\n<html>proxy error page</html>`),
      );
      const proxyPort = await listen(proxy);
      const guard = await startNetGuard(
        { ...pub, upstream: { host: '127.0.0.1', port: proxyPort } },
        { resolve: resolveExample },
      );
      try {
        const res = await getVia(guard.url, 'http://example.com/', { host: 'example.com' });
        expect(res.status, answer).toBe(502);
        expect(res.body, answer).not.toContain('proxy error page');
        expect(String(res.headers['x-jourilo-guard-upstream-error']), answer).toBe(
          `${guard.token} ${wording}`,
        );
      } finally {
        await guard.close();
        await closeServer(proxy);
      }
    }
  });

  it("a proxy 407 or an unreachable proxy is the guard's own 502 with the token signal", async () => {
    const asking = http.createServer((_req, res) =>
      res.writeHead(407, { 'proxy-authenticate': 'Basic' }).end('<html>proxy login page</html>'),
    );
    asking.on('connect', (_req, client: net.Socket) =>
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nproxy-authenticate: Basic\r\n\r\n<html>proxy login page</html>',
      ),
    );
    const askingPort = await listen(asking);
    const dead = net.createServer();
    const deadPort = await listen(dead);
    await closeServer(dead);
    for (const port of [askingPort, deadPort]) {
      const guard = await startNetGuard(
        { ...pub, upstream: { host: '127.0.0.1', port } },
        { resolve: resolveExample },
      );
      try {
        const res = await getVia(guard.url, 'http://example.com/', { host: 'example.com' });
        expect(res.status, String(port)).toBe(502);
        expect(res.body).not.toContain('proxy login page');
        expect(String(res.headers['x-jourilo-guard-upstream-error'])).toBe(
          `${guard.token} ${port === askingPort ? 'the upstream proxy asked for credentials (407)' : 'the upstream proxy could not open the connection'}`,
        );
      } finally {
        await guard.close();
      }
    }
    await closeServer(asking);
  });

  it('a chunked request body on a GET keeps its framing on the way to the server', async () => {
    const bodies: string[] = [];
    const origin = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        bodies.push(body);
        res.end(`got ${body.length}`);
      });
    });
    const originPort = await listen(origin);
    const guard = await startNetGuard({ target: 'local', allowPrivate: false });
    try {
      const p = new URL(guard.url);
      const raw = await new Promise<string>((resolve, reject) => {
        let out = '';
        const s = net.connect(Number(p.port), p.hostname, () =>
          s.write(
            `GET http://127.0.0.1:${originPort}/echo HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n`,
          ),
        );
        s.on('data', (d) => (out += d.toString('latin1')));
        s.on('close', () => resolve(out));
        s.on('error', reject);
      });
      expect(raw).toMatch(/^HTTP\/1\.1 200/);
      expect(raw).toContain('got 11');
      expect(bodies).toEqual(['hello world']);
    } finally {
      await guard.close();
      await closeServer(origin);
    }
  });

  /** A proxy that accepts connections and never answers; resolves with each connection's closed promise. */
  async function silentProxy() {
    const closes: Promise<void>[] = [];
    const proxy = net.createServer((s) => {
      s.on('error', () => undefined);
      // Read (and drop) the CONNECT request, so the end of the connection is seen.
      s.resume();
      closes.push(new Promise((r) => s.once('close', () => r())));
    });
    const port = await listen(proxy);
    return { proxy, port, closes };
  }
  const settledWithin = (p: Promise<unknown>, ms: number) =>
    Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);
  const connectTo = (guardUrl: string) => {
    const p = new URL(guardUrl);
    const s = net.connect(Number(p.port), p.hostname, () =>
      s.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'),
    );
    s.on('error', () => undefined);
    return s;
  };

  it('close() destroys a tunnel whose handshake with the proxy is still pending', async () => {
    const { proxy, port, closes } = await silentProxy();
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port } },
      { resolve: resolveExample },
    );
    const client = connectTo(guard.url);
    const deadline = Date.now() + 5000;
    while (!closes.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(closes).toHaveLength(1);
    await guard.close();
    expect(await settledWithin(closes[0]!, 1000)).toBe(true);
    client.destroy();
    await closeServer(proxy);
  });

  it('a tunnel opened after close() (its DNS answer came late) is destroyed at once', async () => {
    const { proxy, port, closes } = await silentProxy();
    let answer: () => void = () => undefined;
    const late = new Promise<void>((r) => {
      answer = r;
    });
    let asked: () => void = () => undefined;
    const lookedUp = new Promise<void>((r) => {
      asked = r;
    });
    const guard = await startNetGuard(
      { ...pub, upstream: { host: '127.0.0.1', port } },
      {
        resolve: async () => {
          asked();
          await late;
          return [{ address: '93.184.216.34', family: 4 }];
        },
      },
    );
    const client = connectTo(guard.url);
    await lookedUp;
    await guard.close();
    answer();
    // The guard may open the connection to the proxy, but it must not stay open.
    await new Promise((r) => setTimeout(r, 300));
    for (const c of closes) expect(await settledWithin(c, 1000)).toBe(true);
    client.destroy();
    await closeServer(proxy);
  });
});

describe('every allowed address is tried, in resolver order', () => {
  const listenOn = (s: net.Server, host = '127.0.0.1', port = 0) =>
    new Promise<number>((r) => s.listen(port, host, () => r((s.address() as AddressInfo).port)));
  const closeServer = (s: net.Server) => new Promise((r) => s.close(r));
  const local: AddressPolicy = { target: 'local', allowPrivate: false };
  const resolveTo =
    (...ips: string[]) =>
    async () =>
      ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  /** The addresses the guard opened a TCP connection to on `port` (spied on net.connect). */
  const connectsTo = (port: number) => {
    const spy = vi.spyOn(net, 'connect');
    return {
      hosts: () =>
        spy.mock.calls
          .map((c) => c[0] as unknown as { host?: string; port?: number })
          .filter((o) => typeof o === 'object' && Number(o.port) === port)
          .map((o) => o.host),
      restore: () => spy.mockRestore(),
    };
  };
  const getVia = (guardUrl: string, url: string) =>
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
  /** A CONNECT through the guard; resolves with the status line of its answer. */
  const connectVia = (guardUrl: string, authority: string) =>
    new Promise<string>((resolve, reject) => {
      const p = new URL(guardUrl);
      const s = net.connect(Number(p.port), p.hostname, () =>
        s.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      );
      s.once('data', (d) => {
        resolve(d.toString('latin1').split('\r\n')[0]!);
        s.destroy();
      });
      s.on('error', reject);
    });

  // Field evidence (Task 6, Task 8): on macOS "localhost" resolves to ::1 first, and a dev server listening only on
  // 127.0.0.1 answered "Bad gateway" to everything the guard proxied.
  it('a name resolving to [::1, 127.0.0.1] reaches a server that listens only on 127.0.0.1', async () => {
    const site = http.createServer((_req, res) => res.end('v4 only'));
    const port = await listenOn(site);
    const deps = { resolve: resolveTo('::1', '127.0.0.1') };
    const spy = connectsTo(port);
    const guard = await startNetGuard(local, deps);
    try {
      expect(
        await guardedFetchText(`http://dual.test:${port}/robots.txt`, local, {
          timeoutMs: 3000,
          userAgent: 'test',
          deps,
        }),
      ).toBe('v4 only');
      const res = await guardedFetch(`http://dual.test:${port}/`, local, { timeoutMs: 3000, deps });
      expect(await res.text()).toBe('v4 only');
      expect(await getVia(guard.url, `http://dual.test:${port}/`)).toMatchObject({
        status: 200,
        body: 'v4 only',
      });
      expect(await connectVia(guard.url, `dual.test:${port}`)).toMatch(/^HTTP\/1\.1 200/);
      // Each request tried ::1 first, then 127.0.0.1.
      expect(spy.hosts()).toEqual([
        '::1',
        '127.0.0.1',
        '::1',
        '127.0.0.1',
        '::1',
        '127.0.0.1',
        '::1',
        '127.0.0.1',
      ]);
    } finally {
      spy.restore();
      await guard.close();
      await closeServer(site);
    }
  });

  it('the real resolver: a 127.0.0.1-only server is reachable through "localhost"', async () => {
    const site = http.createServer((_req, res) => res.end('through localhost'));
    const port = await listenOn(site);
    const guard = await startNetGuard(local);
    try {
      expect(await getVia(guard.url, `http://localhost:${port}/`)).toMatchObject({
        status: 200,
        body: 'through localhost',
      });
    } finally {
      await guard.close();
      await closeServer(site);
    }
  });

  it('a fallback never reaches an address the policy refuses', async () => {
    const site = http.createServer((_req, res) => res.end('allowed'));
    const port = await listenOn(site);
    // Only loopback at this port counts as public; 10.0.0.1 and 169.254.169.254 stay refused by the real rules.
    const verdict = (ip: string, p: number) =>
      p === port && classifyIp(ip) === 'loopback' ? ({ ok: true } as const) : addressVerdict(ip, pub);
    const spy = connectsTo(port);
    try {
      const deps = { resolve: resolveTo('::1', '10.0.0.1', '169.254.169.254', '127.0.0.1'), verdict };
      const res = await guardedFetch(`http://mixed.example:${port}/`, pub, { timeoutMs: 3000, deps });
      expect(await res.text()).toBe('allowed');
      expect(spy.hosts()).toEqual(['::1', '127.0.0.1']);
      // Every allowed address refuses: the refused one behind them is still never tried.
      await closeServer(site);
      const refused = { resolve: resolveTo('::1', '10.0.0.1'), verdict };
      await expect(
        guardedFetch(`http://mixed.example:${port}/`, pub, { timeoutMs: 3000, deps: refused }),
      ).rejects.toThrow(/ECONNREFUSED/);
      expect(spy.hosts()).not.toContain('10.0.0.1');
      expect(spy.hosts()).not.toContain('169.254.169.254');
    } finally {
      spy.restore();
      if (site.listening) await closeServer(site);
    }
  });

  it('every allowed address refusing gives the existing connection-refused error', async () => {
    const probe = net.createServer();
    const port = await listenOn(probe);
    await closeServer(probe);
    const deps = { resolve: resolveTo('::1', '127.0.0.1') };
    const spy = connectsTo(port);
    const guard = await startNetGuard(local, deps);
    try {
      await expect(
        guardedFetch(`http://dual.test:${port}/`, local, { timeoutMs: 3000, deps }),
      ).rejects.toThrow(`dual.test:${port}: ECONNREFUSED`);
      const res = await getVia(guard.url, `http://dual.test:${port}/`);
      expect(res.status).toBe(502);
      expect(res.headers['x-jourilo-guard-upstream-error']).toBe(`${guard.token} the connection was refused`);
      expect(await connectVia(guard.url, `dual.test:${port}`)).toMatch(/^HTTP\/1\.1 502/);
      expect(spy.hosts()).toEqual(['::1', '127.0.0.1', '::1', '127.0.0.1', '::1', '127.0.0.1']);
    } finally {
      spy.restore();
      await guard.close();
    }
  });

  it('an error after the connection is made (HTTP error, reset, TLS) does not fall back', async () => {
    const site = http.createServer((req, res) => {
      if (req.url === '/reset') return void req.socket.destroy();
      res.writeHead(500).end('server error');
    });
    const port = await listenOn(site);
    const deps = { resolve: resolveTo('127.0.0.1', '::1') };
    const spy = connectsTo(port);
    const guard = await startNetGuard(local, deps);
    try {
      const res = await guardedFetch(`http://dual.test:${port}/`, local, { timeoutMs: 3000, deps });
      expect(res.status).toBe(500);
      await expect(
        guardedFetch(`http://dual.test:${port}/reset`, local, { timeoutMs: 3000, deps }),
      ).rejects.toThrow(/ECONNRESET|socket hang up/);
      // A TLS handshake with a plain-HTTP server fails after the TCP connection is made.
      await expect(
        guardedFetch(`https://dual.test:${port}/`, local, { timeoutMs: 3000, deps }),
      ).rejects.toThrow();
      expect((await getVia(guard.url, `http://dual.test:${port}/`)).status).toBe(500);
      expect(spy.hosts()).toEqual(['127.0.0.1', '127.0.0.1', '127.0.0.1', '127.0.0.1']);
    } finally {
      spy.restore();
      await guard.close();
      await closeServer(site);
    }
  });

  it('an address that does not answer the connect falls back after its attempt timeout, within one budget', async () => {
    const site = http.createServer((_req, res) => res.end('answered'));
    const port = await listenOn(site);
    const silent = ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4', '192.0.2.5'];
    const orig = net.connect.bind(net);
    // The documentation addresses stand for hosts that never answer the SYN: their socket never connects.
    const spy = vi
      .spyOn(net, 'connect')
      .mockImplementation(((o: net.NetConnectOpts) =>
        silent.includes((o as net.TcpNetConnectOpts).host ?? '')
          ? new net.Socket()
          : orig(o)) as typeof net.connect);
    const verdict = (_ip: string, p: number) =>
      p === port ? ({ ok: true } as const) : ({ ok: false, reason: 'other port' } as const);
    try {
      const fallback = {
        resolve: resolveTo('192.0.2.1', '127.0.0.1'),
        verdict,
        connectAttemptTimeoutMs: 100,
      };
      const res = await guardedFetch(`http://slow.example:${port}/`, pub, {
        timeoutMs: 3000,
        deps: fallback,
      });
      expect(await res.text()).toBe('answered');
      // Five silent addresses with a 300 ms budget: the request fails in about 300 ms, not 5 x the attempt time.
      const hanging = {
        resolve: resolveTo(...silent),
        verdict,
        connectAttemptTimeoutMs: 200,
        connectTimeoutMs: 300,
      };
      const started = Date.now();
      await expect(
        guardedFetch(`http://slow.example:${port}/`, pub, { timeoutMs: 3000, deps: hanging }),
      ).rejects.toThrow(/ETIMEDOUT/);
      expect(Date.now() - started).toBeLessThan(900);
      const tried = spy.mock.calls.map((c) => (c[0] as unknown as net.TcpNetConnectOpts).host);
      expect(tried).toEqual(['192.0.2.1', '127.0.0.1', '192.0.2.1', '192.0.2.2']);
    } finally {
      spy.mockRestore();
      await closeServer(site);
    }
  });
});
