import { describe, expect, it } from 'vitest';
import { emptyInventory } from '../../src/audit/engine.js';
import { makeFinding } from '../../src/audit/finding.js';
import type { Finding } from '../../src/core/types.js';
import { compareRuns } from '../../src/report/compare.js';
import { esc, renderHtml } from '../../src/report/html.js';
import { I18N } from '../../src/report/html-i18n.js';
import { renderMarkdown, renderSarif } from '../../src/report/text.js';
import { run } from '../helpers.js';

const f = (rule: string, path: string, over: Partial<Finding> = {}) =>
  ({
    ...makeFinding({
      ruleId: rule,
      title: `T ${rule}`,
      category: 'accessibility',
      kind: 'defect',
      severity: 'serious',
      confidence: 'high',
      provenance: 'measured',
      url: `https://example.test${path}`,
      viewport: 'desktop',
      description: 'd',
      impact: 'i',
      recommendation: 'r',
      standards: [],
      evidence: [],
    }),
    ...over,
  }) as Finding;

describe('html report', () => {
  it('escapes untrusted page content everywhere', () => {
    const evil = f('axe/x', '/', {
      title: '<img src=x onerror=alert(1)>',
      evidence: [
        {
          type: 'element',
          selector: '"><script>alert(1)</script>',
          snippet: '<svg onload=alert(1)>',
          file: 'javascript:alert(1)',
          rect: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    const html = renderHtml(run([evil], { target: 'https://e.test/"><script>x</script>' }));
    expect(html).not.toMatch(/<img src=x onerror/);
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<svg onload/);
    expect(html).not.toContain('src="javascript:');
    expect(html).toContain('Content-Security-Policy');
    expect(esc(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });
  it('carries the wordmark and a favicon the CSP allows, with no external requests', () => {
    const html = renderHtml(run([]));
    expect(html).toMatch(/<div class="brand"><svg [^>]*role="img" aria-label="Jourilo" fill="currentColor">/);
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain("img-src 'self' data:");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});

describe('compare', () => {
  it('classifies fixed, new and persisting findings by fingerprint', () => {
    const a = f('r/a', '/');
    const b = f('r/b', '/');
    const c = f('r/c', '/');
    const other = f('r/d', '/elsewhere');
    const base = run([a, b, other], {
      id: 'base',
      pages: [
        {
          url: 'https://example.test/',
          finalUrl: '',
          status: 200,
          title: '',
          viewport: 'desktop',
          loadMs: 0,
          metrics: [{ name: 'LCP', value: 3000, unit: 'ms', source: 'lab' }],
          consoleErrors: 0,
          failedRequests: 0,
          inventory: run([]).pages[0]?.inventory as never,
        },
      ],
    });
    const head = run([b, c], {
      id: 'head',
      pages: [{ ...base.pages[0]!, metrics: [{ name: 'LCP', value: 1200, unit: 'ms', source: 'lab' }] }],
    });
    const cmp = compareRuns(base, head);
    expect(cmp.fixed.map((x) => x.ruleId)).toEqual(['r/a']); // r/d's page was not re-checked: not "fixed"
    expect(cmp.introduced.map((x) => x.ruleId)).toEqual(['r/c']);
    expect(cmp.persisting.map((x) => x.ruleId)).toEqual(['r/b']);
    expect(cmp.regressionFree).toBe(false);
    expect(cmp.metrics[0]).toMatchObject({ name: 'LCP', delta: -1800 });
  });

  it('never counts findings on a page that did not load as fixed', () => {
    const a = f('r/a', '/');
    const page = {
      url: 'https://example.test/',
      finalUrl: '',
      status: 200,
      title: '',
      viewport: 'desktop',
      loadMs: 0,
      metrics: [],
      consoleErrors: 0,
      failedRequests: 0,
      inventory: run([]).pages[0]?.inventory as never,
    };
    const base = run([a], { id: 'base', pages: [page] });
    const head = run([], { id: 'head', pages: [{ ...page, status: null }] });
    expect(compareRuns(base, head).fixed).toEqual([]);
  });
});

describe('compareRuns page identity', () => {
  it('treats /de and /de/ as one page', () => {
    const a = f('r/a', '/de');
    const page = (path: string, lcp: number) => ({
      url: `https://example.test${path}`,
      finalUrl: '',
      status: 200,
      title: '',
      viewport: 'desktop',
      loadMs: 0,
      metrics: [{ name: 'LCP', value: lcp, unit: 'ms' as const, source: 'lab' as const }],
      consoleErrors: 0,
      failedRequests: 0,
      inventory: run([]).pages[0]?.inventory as never,
    });
    const base = run([a], { id: 'base', pages: [page('/de', 3000)] });
    const head = run([], { id: 'head', pages: [page('/de/', 1200)] });
    const cmp = compareRuns(base, head);
    expect(cmp.fixed.map((x) => x.ruleId)).toEqual(['r/a']);
    expect(cmp.metrics[0]).toMatchObject({ name: 'LCP', delta: -1800 });
  });
});

describe('text formats', () => {
  it('renders markdown and valid SARIF shape', () => {
    const r = run([
      f('axe/color-contrast', '/', {
        sources: [{ file: 'src/a.css', line: 3, reason: 'x', confidence: 'high' }],
      }),
      f('conv/x', '/', { kind: 'hypothesis' }),
    ]);
    const md = renderMarkdown(r);
    expect(md).toContain('## Defects');
    expect(md).toContain('## Conversion hypotheses (untested)');
    const sarif = renderSarif(r) as {
      version: string;
      runs: {
        results: {
          level: string;
          locations: { physicalLocation: { artifactLocation: { uri: string } } }[];
        }[];
      }[];
    };
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe('src/a.css');
    expect(sarif.runs[0]!.results[1]!.level).toBe('note');
  });
});

describe('metric verdicts', () => {
  it('separates real changes from noise', async () => {
    const { metricVerdict } = await import('../../src/report/compare.js');
    const m = (value: number, range?: [number, number]) => ({
      name: 'LCP',
      value,
      unit: 'ms' as const,
      source: 'lab' as const,
      ...(range ? { runs: 5, range } : {}),
    });
    expect(metricVerdict('LCP', m(2400, [2300, 2600]), m(1200, [1100, 1300]))).toBe('improved');
    expect(metricVerdict('LCP', m(1200, [1100, 1300]), m(2400, [2300, 2600]))).toBe('regressed');
    expect(metricVerdict('LCP', m(2400, [2000, 2900]), m(2200, [1900, 2500]))).toBe('noise');
    expect(metricVerdict('LCP', m(2400), m(2350))).toBe('noise');
    expect(metricVerdict('LCP', m(2400), m(1200))).toBe('unconfirmed');
    expect(
      metricVerdict(
        'Transfer',
        { ...m(100_000), name: 'Transfer', unit: 'bytes' },
        { ...m(60_000), name: 'Transfer', unit: 'bytes' },
      ),
    ).toBe('improved');
  });
});

describe('report sections for safety and stability', () => {
  const r = run([], {
    network: {
      blocked: [{ host: '<img src=x onerror=alert(1)>', port: 6379, reason: 'loopback refused' }],
      escaped: [{ url: 'http://127.0.0.1/admin', reason: 'redirect refused' }],
    },
    journeys: [
      {
        id: 'pay',
        name: 'Pay',
        viewport: 'desktop',
        status: 'failed',
        steps: [],
        successCriteria: [],
        durationMs: 10,
        stability: 'flaky',
        attempts: [
          { status: 'passed', durationMs: 5 },
          { status: 'failed', durationMs: 5 },
        ],
        blockedRequests: [
          { method: 'DELETE', url: 'https://example.test/api/x', reason: '<b>irreversible</b>' },
        ],
      },
    ],
  });
  it('shows guard activity, flaky journeys and the manual review list, escaped', () => {
    const html = renderHtml(r);
    expect(html).toContain('Network safety');
    expect(html).toContain('Security event');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('data-i18n="st.flaky">Flaky<');
    expect(html).toContain('2 attempts: passed, failed');
    expect(html).toContain('&lt;b&gt;irreversible&lt;/b&gt;');
    expect(html).toContain('Still needs a person');
    const md = renderMarkdown(r);
    expect(md).toContain('## Network safety');
    expect(md).toContain('## Still needs a person');
    expect(md).toContain('2.5.7 Dragging movements');
  });
});

describe('dismissed findings in the report', () => {
  it('the report lists dismissed findings with their reason, folded, in EN and TR', () => {
    const a = f('axe/a', '/', { title: 'Image without alt text' });
    const dismissed = [
      {
        ...a,
        dismissal: {
          fingerprint: a.fingerprint,
          ruleId: a.ruleId,
          url: a.url,
          reason: 'Decorative <b>image</b>',
          by: 'user' as const,
          at: '2026-11-03T10:00:00.000Z',
        },
      },
    ];
    const html = renderHtml(run([], { dismissed }));
    expect(html).toContain('Dismissed as not a problem (1)');
    expect(html).toContain('Decorative &lt;b&gt;image&lt;/b&gt;');
    expect(html).toContain('2026-11-03');
    const section = html.slice(
      html.indexOf('id="h-dismissed"') - 200,
      html.indexOf('id="h-dismissed"') + 1500,
    );
    expect(section).toContain('<details');
    expect(section).not.toContain('type="checkbox"');
    expect(section).not.toContain('<button');
    expect(I18N.tr['dismissed.title']).toBe('Sorun değil olarak kapatılanlar ({n})');
    expect(renderHtml(run([]))).not.toContain('h-dismissed');
    const md = renderMarkdown(run([], { dismissed }));
    expect(md).toContain('## Dismissed');
    expect(md).toContain('Decorative <b>image</b>');
  });

  it('the report renders a page whose screenshot is absent', () => {
    const shotless = f('usability/x', '/', {
      evidence: [{ type: 'element', selector: 'a.cta', rect: { x: 10, y: 10, width: 50, height: 20 } }],
    });
    const html = renderHtml(
      run([shotless], {
        settings: { evidence: 'minimal' },
        pages: [
          {
            url: 'https://example.test/',
            finalUrl: 'https://example.test/',
            status: 200,
            title: 'Home',
            viewport: 'desktop',
            loadMs: 1,
            metrics: [],
            consoleErrors: 0,
            failedRequests: 0,
            inventory: emptyInventory(),
          },
        ],
      }),
    );
    expect(html).not.toMatch(/<img[^>]*src="screenshots\//);
    expect(html).toContain('No screenshot kept');
    expect(renderMarkdown(run([shotless]))).toBeTruthy();
  });
});
