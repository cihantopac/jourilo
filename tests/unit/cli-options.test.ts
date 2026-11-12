import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type Command,
  type Context,
  chromiumSandboxFrom,
  extraHeadersFrom,
  maxDurationOption,
  pagesOption,
  parse,
  parseStateOptions,
} from '../../src/cli/framework.js';
import type { JouriloError } from '../../src/core/errors.js';

function ctxWith(values: Context['values']): Context {
  return { values, positionals: [], json: false, log: () => undefined } as unknown as Context;
}

function usageError(values: Context['values']): JouriloError {
  try {
    parseStateOptions(ctxWith(values));
  } catch (err) {
    return err as JouriloError;
  }
  throw new Error('expected parseStateOptions to throw');
}

describe('parseStateOptions', () => {
  it('rejects an unknown time zone and an invalid clock', () => {
    expect(usageError({ timezone: 'Mars/Base' }).code).toBe('USAGE');
    expect(usageError({ clock: 'tomorrow' }).code).toBe('USAGE');
  });
  it('returns only the options that were given', () => {
    expect(parseStateOptions(ctxWith({}))).toEqual({});
    expect(
      parseStateOptions(ctxWith({ timezone: 'Europe/Istanbul', clock: '2026-11-03T22:30:00+03:00' })),
    ).toEqual({ timezoneId: 'Europe/Istanbul', clock: '2026-11-03T22:30:00+03:00' });
  });
});

function thrown(fn: () => unknown): JouriloError {
  try {
    fn();
  } catch (err) {
    return err as JouriloError;
  }
  throw new Error('expected a usage error');
}

describe('limits', () => {
  it('--max-duration outside 1..86400 is a usage error', () => {
    for (const v of ['0', '-1', 'abc', '86401', '', 'Infinity']) {
      const err = thrown(() => maxDurationOption(ctxWith({ 'max-duration': v })));
      expect(err.code, v).toBe('USAGE');
      expect(err.message, v).toContain('--max-duration');
    }
    expect(maxDurationOption(ctxWith({}))).toBeUndefined();
    expect(maxDurationOption(ctxWith({ 'max-duration': '1' }))).toBe(1);
    expect(maxDurationOption(ctxWith({ 'max-duration': '86400' }))).toBe(86_400);
  });
  it('--pages 0 is a usage error', () => {
    for (const v of ['0', '-1', '1.5', 'abc', '']) {
      const err = thrown(() => pagesOption(ctxWith({ pages: v }), 6));
      expect(err.code, v).toBe('USAGE');
      expect(err.message, v).toContain('--pages');
    }
    expect(pagesOption(ctxWith({}), 6)).toBe(6);
    expect(pagesOption(ctxWith({ pages: '1' }), 6)).toBe(1);
    expect(pagesOption(ctxWith({ pages: '40' }), 6)).toBe(40);
  });
});

describe('request options', () => {
  it('--extra-header parses "Name: value", rejects a malformed or hop-by-hop header with USAGE', () => {
    expect(extraHeadersFrom(ctxWith({}))).toBeUndefined();
    expect(
      extraHeadersFrom(
        ctxWith({ 'extra-header': ['X-Test: 1', 'Authorization:Bearer abc def', 'X-Spaced:   v  '] }),
      ),
    ).toEqual({ 'X-Test': '1', Authorization: 'Bearer abc def', 'X-Spaced': 'v' });
    const secret = 's3cret-v4lue';
    for (const raw of [
      `NoColon ${secret}`,
      `: ${secret}`,
      `Bad Name: ${secret}`,
      'X-Empty:',
      `X-Ctl: a\r\nInjected: ${secret}`,
      `X-Nul: a\u0000${secret}`,
      // Hop-by-hop headers, and headers the browser's network stack owns.
      `Connection: ${secret}`,
      `Keep-Alive: ${secret}`,
      `Proxy-Authenticate: ${secret}`,
      `proxy-authorization: ${secret}`,
      `Proxy-Connection: ${secret}`,
      `TE: ${secret}`,
      `Trailer: ${secret}`,
      `Transfer-Encoding: ${secret}`,
      `Upgrade: ${secret}`,
      `Host: ${secret}`,
      `Content-Length: ${secret}`,
      `Cookie: ${secret}`,
    ]) {
      const err = thrown(() => extraHeadersFrom(ctxWith({ 'extra-header': [raw] })));
      expect(err.code, raw).toBe('USAGE');
      expect(err.message, raw).toContain('--extra-header');
      // A header value may be a credential: it is never repeated.
      expect(`${err.message} ${err.hint ?? ''}`, raw).not.toContain(secret);
    }
    const dup = thrown(() => extraHeadersFrom(ctxWith({ 'extra-header': ['X-A: 1', 'x-a: 2'] })));
    expect(dup.code).toBe('USAGE');
  });
});

describe('chromium sandbox option (F21)', () => {
  const logged: string[] = [];
  const ctx = (values: Context['values']): Context =>
    ({ values, positionals: [], json: false, log: (m: string) => logged.push(m) }) as unknown as Context;
  const withEnv = (value: string | undefined, fn: () => void) => {
    const before = process.env.JOURILO_CHROMIUM_SANDBOX;
    if (value === undefined) delete process.env.JOURILO_CHROMIUM_SANDBOX;
    else process.env.JOURILO_CHROMIUM_SANDBOX = value;
    try {
      fn();
    } finally {
      if (before === undefined) delete process.env.JOURILO_CHROMIUM_SANDBOX;
      else process.env.JOURILO_CHROMIUM_SANDBOX = before;
    }
  };
  it('is off by default and on with --chromium-sandbox or JOURILO_CHROMIUM_SANDBOX', () => {
    withEnv(undefined, () => {
      expect(chromiumSandboxFrom(ctx({}), 'chromium')).toBe(false);
      expect(chromiumSandboxFrom(ctx({ 'chromium-sandbox': true }), 'chromium')).toBe(true);
      expect(chromiumSandboxFrom(ctx({ 'chromium-sandbox': true }), 'chrome')).toBe(true);
    });
    for (const v of ['1', 'true', 'YES', ' on '])
      withEnv(v, () => expect(chromiumSandboxFrom(ctx({}), 'chromium')).toBe(true));
    for (const v of ['', '0', 'false', 'no', 'off'])
      withEnv(v, () => expect(chromiumSandboxFrom(ctx({}), 'chromium')).toBe(false));
  });
  it('an unrecognised environment value fails closed (sandbox on) with a warning', () => {
    logged.length = 0;
    withEnv('sometimes', () => expect(chromiumSandboxFrom(ctx({}), 'chromium')).toBe(true));
    expect(logged.join('\n')).toContain('JOURILO_CHROMIUM_SANDBOX=sometimes');
  });
  it('--chromium-sandbox with Firefox or WebKit is a usage error; the environment variable is ignored there with a warning', () => {
    for (const b of ['firefox', 'webkit'] as const) {
      const err = thrown(() => chromiumSandboxFrom(ctx({ 'chromium-sandbox': true }), b));
      expect(err.code).toBe('USAGE');
      expect(err.message).toContain('--chromium-sandbox');
    }
    logged.length = 0;
    withEnv('1', () => expect(chromiumSandboxFrom(ctx({}), 'firefox')).toBe(false));
    expect(logged.join('\n')).toContain('only affects Chromium');
  });
});

describe('progress lines', () => {
  const cmd: Command = {
    name: 'x',
    summary: '',
    usage: 'jourilo x',
    run: async () => ({ data: null, text: '' }),
  };
  afterEach(() => vi.restoreAllMocks());

  function captured(argv: string[]): string {
    let out = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    parse(cmd, argv).log('  desktop  http://127.0.0.1/');
    return out;
  }

  it('progress lines are JSON with --json', () => {
    const line = JSON.parse(captured(['--json']));
    expect(line).toEqual({ type: 'progress', message: 'desktop  http://127.0.0.1/', at: expect.any(String) });
    expect(new Date(line.at).toISOString()).toBe(line.at);
  });
  it('stay plain text without --json and silent with --quiet', () => {
    expect(captured([])).toBe('  desktop  http://127.0.0.1/\n');
    expect(captured(['--json', '-q'])).toBe('');
  });
});
