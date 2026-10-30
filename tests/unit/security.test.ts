import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from '../../src/core/fs-safety.js';
import { excerpt, redactText, redactUrl } from '../../src/core/redact.js';
import {
  checkTarget,
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
    ).rejects.toThrow(/private/);
    expect(await checkTarget(new URL('http://10.1.2.3'), { allowPrivate: true, resolveDns: false })).toBe(
      'private',
    );
  });
  it('keeps crawling on origin and away from destructive or binary URLs', () => {
    const o = 'https://shop.test';
    expect(isCrawlable('https://shop.test/pricing', o)).toBe(true);
    expect(isCrawlable('https://evil.test/', o)).toBe(false);
    expect(isCrawlable('https://shop.test/logout', o)).toBe(false);
    expect(isCrawlable('https://shop.test/account/delete', o)).toBe(false);
    expect(isCrawlable('https://shop.test/report.pdf', o)).toBe(false);
    expect(normalizeForCrawl('https://shop.test/a/?utm_source=x&id=2#top')).toBe('https://shop.test/a?id=2');
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
    } finally {
      await s.close();
    }
  });
});
