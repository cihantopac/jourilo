// Host allow/block lists and the upstream proxy settings (F15): which hosts the guard refuses by name, and which proxy
// (if any) a run chains to, from --proxy or the usual environment variables.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Context, hostListsFrom, proxyFrom } from '../../src/cli/framework.js';
import type { JouriloError } from '../../src/core/errors.js';
import {
  type AddressPolicy,
  hostListsFor,
  hostMatches,
  hostVerdict,
  noProxyMatches,
  upstreamLabel,
} from '../../src/core/url-safety.js';

function ctxWith(values: Context['values']): Context {
  return { values, positionals: [], json: false, log: () => undefined } as unknown as Context;
}

function thrown(fn: () => unknown): JouriloError {
  try {
    fn();
  } catch (err) {
    return err as JouriloError;
  }
  throw new Error('expected an error');
}

const pub: AddressPolicy = { target: 'public', allowPrivate: false };

describe('host patterns', () => {
  it('matches a host exactly or, with *., any subdomain (not the apex)', () => {
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('EXAMPLE.com.', 'example.com')).toBe(true);
    expect(hostMatches('www.example.com', 'example.com')).toBe(false);
    expect(hostMatches('a.cdn.example.com', '*.cdn.example.com')).toBe(true);
    expect(hostMatches('a.b.cdn.example.com', '*.cdn.example.com')).toBe(true);
    expect(hostMatches('cdn.example.com', '*.cdn.example.com')).toBe(false);
    expect(hostMatches('evilcdn.example.com', '*.cdn.example.com')).toBe(false);
    expect(hostMatches('[::1]', '::1')).toBe(true);
  });

  it('--block-hosts refuses matching hosts; --allow-hosts refuses every other host', () => {
    const block = hostVerdict('pixel.tracker.test', { ...pub, blockHosts: ['*.tracker.test'] });
    expect(block.ok).toBe(false);
    expect(!block.ok && block.reason).toContain('--block-hosts');
    expect(hostVerdict('shop.example', { ...pub, blockHosts: ['*.tracker.test'] }).ok).toBe(true);

    const allow: AddressPolicy = { ...pub, allowHosts: ['shop.example', 'example.com', '*.cdn.example.com'] };
    expect(hostVerdict('example.com', allow).ok).toBe(true);
    expect(hostVerdict('img.cdn.example.com', allow).ok).toBe(true);
    const other = hostVerdict('fonts.other.example', allow);
    expect(other.ok).toBe(false);
    expect(!other.ok && other.reason).toContain('--allow-hosts');
    expect(hostVerdict('anything.example', pub).ok).toBe(true);
  });

  it("always allows the target's own host and refuses a block list that blocks the target", () => {
    const target = new URL('https://shop.example/a');
    expect(hostListsFor(target, ['example.com', '*.cdn.example.com'], [])).toEqual({
      allowHosts: ['example.com', '*.cdn.example.com', 'shop.example'],
    });
    expect(hostListsFor(target, [], [])).toEqual({});
    expect(hostListsFor(target, [], ['*.tracker.test'])).toEqual({ blockHosts: ['*.tracker.test'] });
    expect(thrown(() => hostListsFor(target, [], ['shop.example'])).code).toBe('USAGE');
  });

  it('parses comma-separated, repeatable lists and refuses patterns that are not host names', () => {
    expect(
      hostListsFrom(
        ctxWith({ 'allow-hosts': ['example.com, *.cdn.example.com'], 'block-hosts': ['A.test'] }),
      ),
    ).toEqual({ allowHosts: ['example.com', '*.cdn.example.com'], blockHosts: ['a.test'] });
    expect(hostListsFrom(ctxWith({}))).toEqual({ allowHosts: [], blockHosts: [] });
    for (const bad of ['https://example.com', 'example.com/path', 'ex*mple.com', '*', 'a.*.com'])
      expect(thrown(() => hostListsFrom(ctxWith({ 'block-hosts': [bad] }))).code, bad).toBe('USAGE');
  });
});

describe('NO_PROXY', () => {
  it('matches host suffixes with or without a leading dot, ports, and * for everything', () => {
    expect(noProxyMatches('example.com', 443, 'example.com')).toBe(true);
    expect(noProxyMatches('www.example.com', 443, 'example.com')).toBe(true);
    expect(noProxyMatches('www.example.com', 443, '.example.com')).toBe(true);
    expect(noProxyMatches('www.example.com', 443, '*.example.com')).toBe(true);
    expect(noProxyMatches('notexample.com', 443, 'example.com')).toBe(false);
    expect(noProxyMatches('example.com', 443, 'other.test, example.com:8443')).toBe(false);
    expect(noProxyMatches('example.com', 8443, 'other.test, example.com:8443')).toBe(true);
    expect(noProxyMatches('anything.example', 80, '*')).toBe(true);
    expect(noProxyMatches('10.1.2.3', 80, '10.1.2.3')).toBe(true);
    expect(noProxyMatches('example.com', 443, '')).toBe(false);
  });
});

describe('proxyFrom', () => {
  const VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'];
  beforeEach(() => {
    for (const v of VARS) vi.stubEnv(v, undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  const https = new URL('https://example.com/');

  it('reads --proxy with credentials, which are kept out of the label', () => {
    const up = proxyFrom(ctxWith({ proxy: 'http://user:p%40ss@proxy.corp:3128' }), https);
    expect(up).toEqual({ host: 'proxy.corp', port: 3128, auth: 'user:p@ss' });
    expect(upstreamLabel(up!)).toBe('http://proxy.corp:3128');
    expect(proxyFrom(ctxWith({ proxy: 'http://proxy.corp' }), https)).toEqual({
      host: 'proxy.corp',
      port: 80,
    });
  });

  it('falls back to HTTPS_PROXY / HTTP_PROXY in either case, matching the target scheme first', () => {
    expect(proxyFrom(ctxWith({}), https)).toBeUndefined();
    vi.stubEnv('https_proxy', 'http://secure.corp:8443');
    vi.stubEnv('HTTP_PROXY', 'plain.corp:3128');
    expect(proxyFrom(ctxWith({}), https)).toEqual({ host: 'secure.corp', port: 8443 });
    expect(proxyFrom(ctxWith({}), new URL('http://example.com/'))).toEqual({
      host: 'plain.corp',
      port: 3128,
    });
    expect(proxyFrom(ctxWith({ proxy: 'http://cli.corp:1' }), https)).toEqual({ host: 'cli.corp', port: 1 });
  });

  it('NO_PROXY is carried with the proxy and decided per destination; NO_PROXY=* means no proxy', () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.corp:3128');
    vi.stubEnv('NO_PROXY', 'example.com');
    const carried = { host: 'proxy.corp', port: 3128, noProxy: 'example.com' };
    expect(proxyFrom(ctxWith({}), https)).toEqual(carried);
    expect(proxyFrom(ctxWith({}), new URL('https://shop.test/'))).toEqual(carried);
    vi.stubEnv('NO_PROXY', undefined);
    vi.stubEnv('no_proxy', '*');
    expect(proxyFrom(ctxWith({ proxy: 'http://proxy.corp:3128' }), https)).toBeUndefined();
  });

  it('refuses proxies it cannot use without echoing their credentials', () => {
    for (const bad of [
      'socks5://user:hunter2@proxy.corp:1080',
      'https://user:hunter2@proxy.corp',
      'http://',
    ]) {
      const err = thrown(() => proxyFrom(ctxWith({ proxy: bad }), https));
      expect(err.code, bad).toBe('USAGE');
      expect(err.message).not.toContain('hunter2');
      expect(err.hint ?? '').not.toContain('hunter2');
    }
    vi.stubEnv('HTTPS_PROXY', 'ftp://user:hunter2@proxy.corp');
    const err = thrown(() => proxyFrom(ctxWith({}), https));
    expect(err.code).toBe('USAGE');
    expect(err.message).toContain('HTTPS_PROXY');
    expect(err.message).not.toContain('hunter2');
    // A proxy from the environment names the way out: go direct.
    expect(err.hint).toMatch(/NO_PROXY=\*/);
    expect(err.hint).toMatch(/unset HTTPS_PROXY/);
  });
});
