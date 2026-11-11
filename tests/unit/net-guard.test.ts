// Node-side fetches (robots.txt, sitemaps) and the guard's resolver must apply the address policy on every hop.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardedFetchText,
  loopbackRedirectVerdict,
  redirectEscape,
  resolveAllowed,
  upstreamFailureWording,
} from '../../src/core/net-guard.js';
import {
  type AddressPolicy,
  addressVerdict,
  checkTarget,
  checkTargetDetailed,
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
