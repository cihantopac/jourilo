import { describe, expect, it } from 'vitest';
import { emptyInventory } from '../../src/audit/engine.js';
import type { PageInventory } from '../../src/core/types.js';
import { keyEffect, matchesUrl } from '../../src/journeys/runner.js';
import {
  checkAction,
  checkRequest,
  classifyAction,
  interpolate,
  type RequestPolicy,
  signalWords,
  testData,
} from '../../src/journeys/safety.js';
import { describeStep, validateJourney } from '../../src/journeys/schema.js';
import { suggestJourneys, valueFor } from '../../src/journeys/suggest.js';
import { run } from '../helpers.js';

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

describe('safety policy: signals beyond the visible name', () => {
  it('reads identifiers and URLs as words', () => {
    expect(signalWords('btn-deleteAccount icon_trash')).toBe('btn delete account icon trash');
    expect(signalWords('/orders/42/cancel?x=1')).toBe('orders 42 cancel x 1');
  });
  it.each([
    // [visible name, identifiers, targets, expected]
    ['', 'icon icon-trash', '', 'destructive'],
    ['', 'btn', 'https://app.example/account/delete', 'destructive'],
    ['Continue', '', '/subscriptions/7/cancel', 'destructive'],
    ['Weiter', 'js-konto-loeschen', '', 'destructive'],
    ['Sil', '', '', 'destructive'],
    ['SİL', '', '', 'destructive'],
    ['Hesabımı sil', '', '', 'destructive'],
    ['Löschen', '', '', 'destructive'],
    ['Supprimer le compte', '', '', 'destructive'],
    ['Eliminar', '', '', 'destructive'],
    ['Ödeme yap', '', '', 'financial'],
    ['Jetzt kaufen', '', '', 'financial'],
    ['Payer', '', '', 'financial'],
    // Harmless controls stay harmless.
    ['Cancel', 'btn btn-cancel modal-cancel', '', null],
    ['İptal', 'iptal', '', null],
    ['Upload', 'drop-zone dropzone', '', null],
    ['Pricing', 'nav-link', '/pricing', null],
    ['Read the guide', '', '/blog/cancellation-policy', null],
  ])('%s / %s / %s → %s', (name, signals, targets, expected) => {
    expect(classifyAction(name, signals, targets)).toBe(expected);
  });
  it('blocks an icon-only delete button even when the journey calls it something else', () => {
    const v = checkAction(
      { action: 'click', name: '', signals: 'fa fa-trash', submitsForm: false, paymentForm: false },
      publicHost,
    );
    expect(v.allowed).toBe(false);
  });
});

describe('safety policy: key presses', () => {
  const facts = (over: Partial<Parameters<typeof keyEffect>[1] & object> = {}) => ({
    submits: false,
    inField: false,
    textarea: false,
    buttonLike: false,
    linkLike: false,
    payment: false,
    name: '',
    signals: '',
    targets: '',
    ...over,
  });
  it('treats Enter and Space like clicks on buttons and Enter in a field as a submission', () => {
    expect(keyEffect('Enter', facts({ buttonLike: true }))).toBe('activate');
    expect(keyEffect('Space', facts({ buttonLike: true }))).toBe('activate');
    expect(keyEffect(' ', facts({ buttonLike: true, submits: true }))).toBe('submit');
    expect(keyEffect('Enter', facts({ inField: true }))).toBe('submit');
    expect(keyEffect('NumpadEnter', facts({ linkLike: true }))).toBe('activate');
    expect(keyEffect('Control+Enter', facts({ textarea: true }))).toBe('submit');
    expect(keyEffect('Enter', facts({ textarea: true }))).toBe('none');
    expect(keyEffect('Tab', facts({ buttonLike: true }))).toBe('none');
    expect(keyEffect('Space', facts({ inField: true }))).toBe('none');
    expect(keyEffect('Enter', null)).toBe('none');
  });
});

describe('safety policy: requests (network backstop)', () => {
  const journey = (over: Partial<RequestPolicy> = {}): RequestPolicy => ({
    hostClass: 'public',
    allowSubmit: false,
    allowDestructive: false,
    origin: 'https://shop.example',
    mode: 'journey',
    ...over,
  });
  const req = (method: string, url: string, over: Partial<Parameters<typeof checkRequest>[0]> = {}) => ({
    method,
    url,
    isNavigation: false,
    mainFrame: true,
    ...over,
  });
  it('blocks DELETE and mutating requests to destructive or payment endpoints, even when submission is allowed', () => {
    const p = journey({ allowSubmit: true, allowDestructive: true });
    expect(checkRequest(req('DELETE', 'https://shop.example/api/items/3'), p).allowed).toBe(false);
    expect(checkRequest(req('POST', 'https://shop.example/api/orders'), p).allowed).toBe(false);
    expect(checkRequest(req('POST', 'https://shop.example/account/delete'), p).allowed).toBe(false);
    expect(checkRequest(req('PATCH', 'https://shop.example/api/subscription/cancel'), p).allowed).toBe(false);
    expect(checkRequest(req('POST', 'https://shop.example/api/profile'), p).allowed).toBe(true);
  });
  it('blocks destructive GET links and navigation to other origins', () => {
    const p = journey();
    expect(
      checkRequest(req('GET', 'https://shop.example/account/delete?confirm=1', { isNavigation: true }), p)
        .allowed,
    ).toBe(false);
    expect(checkRequest(req('GET', 'https://evil.example/', { isNavigation: true }), p)).toMatchObject({
      allowed: false,
      kind: 'off-origin',
    });
    expect(
      checkRequest(
        req('GET', 'https://idp.example/login', { isNavigation: true }),
        journey({ allowOrigins: ['https://idp.example'] }),
      ).allowed,
    ).toBe(true);
    // Embedded third-party frames and normal pages are fine.
    expect(
      checkRequest(req('GET', 'https://video.example/embed', { isNavigation: true, mainFrame: false }), p)
        .allowed,
    ).toBe(true);
    expect(
      checkRequest(req('GET', 'https://shop.example/blog/how-we-cancelled-x', { isNavigation: true }), p)
        .allowed,
    ).toBe(true);
  });
  it('blocks form posts on public hosts without --allow-submit, and lets local journeys submit', () => {
    expect(
      checkRequest(req('POST', 'https://shop.example/signup', { isNavigation: true }), journey()).allowed,
    ).toBe(false);
    expect(checkRequest(req('POST', 'https://shop.example/api/signup'), journey()).allowed).toBe(false);
    expect(
      checkRequest(req('POST', 'https://shop.example/api/signup'), journey({ allowSubmit: true })).allowed,
    ).toBe(true);
    expect(
      checkRequest(
        req('POST', 'http://127.0.0.1:3000/signup', { isNavigation: true }),
        journey({ hostClass: 'local', origin: 'http://127.0.0.1:3000' }),
      ).allowed,
    ).toBe(true);
    // Third-party beacons are not the target's data.
    expect(checkRequest(req('POST', 'https://analytics.example/collect'), journey()).allowed).toBe(true);
  });
  it('read-only mode (audits, form probes) sends nothing that changes data, on any host', () => {
    const ro = journey({ hostClass: 'local', origin: 'http://127.0.0.1:3000', mode: 'read-only' });
    expect(
      checkRequest(req('POST', 'http://127.0.0.1:3000/signup', { isNavigation: true }), ro).allowed,
    ).toBe(false);
    expect(checkRequest(req('PUT', 'http://127.0.0.1:3000/api/x'), ro).allowed).toBe(false);
    expect(checkRequest(req('POST', 'https://analytics.example/collect'), ro).allowed).toBe(false);
    expect(
      checkRequest(req('GET', 'http://127.0.0.1:3000/search?q=x', { isNavigation: true }), ro).allowed,
    ).toBe(true);
    // GraphQL reads are reads; mutations are not.
    expect(
      checkRequest(
        req('POST', 'http://127.0.0.1:3000/graphql', { body: '{"query":"query Me { me { id } }"}' }),
        ro,
      ).allowed,
    ).toBe(true);
    expect(
      checkRequest(
        req('POST', 'http://127.0.0.1:3000/graphql', { body: '{"query":"mutation { deleteMe }"}' }),
        ro,
      ).allowed,
    ).toBe(false);
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

describe('journey stability (--repeat)', () => {
  const spec = {
    version: 1 as const,
    id: 'checkout',
    name: 'Checkout',
    start: '/',
    steps: [],
    success: [{ description: 'x', noPageErrors: true }],
  };
  const attempt = (status: 'passed' | 'failed', ms = 100) => ({
    result: {
      id: 'checkout',
      name: 'Checkout',
      viewport: 'desktop',
      status,
      steps: [
        {
          index: 0,
          action: 'click',
          description: 'Click "Pay"',
          status,
          durationMs: ms,
          url: 'http://127.0.0.1:3000/cart',
          ...(status === 'failed' ? { error: 'timeout' } : {}),
        },
      ],
      successCriteria: [],
      durationMs: ms,
    },
    findings: [],
  });
  it('reports mixed outcomes as flaky, with a review item', async () => {
    const { summarizeAttempts } = await import('../../src/cli/commands/journeys.js');
    const r = summarizeAttempts(spec, [attempt('passed'), attempt('failed'), attempt('passed')] as never);
    expect(r.result.stability).toBe('flaky');
    expect(r.result.status).toBe('failed');
    expect(r.result.attempts!.map((a) => a.status)).toEqual(['passed', 'failed', 'passed']);
    expect(r.findings.map((f) => [f.ruleId, f.kind, f.title])).toEqual([
      ['journey/flaky', 'needs-review', 'Journey "Checkout" passed 2 of 3 times'],
    ]);
  });
  it('keeps consistent outcomes as they are', async () => {
    const { summarizeAttempts } = await import('../../src/cli/commands/journeys.js');
    expect(summarizeAttempts(spec, [attempt('passed'), attempt('passed')] as never).result.stability).toBe(
      'stable',
    );
    const failed = summarizeAttempts(spec, [attempt('failed'), attempt('failed')] as never);
    expect([failed.result.status, failed.result.stability, failed.findings.length]).toEqual([
      'failed',
      'stable',
      0,
    ]);
  });
});

describe('journey suggestions: disclosures and toggles', () => {
  const runWith = (inv: Partial<PageInventory>) =>
    run([], {
      pages: [
        {
          url: 'https://example.test/',
          finalUrl: 'https://example.test/',
          status: 200,
          title: 'Home',
          viewport: 'desktop',
          loadMs: 100,
          metrics: [],
          consoleErrors: 0,
          failedRequests: 0,
          inventory: { ...emptyInventory(), ...inv },
        },
      ],
    });
  const rect = { x: 0, y: 0, width: 120, height: 40 };

  it('suggests an open-and-check journey for an aria-expanded control', () => {
    const j = suggestJourneys(
      runWith({
        toggles: [
          { selector: '#faq-btn', name: 'Shipping details', state: 'expanded', controls: 'faq-panel' },
        ],
      }),
    ).find((x) => x.tags?.includes('toggle'));
    expect(j).toBeDefined();
    expect(() => validateJourney(j)).not.toThrow();
    expect(j!.steps).toEqual([
      { action: 'click', target: { role: 'button', name: 'Shipping details', exact: true } },
      { action: 'expect', visible: { css: '#faq-panel' } },
    ]);
    expect(j!.success).toContainEqual({ description: 'No uncaught exceptions', noPageErrors: true });
  });

  it('suggests a pressed toggle journey', () => {
    const j = suggestJourneys(
      runWith({ toggles: [{ selector: '#bold', name: 'Bold', state: 'pressed', controls: null }] }),
    ).find((x) => x.tags?.includes('toggle'));
    expect(j).toBeDefined();
    expect(() => validateJourney(j)).not.toThrow();
    expect(j!.steps).toEqual([
      { action: 'click', target: { role: 'button', name: 'Bold', exact: true } },
      { action: 'expect', visible: { css: '#bold[aria-pressed="true"]' } },
    ]);
  });

  it('does not take a theme switch for the main call to action', () => {
    const inv = {
      ctas: [
        {
          text: 'Toggle dark mode',
          selector: '#theme',
          href: null,
          rect,
          aboveFold: true,
          emphasis: 'primary' as const,
        },
        {
          text: 'Dili değiştir',
          selector: '#lang',
          href: null,
          rect,
          aboveFold: true,
          emphasis: 'primary' as const,
        },
      ],
    };
    expect(suggestJourneys(runWith(inv)).some((x) => x.id === 'landing-primary-cta')).toBe(false);
    const real = {
      ctas: [
        ...inv.ctas,
        {
          text: 'Start free',
          selector: '#go',
          href: '/signup',
          rect,
          aboveFold: true,
          emphasis: 'primary' as const,
        },
      ],
    };
    const cta = suggestJourneys(runWith(real)).find((x) => x.id === 'landing-primary-cta');
    expect(cta?.name).toContain('Start free');
  });

  it('keeps a real call to action that merely mentions a theme', () => {
    const cta = (text: string, href: string | null) => ({
      text,
      selector: '#go',
      href,
      rect,
      aboveFold: true,
      emphasis: 'primary' as const,
    });
    const j = suggestJourneys(runWith({ ctas: [cta('Try dark mode free', '/signup')] })).find(
      (x) => x.id === 'landing-primary-cta',
    );
    expect(j?.name).toContain('Try dark mode free');
    expect(
      suggestJourneys(runWith({ ctas: [cta('Toggle dark mode', null)] })).some(
        (x) => x.id === 'landing-primary-cta',
      ),
    ).toBe(false);
  });
});
