import { describe, expect, it } from 'vitest';
import { type Context, parseStateOptions } from '../../src/cli/framework.js';
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
