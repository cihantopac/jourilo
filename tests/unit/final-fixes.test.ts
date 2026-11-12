import { describe, expect, it } from 'vitest';
import { originFreeName } from '../../src/browser/capture.js';
import { requestLimitations } from '../../src/browser/target-headers.js';
import { VIEWPORTS } from '../../src/browser/viewports.js';
import { redactedQueryPaths, redactUrl } from '../../src/core/redact.js';
import { formScreenshotFile } from '../../src/journeys/forms.js';

describe('redactedQueryPaths sees both redaction forms', () => {
  it('detects ?token= (rewritten to [redacted]) and ?access_token= (left as redacted)', () => {
    const token = redactUrl('https://a.test/x?token=abc');
    const access = redactUrl('https://a.test/y?access_token=abc');
    expect(token).not.toContain('abc');
    expect(access).not.toContain('abc');
    expect(redactedQueryPaths([token, access]).sort()).toEqual(['/x', '/y']);
  });
  it('ignores an ordinary query value', () => {
    expect(redactedQueryPaths(['https://a.test/z?page=2'])).toEqual([]);
  });
});

describe('--throttle with --extra-header', () => {
  const headers = { origin: 'https://a.test', headers: { 'X-Key': 'v4lue' }, redirects: new Set<string>() };
  it('states that the target-origin responses Jourilo fulfils are not throttled', () => {
    const out = requestLimitations({ headers, throttled: true }).join(' ');
    expect(out).toMatch(/not throttled/);
    expect(out).toContain('https://a.test');
    expect(out).not.toContain('v4lue');
  });
  it('says nothing about throttling without --throttle or without extra headers', () => {
    expect(requestLimitations({ headers }).join(' ')).not.toMatch(/throttl/i);
    expect(requestLimitations({ throttled: true })).toEqual([]);
  });
});

describe('origin-free evidence names', () => {
  const a = 'http://127.0.0.1:41001';
  const b = 'http://127.0.0.1:47002';
  const vp = VIEWPORTS.desktop!;
  it('originFreeName: the same path on two ports (each run its own origin) gives the same name', () => {
    expect(originFreeName(`${a}/pricing`, a)).toBe(originFreeName(`${b}/pricing`, b));
  });
  it('originFreeName: a page on another origin than the target gets another name', () => {
    expect(originFreeName('https://other.test/pricing', a)).not.toBe(originFreeName(`${a}/pricing`, a));
  });
  it('originFreeName: two queries give different names', () => {
    expect(originFreeName(`${a}/search?q=1`, a)).not.toBe(originFreeName(`${a}/search?q=2`, a));
  });
  it('formScreenshotFile follows the same rules', () => {
    const f = (url: string, origin: string, sel = 'form#signup') => formScreenshotFile(url, sel, vp, origin);
    expect(f(`${a}/signup`, a)).toBe(f(`${b}/signup`, b));
    expect(f('https://other.test/signup', a)).not.toBe(f(`${a}/signup`, a));
    expect(f(`${a}/signup?plan=pro`, a)).not.toBe(f(`${a}/signup?plan=team`, a));
    expect(f(`${a}/signup`, a, 'form#a')).not.toBe(f(`${a}/signup`, a, 'form#b'));
    expect(f(`${a}/signup`, a)).toMatch(/^screenshots\/form-[0-9a-f]{8}-desktop\.jpg$/);
  });
});
