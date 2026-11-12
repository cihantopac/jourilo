import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from '../../src/core/fs-safety.js';
import { excerpt, redactText, redactUrl } from '../../src/core/redact.js';
import {
  addressVerdict,
  checkTarget,
  classifyIp,
  crawlKey,
  isCrawlable,
  isPrivateIp,
  normalizeForCrawl,
  parseTargetUrl,
} from '../../src/core/url-safety.js';

describe('redaction', () => {
  it('removes tokens, keys, emails and card numbers', () => {
    const s = redactText(
      'Bearer abcdefghijklmnop sk_live_abcdefghijkl me@example.com 4242 4242 4242 4242 password=hunter22 eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl',
    );
    expect(s).not.toMatch(/abcdefghijklmnop|sk_live|me@example|4242 4242|hunter22|eyJhbGciOi/);
  });
  it('redacts sensitive query parameters and credentials in URLs', () => {
    const u = redactUrl('https://user:pw@app.test/cb?code=abc123&state=ok&api_key=xyz#access_token=t');
    expect(u).not.toContain('abc123');
    expect(u).not.toContain('xyz');
    expect(u).not.toContain('pw@');
    expect(u).toContain('state=ok');
    expect(u).not.toContain('access_token=t');
  });
  it('bounds excerpts', () => {
    expect(excerpt('a'.repeat(1000), 50)).toHaveLength(50);
  });
});

describe('url safety', () => {
  it('accepts http(s) only', () => {
    expect(() => parseTargetUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => parseTargetUrl('javascript:alert(1)')).toThrow();
    expect(parseTargetUrl('example.com').toString()).toBe('https://example.com/');
  });
  it('classifies private addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '169.254.169.254',
      '127.0.0.1',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860::8888']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('allows local dev hosts but refuses private hosts without opt-in', async () => {
    expect(await checkTarget(new URL('http://localhost:3000'), { resolveDns: false })).toBe('local');
    expect(await checkTarget(new URL('http://app.test'), { resolveDns: false })).toBe('local');
    await expect(
      checkTarget(new URL('http://169.254.169.254/latest'), { resolveDns: false }),
    ).rejects.toThrow(/metadata/);
    await expect(checkTarget(new URL('http://10.1.2.3'), { resolveDns: false })).rejects.toThrow(/private/);
    expect(await checkTarget(new URL('http://10.1.2.3'), { allowPrivate: true, resolveDns: false })).toBe(
      'private',
    );
  });
  it('classifies special-purpose IPv4 and IPv6 ranges, including embedded IPv4', () => {
    const cases: Record<string, string> = {
      '0.0.0.0': 'loopback',
      '0.1.2.3': 'reserved',
      '127.255.0.9': 'loopback',
      '10.20.30.40': 'private',
      '172.31.255.255': 'private',
      '192.168.0.10': 'private',
      '100.64.0.1': 'private',
      '169.254.1.1': 'link-local',
      '169.254.169.254': 'metadata',
      '169.254.170.2': 'metadata',
      '100.100.100.200': 'metadata',
      '192.0.2.5': 'reserved',
      '198.18.0.1': 'reserved',
      '198.51.100.7': 'reserved',
      '203.0.113.9': 'reserved',
      '224.0.0.1': 'reserved',
      '255.255.255.255': 'reserved',
      '8.8.8.8': 'public',
      '172.32.0.1': 'public',
      '::': 'loopback',
      '::1': 'loopback',
      '0:0:0:0:0:0:0:1': 'loopback',
      '::ffff:127.0.0.1': 'loopback',
      '::ffff:7f00:1': 'loopback',
      '::ffff:a9fe:a9fe': 'metadata',
      '::127.0.0.1': 'loopback',
      '64:ff9b::a00:1': 'private',
      '64:ff9b::808:808': 'public',
      '2002:c0a8:0101::1': 'private',
      '2002:0808:0808::1': 'public',
      'fd00:ec2::254': 'metadata',
      'fc00::1': 'private',
      'fd12:3456::1': 'private',
      'fe80::1%en0': 'link-local',
      'fec0::1': 'private',
      'ff02::1': 'reserved',
      '2001:db8::1': 'reserved',
      '2001:4860:4860::8888': 'public',
      '[::1]': 'loopback',
    };
    for (const [ip, cls] of Object.entries(cases)) expect(classifyIp(ip), ip).toBe(cls);
  });

  it('applies the address policy per target class', () => {
    const pub = { target: 'public' as const, allowPrivate: false };
    const local = { target: 'local' as const, allowPrivate: false };
    const opted = { target: 'public' as const, allowPrivate: true };
    expect(addressVerdict('93.184.216.34', pub).ok).toBe(true);
    expect(addressVerdict('127.0.0.1', pub).ok).toBe(false);
    expect(addressVerdict('127.0.0.1', local).ok).toBe(true);
    expect(addressVerdict('192.168.1.5', local).ok).toBe(false);
    expect(addressVerdict('192.168.1.5', opted).ok).toBe(true);
    // Metadata and reserved ranges stay blocked even with --allow-private.
    expect(addressVerdict('169.254.169.254', opted).ok).toBe(false);
    expect(addressVerdict('fd00:ec2::254', { target: 'local', allowPrivate: true }).ok).toBe(false);
    expect(addressVerdict('198.18.0.1', opted).ok).toBe(false);
  });

  it('refuses host names with mixed public and private DNS answers (rebinding)', async () => {
    const answers =
      (...ips: string[]) =>
      async () =>
        ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    const u = new URL('https://rebind.example.com/');
    await expect(checkTarget(u, { resolver: answers('93.184.216.34', '127.0.0.1') })).rejects.toThrow(
      /both public and private.*rebinding/,
    );
    await expect(checkTarget(u, { resolver: answers('93.184.216.34', '::ffff:10.0.0.1') })).rejects.toThrow(
      /both public and private/,
    );
    await expect(checkTarget(u, { resolver: answers('10.0.0.7') })).rejects.toThrow(/private network/);
    expect(await checkTarget(u, { resolver: answers('93.184.216.34', '2606:2800:220:1::1') })).toBe('public');
    expect(await checkTarget(u, { resolver: answers('93.184.216.34', '10.0.0.1'), allowPrivate: true })).toBe(
      'private',
    );
    // Metadata answers are refused even when private networks are allowed.
    await expect(
      checkTarget(u, { resolver: answers('169.254.169.254'), allowPrivate: true }),
    ).rejects.toThrow(/metadata/);
    // A DNS failure is not a pass or a refusal: the browser reports it with evidence.
    expect(
      await checkTarget(u, {
        resolver: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).toBe('public');
  });

  it('normalizes numeric host forms before classifying them', async () => {
    for (const raw of [
      'http://2130706433/',
      'http://0x7f.1/',
      'http://0177.0.0.1/',
      'http://[::ffff:127.0.0.1]/',
    ])
      expect(await checkTarget(parseTargetUrl(raw), { resolveDns: false }), raw).toBe('local');
    await expect(checkTarget(parseTargetUrl('http://0xa9.0xfe.0xa9.0xfe/'), {})).rejects.toThrow(/metadata/);
  });

  it('keeps crawling on origin and away from destructive or binary URLs', () => {
    const o = 'https://shop.test';
    expect(isCrawlable('https://shop.test/pricing', o)).toBe(true);
    expect(isCrawlable('https://evil.test/', o)).toBe(false);
    expect(isCrawlable('https://shop.test/logout', o)).toBe(false);
    expect(isCrawlable('https://shop.test/account/delete', o)).toBe(false);
    expect(isCrawlable('https://shop.test/report.pdf', o)).toBe(false);
    expect(normalizeForCrawl('https://shop.test/a/?utm_source=x&id=2#top')).toBe('https://shop.test/a/?id=2');
    expect(crawlKey('https://shop.test/a/?utm_source=x&id=2#top')).toBe('https://shop.test/a?id=2');
  });
});

describe('path safety', () => {
  it('refuses traversal, absolute paths and symlink escapes', () => {
    const root = mkdtempSync(join(tmpdir(), 'jourilo-'));
    mkdirSync(join(root, 'runs'));
    writeFileSync(join(root, 'runs', 'a.json'), '{}');
    expect(resolveInside(join(root, 'runs'), 'a.json')).toContain('a.json');
    expect(() => resolveInside(join(root, 'runs'), '../secret')).toThrow(/escapes/);
    expect(() => resolveInside(join(root, 'runs'), '/etc/passwd')).toThrow(/escapes/);
    symlinkSync(tmpdir(), join(root, 'runs', 'link'));
    expect(() => resolveInside(join(root, 'runs'), 'link')).toThrow(/escapes/);
  });
});

describe('static server', () => {
  it('serves SPA routes, refuses traversal and keeps a stable port per directory', async () => {
    const { serveStatic, stablePort, looksLikeSpa } = await import('../../src/core/static-server.js');
    const dir = join(import.meta.dirname, '../../fixtures/apps/pulse-dashboard');
    expect(looksLikeSpa(dir)).toBe(true);
    expect(stablePort(dir)).toBe(stablePort(dir));
    const s = await serveStatic(dir);
    try {
      expect(new URL(s.url).port).toBe(String(stablePort(dir)));
      expect(new URL(s.url).hostname).toBe('127.0.0.1');
      const spa = await fetch(`${s.url}/analytics/report-3`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain('<div id="app">');
      const evil = await fetch(`${s.url}/..%2F..%2Fpackage.json`);
      expect([403, 404]).toContain(evil.status);
      expect((await fetch(`${s.url}/app.js.map`)).status).toBe(404);
      // Hidden files are never served, and malformed escapes do not crash the server.
      for (const p of ['/.env', '/.git/config', '/sub/.npmrc', '/%2Eenv'])
        expect((await fetch(`${s.url}${p}`)).status, p).toBe(404);
      expect((await fetch(`${s.url}/%E0%A4%A`)).status).toBe(400);
      expect((await fetch(`${s.url}/`)).status).toBe(200);
    } finally {
      await s.close();
    }
  });
});

describe('static server redirects', () => {
  it('answers the redirects a fixture declares with 301 and serves everything else as before', async () => {
    const { serveStatic } = await import('../../src/core/static-server.js');
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-redirects-'));
    writeFileSync(join(dir, 'index.html'), '<h1>x</h1>');
    writeFileSync(join(dir, 'new.html'), '<h1>new</h1>');
    writeFileSync(join(dir, 'jourilo-fixture.json'), JSON.stringify({ redirects: { '/old': '/new' } }));
    const s = await serveStatic(dir);
    try {
      for (const p of ['/old', '/old/']) {
        const r = await fetch(`${s.url}${p}`, { redirect: 'manual' });
        expect([r.status, r.headers.get('location')], p).toEqual([301, '/new']);
      }
      expect(await (await fetch(`${s.url}/old`)).text()).toContain('<h1>new</h1>');
      expect((await fetch(`${s.url}/new`, { redirect: 'manual' })).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it('ignores a redirect value that is not a same-origin path, without crashing on CR/LF', async () => {
    const { serveStatic } = await import('../../src/core/static-server.js');
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-redirects-bad-'));
    writeFileSync(join(dir, 'index.html'), '<h1>x</h1>');
    writeFileSync(join(dir, 'new.html'), '<h1>new</h1>');
    writeFileSync(
      join(dir, 'jourilo-fixture.json'),
      JSON.stringify({
        redirects: {
          '/crlf': '/new\r\nSet-Cookie: x=1',
          '/proto': '//evil.test/',
          '/back': '/\\evil.test/',
          '/abs': 'https://evil.test/',
          '/num': 5,
          '/ok': '/new',
        },
      }),
    );
    const s = await serveStatic(dir);
    try {
      for (const p of ['/crlf', '/proto', '/back', '/abs', '/num']) {
        const r = await fetch(`${s.url}${p}`, { redirect: 'manual' });
        expect(r.status, p).toBe(404);
        expect(r.headers.get('location'), p).toBeNull();
      }
      const ok = await fetch(`${s.url}/ok`, { redirect: 'manual' });
      expect([ok.status, ok.headers.get('location')]).toEqual([301, '/new']);
    } finally {
      await s.close();
    }
  });
});

describe('static server and secrets', () => {
  it('does not serve hidden files that exist in the served directory', async () => {
    const { serveStatic } = await import('../../src/core/static-server.js');
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-serve-'));
    writeFileSync(join(dir, 'index.html'), '<h1>x</h1>');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.git', 'config'), '[core]');
    const s = await serveStatic(dir);
    try {
      expect((await fetch(`${s.url}/.env`)).status).toBe(404);
      expect((await fetch(`${s.url}/.git/config`)).status).toBe(404);
      expect(await (await fetch(`${s.url}/`)).text()).toContain('<h1>x</h1>');
    } finally {
      await s.close();
    }
  });
});

describe('environment', () => {
  it('refuses unsupported Node.js versions', async () => {
    const { nodeSupported } = await import('../../src/cli/main.js');
    expect(['18.20.4', '20.9.0', 'v19.0.0'].map(nodeSupported)).toEqual([false, false, false]);
    expect(['20.10.0', '22.23.2', '24.1.0'].map(nodeSupported)).toEqual([true, true, true]);
  });
});
