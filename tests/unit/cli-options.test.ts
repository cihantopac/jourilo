import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Command, type Context, parse, parseStateOptions } from '../../src/cli/framework.js';
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
