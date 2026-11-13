// Read-only analytics adapters (Review Focus 3): recorded vendor responses are served by a stubbed fetch. The fixtures
// are synthesized from each vendor's documented response shapes (tests/fixtures/analytics/README.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressPolicy } from '../../src/core/url-safety.js';

const guarded = vi.hoisted(() => ({
  calls: [] as { url: string; policy: AddressPolicy; method: string; headers: Record<string, string> }[],
  serve: null as null | ((url: string, init: { method: string; body?: string }) => Response),
}));
vi.mock('../../src/core/net-guard.js', async (orig) => ({
  ...(await orig<typeof import('../../src/core/net-guard.js')>()),
  guardedFetch: async (
    url: string,
    policy: AddressPolicy,
    init: { method?: string; headers?: Record<string, string>; body?: string },
  ) => {
    guarded.calls.push({ url, policy, method: init.method ?? 'GET', headers: init.headers ?? {} });
    if (!guarded.serve) throw new Error('no stub');
    return guarded.serve(url, { method: init.method ?? 'GET', ...(init.body ? { body: init.body } : {}) });
  },
}));

const { experiment } = await import('../../src/cli/commands/experiment.js');
const { parse } = await import('../../src/cli/framework.js');
const { JouriloError } = await import('../../src/core/errors.js');
const { posthogAdapter } = await import('../../src/experiment/adapters/posthog.js');
const { growthbookAdapter } = await import('../../src/experiment/adapters/growthbook.js');
const { amplitudeAdapter } = await import('../../src/experiment/adapters/amplitude.js');
type AdapterFetch = import('../../src/experiment/adapters/common.js').AdapterFetch;

const FIX = join(import.meta.dirname, '..', 'fixtures', 'analytics');
const fixture = (vendor: string, name: string) => readFileSync(join(FIX, vendor, `${name}.json`), 'utf8');
const json = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

const PH_KEY = 'phx_SECRETtestkey_9f3a7c1d';
const GB_KEY = 'secret_SECRETgbkey_4b2e8a';
const AMP_KEY = 'ampSECRETapikey_77c1';
const AMP_SECRET = 'ampSECRETsecret_91d0';
const ALL_KEYS = [
  PH_KEY,
  GB_KEY,
  AMP_KEY,
  AMP_SECRET,
  Buffer.from(`${AMP_KEY}:${AMP_SECRET}`).toString('base64'),
];

type Route = (url: URL, init: { method: string; body?: string }) => Response | undefined;
/** A stub fetch that serves recordings by route and records each request. */
function stub(route: Route) {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const fetch: AdapterFetch = async (url, init) => {
    seen.push({ url, ...init });
    const res = route(new URL(url), init);
    return res ?? json('{"detail":"Not found."}', 404);
  };
  return { fetch, seen };
}

const posthogRoutes =
  (query = 'query-funnel'): Route =>
  (u, init) => {
    if (u.pathname === '/api/projects/@current/experiments/42/')
      return json(fixture('posthog', 'experiment'));
    if (u.pathname === '/api/projects/@current/experiments/')
      return json(
        fixture(
          'posthog',
          u.searchParams.get('offset') === '100' ? 'experiments-page-2' : 'experiments-page-1',
        ),
      );
    if (u.pathname === '/api/projects/@current/query/' && init.method === 'POST')
      return json(fixture('posthog', query));
    return undefined;
  };

const growthbookRoutes =
  (results = 'results'): Route =>
  (u) => {
    if (u.pathname === '/api/v1/experiments/exp_example1') return json(fixture('growthbook', 'experiment'));
    if (u.pathname === '/api/v1/experiments')
      return json(
        fixture(
          'growthbook',
          u.searchParams.get('offset') === '100' ? 'experiments-page-2' : 'experiments-page-1',
        ),
      );
    if (u.pathname === '/api/v1/experiments/exp_example1/results')
      return json(fixture('growthbook', results));
    if (u.pathname === '/api/v1/metrics/met_signup') return json(fixture('growthbook', 'metric-signup'));
    if (u.pathname === '/api/v1/metrics/met_pageviews')
      return json(fixture('growthbook', 'metric-pageviews'));
    if (u.pathname === '/api/v1/fact-metrics/fact__checkout')
      return json(fixture('growthbook', 'fact-metric-checkout'));
    return undefined;
  };

const amplitudeRoutes =
  (name = 'funnels'): Route =>
  (u) =>
    u.pathname === '/api/2/funnels' ? json(fixture('amplitude', name)) : undefined;

describe('the fixtures', () => {
  it('are labelled synthesized and hold no key', () => {
    for (const [vendor, names] of [
      [
        'posthog',
        [
          'experiment',
          'experiments-page-1',
          'experiments-page-2',
          'query-funnel',
          'query-missing-variant',
          'rate-limited',
        ],
      ],
      [
        'growthbook',
        [
          'experiment',
          'experiments-page-1',
          'experiments-page-2',
          'results',
          'results-missing-variant',
          'metric-signup',
          'metric-pageviews',
          'fact-metric-checkout',
        ],
      ],
      ['amplitude', ['funnels', 'funnels-missing-control']],
    ] as const) {
      for (const n of names) {
        const text = fixture(vendor, n);
        expect(JSON.parse(text)._synthesized, `${vendor}/${n}`).toMatch(/Not a live recording/);
        expect(text).not.toMatch(/phx_|secret_[A-Za-z0-9]{6}|Bearer|Basic /);
      }
    }
  });
});

describe('PostHog adapter', () => {
  const env = { POSTHOG_API_KEY: PH_KEY };
  it('maps a complete funnel experiment to exposures and conversions, control first', async () => {
    const s = stub(posthogRoutes());
    const data = await posthogAdapter({ env, fetch: s.fetch }).experiment('42');
    expect(data).toEqual({
      id: '42',
      metric: 'Purchase completed',
      variants: [
        { name: 'control', exposures: 2400, conversions: 120 },
        { name: 'test', exposures: 2380, conversions: 150 },
      ],
      complete: true,
      notes: [],
    });
    expect(s.seen.map((r) => r.method)).toEqual(['GET', 'POST']);
    const q = JSON.parse(s.seen[1]!.body!);
    expect(q.query).toMatchObject({
      kind: 'ExperimentQuery',
      experiment_id: 42,
      metric: { uuid: 'metric-uuid-1' },
    });
    expect(s.seen[0]!.headers.authorization).toBe(`Bearer ${PH_KEY}`);
  });
  it('follows `next` pages to find an experiment by its flag key', async () => {
    const s = stub(posthogRoutes());
    const data = await posthogAdapter({ env, fetch: s.fetch }).experiment('checkout-button-copy');
    expect(data.complete).toBe(true);
    expect(data.variants.map((v) => v.conversions)).toEqual([120, 150]);
    expect(s.seen.map((r) => new URL(r.url).search)).toEqual(['?limit=100', '?limit=100&offset=100', '']);
  });
  it('a 429 gives complete: false with a note', async () => {
    const s = stub((u, init) =>
      u.pathname.endsWith('/query/')
        ? json(fixture('posthog', 'rate-limited'), 429, { 'retry-after': '30' })
        : posthogRoutes()(u, init),
    );
    const data = await posthogAdapter({ env, fetch: s.fetch }).experiment('42');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/rate-limited .*HTTP 429.*retry after 30 s/);
  });
  it('a missing variant gives complete: false with a note', async () => {
    const data = await posthogAdapter({
      env,
      fetch: stub(posthogRoutes('query-missing-variant')).fetch,
    }).experiment('42');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/no numbers for variant test/);
  });
  it('a failed page (5xx) gives complete: false', async () => {
    const s = stub((u, init) =>
      u.pathname.endsWith('/query/') ? json('{}', 502) : posthogRoutes()(u, init),
    );
    const data = await posthogAdapter({ env, fetch: s.fetch }).experiment('42');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/HTTP 502/);
  });
  it('a mean metric is refused as INVALID_INPUT, with its own hint', async () => {
    const e = await rejection(
      posthogAdapter({ env, fetch: stub(posthogRoutes()).fetch, metric: 'Revenue per user' }).experiment(
        '42',
      ),
    );
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.message).toMatch(/mean metric; analyze needs a conversion \(funnel\) metric/);
    expect(e.hint).toMatch(
      /Pick a funnel metric with --metric \(primary metrics: Purchase completed, Revenue per user\)/,
    );
  });
  it('an unknown --metric is a USAGE error listing the primary metrics', async () => {
    const e = await rejection(
      posthogAdapter({ env, fetch: stub(posthogRoutes()).fetch, metric: 'Signups' }).experiment('42'),
    );
    expect(e.code).toBe('USAGE');
    expect(e.message).toMatch(/no primary metric named "Signups"/);
    expect(e.hint).toMatch(/Purchase completed, Revenue per user/);
  });
  it('results not computed yet are INVALID_INPUT, not a rate-limit kind of incompleteness', async () => {
    const s = stub((u, i) =>
      u.pathname.endsWith('/query/') ? json('{"kind":"ExperimentQuery"}') : posthogRoutes()(u, i),
    );
    const e = await rejection(posthogAdapter({ env, fetch: s.fetch }).experiment('42'));
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.hint).toMatch(/Wait until the experiment has exposures/);
  });
  it('a missing key is a usage error naming the variable', () => {
    expect(() => posthogAdapter({ env: {} })).toThrowError(/POSTHOG_API_KEY is not set/);
    try {
      posthogAdapter({ env: {} });
    } catch (e) {
      expect((e as InstanceType<typeof JouriloError>).code).toBe('USAGE');
    }
  });
});

describe('GrowthBook adapter', () => {
  const env = { GROWTHBOOK_API_KEY: GB_KEY };
  it('maps the goal metric of a complete experiment, named by variation', async () => {
    const s = stub(growthbookRoutes());
    const data = await growthbookAdapter({ env, fetch: s.fetch }).experiment('exp_example1');
    expect(data).toEqual({
      id: 'exp_example1',
      metric: 'Signups',
      variants: [
        { name: 'Control', exposures: 2400, conversions: 120 },
        { name: 'Short form', exposures: 2380, conversions: 150 },
      ],
      complete: true,
      notes: [],
    });
    expect(s.seen.every((r) => r.method === 'GET')).toBe(true);
    expect(s.seen[0]!.headers.authorization).toBe(`Bearer ${GB_KEY}`);
  });
  it('follows hasMore/nextOffset to find an experiment by its tracking key', async () => {
    const s = stub(growthbookRoutes());
    const data = await growthbookAdapter({ env, fetch: s.fetch }).experiment('signup-form-length');
    expect(data.complete).toBe(true);
    expect(s.seen.map((r) => new URL(r.url).search)).toEqual([
      '?limit=100&offset=0',
      '?limit=100&offset=100',
      '',
      '',
    ]);
  });
  it('reads the metric type and accepts binomial metrics and proportion fact metrics', async () => {
    const s = stub(growthbookRoutes());
    await growthbookAdapter({ env, fetch: s.fetch }).experiment('exp_example1');
    expect(s.seen.map((r) => new URL(r.url).pathname).at(-1)).toBe('/api/v1/metrics/met_signup');
    const fact = fixture('growthbook', 'results').replaceAll('met_signup', 'fact__checkout');
    const f = stub((u, i) => (u.pathname.endsWith('/results') ? json(fact) : growthbookRoutes()(u, i)));
    const data = await growthbookAdapter({ env, fetch: f.fetch, metric: 'fact__checkout' }).experiment(
      'exp_example1',
    );
    expect(data.complete).toBe(true);
    expect(f.seen.map((r) => new URL(r.url).pathname).at(-1)).toBe('/api/v1/fact-metrics/fact__checkout');
  });
  it('refuses a count metric even when its numbers look like user counts', async () => {
    const e = await rejection(
      growthbookAdapter({ env, fetch: stub(growthbookRoutes()).fetch, metric: 'met_pageviews' }).experiment(
        'exp_example1',
      ),
    );
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.message).toMatch(/"Page views" is a count metric; analyze needs a conversion metric/);
    expect(e.hint).toMatch(/Pick a conversion metric with --metric/);
  });
  it('an unknown --metric is a USAGE error listing the metrics in the results', async () => {
    const e = await rejection(
      growthbookAdapter({ env, fetch: stub(growthbookRoutes()).fetch, metric: 'Revenue' }).experiment(
        'exp_example1',
      ),
    );
    expect(e.code).toBe('USAGE');
    expect(e.hint).toMatch(/Page views, Signups/);
  });
  it('a malformed body gives complete: false saying why, never a raw TypeError', async () => {
    const empty = stub((u, i) =>
      u.pathname === '/api/v1/experiments/exp_example1' ? json('{}') : growthbookRoutes()(u, i),
    );
    const a = await growthbookAdapter({ env, fetch: empty.fetch }).experiment('exp_example1');
    expect(a.complete).toBe(false);
    expect(a.notes.join(' ')).toMatch(/experiment without an id/);
    const odd = stub((u, i) =>
      u.pathname.endsWith('/results') ? json('{"results":"x"}') : growthbookRoutes()(u, i),
    );
    const b = await growthbookAdapter({ env, fetch: odd.fetch }).experiment('exp_example1');
    expect(b.complete).toBe(false);
    expect(b.notes.join(' ')).toMatch(/GrowthBook sent a response Jourilo could not read/);
  });
  it('a 429 gives complete: false with a note', async () => {
    const s = stub((u, init) =>
      u.pathname.endsWith('/results')
        ? json('{"message":"Too many requests"}', 429)
        : growthbookRoutes()(u, init),
    );
    const data = await growthbookAdapter({ env, fetch: s.fetch }).experiment('exp_example1');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/GrowthBook rate-limited/);
  });
  it('a missing variant gives complete: false with a note', async () => {
    const data = await growthbookAdapter({
      env,
      fetch: stub(growthbookRoutes('results-missing-variant')).fetch,
    }).experiment('exp_example1');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/no numbers for variant Short form/);
  });
  it('a missing key is a usage error naming the variable', () => {
    expect(() => growthbookAdapter({ env: {} })).toThrowError(/GROWTHBOOK_API_KEY is not set/);
  });
});

describe('Amplitude adapter', () => {
  const env = { AMPLITUDE_API_KEY: AMP_KEY, AMPLITUDE_SECRET_KEY: AMP_SECRET };
  const opts = { metric: 'purchase_completed', start: '2026-10-01', end: '2026-10-31' };
  it('maps a grouped exposure → conversion funnel, control first', async () => {
    const s = stub(amplitudeRoutes());
    const data = await amplitudeAdapter({ env, fetch: s.fetch, ...opts }).experiment('checkout-button-copy');
    expect(data.complete).toBe(true);
    expect(data.metric).toBe('purchase_completed');
    expect(data.variants).toEqual([
      { name: 'control', exposures: 2400, conversions: 120 },
      { name: 'treatment', exposures: 2380, conversions: 150 },
    ]);
    expect(data.notes.join(' ')).toMatch(
      /12 exposed user\(s\) had no \[Experiment\] checkout-button-copy property/,
    );
    const u = new URL(s.seen[0]!.url);
    expect(u.searchParams.getAll('e').map((e) => JSON.parse(e).event_type)).toEqual([
      '$exposure',
      'purchase_completed',
    ]);
    expect(u.searchParams.get('g')).toBe('gp:[Experiment] checkout-button-copy');
    expect([u.searchParams.get('start'), u.searchParams.get('end')]).toEqual(['20261001', '20261031']);
    expect(s.seen[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from(`${AMP_KEY}:${AMP_SECRET}`).toString('base64')}`,
    );
  });
  it('has no pages: a grouped answer at the limit is reported as cut off', async () => {
    const full = JSON.stringify({
      data: Array.from({ length: 1000 }, (_, i) => ({
        groupValue: i ? `v${i}` : 'control',
        cumulativeRaw: [10, 1],
      })),
    });
    const data = await amplitudeAdapter({ env, fetch: stub(() => json(full)).fetch, ...opts }).experiment(
      'f',
    );
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/1000 groups, its limit; variants may be cut off/);
  });
  it('a 429 gives complete: false with a note', async () => {
    const data = await amplitudeAdapter({
      env,
      fetch: stub(() => json('{"error":"Too many requests"}', 429)).fetch,
      ...opts,
    }).experiment('f');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/Amplitude rate-limited/);
  });
  it('a missing control variant gives complete: false with a note', async () => {
    const data = await amplitudeAdapter({
      env,
      fetch: stub(amplitudeRoutes('funnels-missing-control')).fetch,
      ...opts,
    }).experiment('f');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/no numbers for the control variant/);
  });
  it('a missing non-control variant gives complete: false, even next to an informational note', async () => {
    const onlyControl = JSON.stringify({
      data: [
        { groupValue: 'control', cumulativeRaw: [2400, 120] },
        { groupValue: '(none)', cumulativeRaw: [12, 0] },
      ],
    });
    const data = await amplitudeAdapter({
      env,
      fetch: stub(() => json(onlyControl)).fetch,
      ...opts,
    }).experiment('f');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/12 exposed user\(s\) had no/);
    expect(data.notes.join(' ')).toMatch(/numbers for 1 variant\(s\) \(control\); the other arm is missing/);
  });
  it('--control-key names a control that is not called control', async () => {
    const body = JSON.stringify({
      data: [
        { groupValue: 'on', cumulativeRaw: [2380, 150] },
        { groupValue: 'off', cumulativeRaw: [2400, 120] },
      ],
    });
    const data = await amplitudeAdapter({
      env,
      fetch: stub(() => json(body)).fetch,
      ...opts,
      controlKey: 'off',
    }).experiment('f');
    expect(data.complete).toBe(true);
    expect(data.variants.map((v) => v.name)).toEqual(['off', 'on']);
  });
  it('a malformed funnel answer gives complete: false saying why', async () => {
    const data = await amplitudeAdapter({
      env,
      fetch: stub(() => json('{"data":{"x":1}}')).fetch,
      ...opts,
    }).experiment('f');
    expect(data.complete).toBe(false);
    expect(data.notes.join(' ')).toMatch(/`data` is not a list of groups/);
  });
  it('missing keys are usage errors naming the variable', () => {
    expect(() => amplitudeAdapter({ env: {}, ...opts })).toThrowError(/AMPLITUDE_API_KEY is not set/);
    expect(() => amplitudeAdapter({ env: { AMPLITUDE_API_KEY: AMP_KEY }, ...opts })).toThrowError(
      /AMPLITUDE_SECRET_KEY is not set/,
    );
    expect(() => amplitudeAdapter({ env, metric: 'x' })).toThrowError(/--start must be a date/);
    expect(() => amplitudeAdapter({ env, start: '2026-10-01' })).toThrowError(/--metric EVENT/);
  });
});

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as InstanceType<typeof JouriloError>;
  }
  throw new Error('expected a rejection');
}

describe('experiment analyze --from', () => {
  const saved = { ...process.env };
  let printed = '';
  beforeEach(() => {
    guarded.calls.length = 0;
    guarded.serve = null;
    printed = '';
    for (const k of Object.keys(process.env))
      if (/^(POSTHOG|GROWTHBOOK|AMPLITUDE)_|_proxy$/i.test(k)) delete process.env[k];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...saved };
  });
  const run = async (...argv: string[]) => {
    const ctx = parse(experiment, ['analyze', ...argv]);
    return experiment.run(ctx);
  };
  const serve = (route: Route) => {
    guarded.serve = (url, init) => route(new URL(url), init) ?? json('{}', 404);
  };
  const failure = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as InstanceType<typeof JouriloError>;
    }
    throw new Error('expected a failure');
  };

  it('analyzes a complete PostHog experiment through the guarded fetch, never printing the key', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    serve(posthogRoutes());
    const r = await run('--from', 'posthog:42', '--json');
    const all = JSON.stringify(r) + printed;
    expect(r.text).toMatch(
      /PostHog experiment 42, metric Purchase completed: control 120\/2400, test 150\/2380/,
    );
    expect((r.data as { source: { complete: boolean } }).source.complete).toBe(true);
    expect((r.data as { pValue: number }).pValue).toBeGreaterThan(0);
    expect(guarded.calls.map((c) => [c.method, new URL(c.url).host])).toEqual([
      ['GET', 'us.posthog.com'],
      ['POST', 'us.posthog.com'],
    ]);
    expect(guarded.calls[0]!.policy).toMatchObject({ target: 'public', allowPrivate: false });
    for (const k of ALL_KEYS) expect(all).not.toContain(k);
  });
  it('passes the HTTPS_PROXY upstream to the guarded fetch', async () => {
    process.env.GROWTHBOOK_API_KEY = GB_KEY;
    process.env.HTTPS_PROXY = 'http://proxy.example:3128';
    serve(growthbookRoutes());
    await run('--from', 'growthbook:exp_example1');
    expect(guarded.calls[0]!.policy.upstream).toMatchObject({ host: 'proxy.example', port: 3128 });
  });
  it.each([
    {
      from: 'posthog:42',
      args: [],
      env: { POSTHOG_API_KEY: PH_KEY },
      route: ((u, i) => (u.pathname.endsWith('/query/') ? json('{}', 429) : posthogRoutes()(u, i))) as Route,
    },
    {
      from: 'growthbook:exp_example1',
      args: [],
      env: { GROWTHBOOK_API_KEY: GB_KEY },
      route: growthbookRoutes('results-missing-variant'),
    },
    {
      from: 'amplitude:checkout-button-copy',
      args: ['--metric', 'purchase_completed', '--start', '2026-10-01'],
      env: { AMPLITUDE_API_KEY: AMP_KEY, AMPLITUDE_SECRET_KEY: AMP_SECRET },
      route: amplitudeRoutes('funnels-missing-control'),
    },
  ])(
    '$from: incomplete data is refused with the reason, and no key in it',
    async ({ from, args, env, route }) => {
      Object.assign(process.env, env);
      serve(route);
      const e = await failure(run('--from', from, ...args));
      expect(e.code).toBe('INVALID_INPUT');
      expect(e.message).toMatch(/Not analyzed: .* incomplete/);
      expect(e.message).toMatch(/429|no numbers for/);
      for (const k of ALL_KEYS) expect(`${e.message} ${e.hint ?? ''} ${printed}`).not.toContain(k);
    },
  );
  it.each([
    ['posthog:42', 'POSTHOG_API_KEY'],
    ['growthbook:exp_example1', 'GROWTHBOOK_API_KEY'],
    ['amplitude:flag', 'AMPLITUDE_API_KEY'],
  ])('%s without its key is a USAGE error naming %s', async (from, name) => {
    const amp = from.startsWith('amplitude') ? ['--metric', 'm', '--start', '2026-10-01'] : [];
    const e = await failure(run('--from', from, ...amp));
    expect(e.code).toBe('USAGE');
    expect(e.message).toContain(name);
    expect(guarded.calls).toEqual([]);
  });
  it.each([
    {
      from: 'growthbook:exp_example1',
      args: [],
      env: { GROWTHBOOK_API_KEY: GB_KEY },
      route: growthbookRoutes(),
      head: /GrowthBook experiment exp_example1, metric Signups: Control 120\/2400, Short form 150\/2380/,
    },
    {
      from: 'amplitude:checkout-button-copy',
      args: ['--metric', 'purchase_completed', '--start', '2026-10-01', '--end', '2026-10-31'],
      env: { AMPLITUDE_API_KEY: AMP_KEY, AMPLITUDE_SECRET_KEY: AMP_SECRET },
      route: amplitudeRoutes(),
      head: /Amplitude experiment checkout-button-copy, metric purchase_completed: control 120\/2400, treatment 150\/2380/,
    },
  ])('$from: a complete analysis never prints a key', async ({ from, args, env, route, head }) => {
    Object.assign(process.env, env);
    serve(route);
    const r = await run('--from', from, ...args, '--json');
    expect(r.text).toMatch(head);
    const all = JSON.stringify(r) + printed;
    for (const k of ALL_KEYS) expect(all).not.toContain(k);
  });
  it('Amplitude with only the control arm is refused as incomplete data, not with a manual-numbers hint', async () => {
    Object.assign(process.env, { AMPLITUDE_API_KEY: AMP_KEY, AMPLITUDE_SECRET_KEY: AMP_SECRET });
    serve(() =>
      json(
        JSON.stringify({
          data: [
            { groupValue: 'control', cumulativeRaw: [2400, 120] },
            { groupValue: '(none)', cumulativeRaw: [3, 0] },
          ],
        }),
      ),
    );
    const e = await failure(run('--from', 'amplitude:f', '--metric', 'buy', '--start', '2026-10-01'));
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.message).toMatch(/Not analyzed: amplitude:f returned incomplete data/);
    expect(e.message).toMatch(/the other arm is missing/);
    expect(e.hint).not.toMatch(/--control and --variant/);
  });
  it('a GrowthBook count metric is refused end to end', async () => {
    process.env.GROWTHBOOK_API_KEY = GB_KEY;
    serve(growthbookRoutes());
    const e = await failure(run('--from', 'growthbook:exp_example1', '--metric', 'met_pageviews'));
    expect(e.code).toBe('INVALID_INPUT');
    expect(e.message).toMatch(/count metric/);
  });
  it('Amplitude-only flags are refused for PostHog and GrowthBook, and --from-only flags without --from', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    process.env.GROWTHBOOK_API_KEY = GB_KEY;
    const a = await failure(run('--from', 'posthog:42', '--start', '2026-10-01'));
    expect([a.code, a.message]).toEqual([
      'USAGE',
      expect.stringMatching(/--start applies only to amplitude; posthog/),
    ]);
    const b = await failure(run('--from', 'growthbook:exp_example1', '--control-key', 'off'));
    expect(b.message).toMatch(/--control-key applies only to amplitude; growthbook/);
    const c = await failure(run('--control', '120/2400', '--variant', '150/2380', '--metric', 'x'));
    expect([c.code, c.message]).toEqual(['USAGE', '--metric applies only with --from <adapter>:<id>.']);
    expect(guarded.calls).toEqual([]);
  });
  it('the manual path shares the analysis step and keeps its output shape', async () => {
    const r = await run('--control', '120/2400', '--variant', '150/2380');
    expect(r.data).not.toHaveProperty('source');
    expect(r.text.startsWith('• ')).toBe(true);
    expect((r.data as { pValue: number }).pValue).toBeCloseTo(0.0511, 3);
  });
  it('--from is sequential by default, and --fixed opts out', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    serve(posthogRoutes());
    const seq = await run('--from', 'posthog:42');
    expect(seq.data).toMatchObject({ mode: 'sequential', decision: 'continue', tau: 0.1, alpha: 0.05 });
    expect((seq.data as { pValue: number }).pValue).toBeGreaterThan(0.0511);
    expect(seq.data).not.toHaveProperty('significant');
    expect(seq.text).toMatch(/• Continue: .*always-valid p = /);
    expect(seq.text).toMatch(/mSPRT, mixing τ = 0\.1/);
    const fixed = await run('--from', 'posthog:42', '--fixed', '--planned', '5000');
    expect(fixed.data).toMatchObject({ mode: 'fixed', significant: false });
    expect((fixed.data as { pValue: number }).pValue).toBeCloseTo(0.0511, 3);
    expect(fixed.text).toMatch(/peeking/);
  });
  it('--sequential opts in for typed-in numbers; conflicting or misplaced flags are usage errors', async () => {
    const r = await run('--control', '500/10000', '--variant', '650/10000', '--sequential', '--tau', '0.05');
    expect(r.data).toMatchObject({ mode: 'sequential', decision: 'stop-b-better', tau: 0.05 });
    expect(r.text).toMatch(/^• Stop: variant is better/);
    const usage = async (...argv: string[]) => (await failure(run(...argv))).message;
    const manual = ['--control', '120/2400', '--variant', '150/2380'];
    expect(await usage(...manual, '--sequential', '--fixed')).toMatch(/one of --sequential and --fixed/);
    expect(await usage(...manual, '--tau', '0.2')).toMatch(/--tau applies only to a sequential/);
    expect(await usage(...manual, '--sequential', '--planned', '5000')).toMatch(/--planned applies only/);
    expect((await failure(run(...manual, '--sequential', '--tau', '0'))).code).toBe('INVALID_INPUT');
    process.env.POSTHOG_API_KEY = PH_KEY;
    serve(posthogRoutes());
    const e = await failure(run('--from', 'posthog:42', '--planned', '5000'));
    expect([e.code, e.hint]).toEqual(['USAGE', expect.stringMatching(/--fixed/)]);
    expect(guarded.calls).toEqual([]);
  });
  it('a refused key names the variable, not the value', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    serve(() => json(`{"detail":"Invalid key ${PH_KEY}"}`, 401));
    const e = await failure(run('--from', 'posthog:42'));
    expect(e.code).toBe('USAGE');
    expect(e.message).toMatch(/refused the key in POSTHOG_API_KEY \(HTTP 401\)/);
    expect(`${e.message} ${e.hint} ${printed}`).not.toContain(PH_KEY);
  });
  it('a network error never carries the key', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    guarded.serve = () => {
      throw new Error(`socket hang up near ${PH_KEY}`);
    };
    const e = await failure(run('--from', 'posthog:42'));
    expect(e.message).toMatch(/could not be reached/);
    expect(`${e.message} ${e.hint}`).not.toContain(PH_KEY);
  });
  it('rejects plain http to a public vendor host, and --from mixed with manual numbers', async () => {
    process.env.POSTHOG_API_KEY = PH_KEY;
    process.env.POSTHOG_HOST = 'http://posthog.example.com';
    expect((await failure(run('--from', 'posthog:42'))).message).toMatch(/POSTHOG_HOST must be an https/);
    expect((await failure(run('--from', 'posthog:42', '--control', '1/2'))).code).toBe('USAGE');
    expect((await failure(run('--from', 'mixpanel:1'))).message).toMatch(/Unknown adapter/);
  });
});
