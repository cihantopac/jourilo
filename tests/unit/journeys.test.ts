import { describe, expect, it } from 'vitest';
import { matchesUrl } from '../../src/journeys/runner.js';
import { checkAction, interpolate, testData } from '../../src/journeys/safety.js';
import { describeStep, validateJourney } from '../../src/journeys/schema.js';
import { valueFor } from '../../src/journeys/suggest.js';

const local = { hostClass: 'local' as const, allowSubmit: false, allowDestructive: false };
const publicHost = { hostClass: 'public' as const, allowSubmit: false, allowDestructive: false };

describe('safety policy', () => {
  it('never pays or deletes on non-local hosts, even when allowed', () => {
    for (const name of ['Pay now', 'Place order', 'Delete account', 'Cancel subscription', 'Buy now']) {
      const v = checkAction(
        { action: 'click', name, submitsForm: false, paymentForm: false },
        { ...publicHost, allowDestructive: true, allowSubmit: true },
      );
      expect(v.allowed, name).toBe(false);
    }
  });
  it('requires --allow-destructive on local hosts', () => {
    expect(
      checkAction({ action: 'click', name: 'Delete project', submitsForm: false, paymentForm: false }, local)
        .allowed,
    ).toBe(false);
    expect(
      checkAction(
        { action: 'click', name: 'Delete project', submitsForm: false, paymentForm: false },
        { ...local, allowDestructive: true },
      ).allowed,
    ).toBe(true);
  });
  it('treats any submit of a payment form as financial', () => {
    expect(
      checkAction({ action: 'click', name: 'Continue', submitsForm: true, paymentForm: true }, local).allowed,
    ).toBe(false);
  });
  it('blocks form submission on public hosts without --allow-submit', () => {
    expect(
      checkAction({ action: 'click', name: 'Sign up', submitsForm: true, paymentForm: false }, publicHost)
        .allowed,
    ).toBe(false);
    expect(
      checkAction(
        { action: 'click', name: 'Sign up', submitsForm: true, paymentForm: false },
        { ...publicHost, allowSubmit: true },
      ).allowed,
    ).toBe(true);
    expect(
      checkAction({ action: 'click', name: 'Pricing', submitsForm: false, paymentForm: false }, publicHost)
        .allowed,
    ).toBe(true);
  });
});

describe('journey schema', () => {
  it('requires explicit success criteria', () => {
    expect(() =>
      validateJourney({
        version: 1,
        id: 'a',
        name: 'A',
        start: '/',
        steps: [{ action: 'goto', url: '/' }],
        success: [],
      }),
    ).toThrow(/success/);
    expect(() =>
      validateJourney({
        version: 1,
        id: 'a',
        name: 'A',
        start: '/',
        steps: [{ action: 'click' }],
        success: [{ description: 'x', noPageErrors: true }],
      }),
    ).toThrow(/target/);
    expect(
      validateJourney({
        version: 1,
        id: 'a',
        name: 'A',
        start: '/',
        steps: [{ action: 'click', target: { role: 'link', name: 'Go' } }],
        success: [{ description: 'x', url: '/next' }],
      }).id,
    ).toBe('a');
  });
  it('hides secret values in descriptions', () => {
    expect(describeStep({ action: 'fill', target: { label: 'Password' }, value: '{{password}}' }, true)).toBe(
      'Type •••••• into field labelled "Password"',
    );
  });
});

describe('test data and URLs', () => {
  it('interpolates generated, run-unique data', () => {
    const d = testData('20261030-120000-abcdef');
    expect(interpolate('{{email}}', d)).toMatch(/^jourilo\+.+@example\.test$/);
    expect(interpolate('{{unknown}}', d)).toBe('{{unknown}}');
    expect(testData('x', { email: 'qa@corp.test' }).email).toBe('qa@corp.test');
  });
  it('matches paths exactly, regexes and substrings', () => {
    expect(matchesUrl('http://a.test/signup/', '/signup')).toBe(true);
    expect(matchesUrl('http://a.test/signup/step2', '/signup')).toBe(false);
    expect(matchesUrl('http://a.test/', '/')).toBe(true);
    expect(matchesUrl('http://a.test/pricing.html', '/pricing')).toBe(true);
    expect(matchesUrl('http://a.test/a?x=1', 're:x=\\d')).toBe(true);
    expect(matchesUrl('http://a.test/welcome', 'welcome')).toBe(true);
  });
  it('picks test values by field meaning', () => {
    const f = (type: string, name: string) => ({
      selector: '',
      type,
      name,
      label: null,
      required: false,
      autocomplete: null,
    });
    expect(valueFor(f('text', 'first_name'))).toBe('{{firstName}}');
    expect(valueFor(f('password', 'pw'))).toBe('{{password}}');
    expect(valueFor(f('checkbox', 'terms'))).toBeNull();
  });
});
