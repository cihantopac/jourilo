import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyInventory, sampleLimitation, summarize } from '../../src/audit/engine.js';
import { makeFinding } from '../../src/audit/finding.js';
import type { Finding } from '../../src/core/types.js';
import { locateFindings } from '../../src/repair/locate.js';
import { compareRuns } from '../../src/report/compare.js';
import { esc, renderHtml } from '../../src/report/html.js';
import { I18N } from '../../src/report/html-i18n.js';
import { rootCauseKey } from '../../src/report/remediation.js';
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

describe('pages, captures and samples', () => {
  it('summary reports urls and captures', () => {
    // 3 URLs x 2 viewports
    const sm = summarize([], 6, 0, 3);
    expect(sm.urls).toBe(3);
    expect(sm.captures).toBe(6);
    expect(sm.pages).toBe(6);
  });

  it('summary without a URL count keeps the old shape', () => {
    expect(summarize([], 0, 2)).not.toHaveProperty('urls');
  });

  it('words the sample limitation, and stays silent when nothing was left out', () => {
    const left = Array.from({ length: 6 }, (_, i) => `https://example.test/p${i}`);
    expect(sampleLimitation({ discovered: 10, audited: 4, leftOut: left })).toMatch(
      /4 of 10 discovered pages were audited/,
    );
    expect(sampleLimitation({ discovered: 4, audited: 4, leftOut: [] })).toBeUndefined();
  });

  it('shows pages and captures in the text and HTML headers, in both languages', () => {
    const page = (url: string, viewport: string) => ({
      url,
      finalUrl: url,
      status: 200,
      title: 't',
      viewport,
      loadMs: 1,
      metrics: [],
      consoleErrors: 0,
      failedRequests: 0,
      inventory: emptyInventory(),
    });
    const r = run([], {
      pages: [
        page('https://example.test/', 'desktop'),
        page('https://example.test/', 'mobile'),
        page('https://example.test/a', 'desktop'),
        page('https://example.test/a', 'mobile'),
      ],
      summary: { ...run([]).summary, pages: 4, urls: 2, captures: 4 },
    });
    expect(renderMarkdown(r)).toContain('2 pages, 4 captures');
    expect(renderHtml(r)).toContain('4 captures');
    expect(I18N.tr['scope.captures']).toBeDefined();
  });
});

describe('component-level root causes', () => {
  // A Next.js app router project as found in the field: a shared header whose links render through NavLink, and a
  // pricing table only the pricing page uses.
  const repo = () => {
    const root = mkdtempSync(join(tmpdir(), 'jourilo-components-'));
    const put = (file: string, text: string) => {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    put(
      'src/components/Header.tsx',
      `import Link from 'next/link';
import { NavLink } from './NavLink';

export function Header() {
  return (
    <header className="border-b">
      <Link href="/" className="font-semibold">Acme</Link>
      <nav>
        <NavLink href="/pricing">Pricing</NavLink>
        <NavLink href="/about">About us</NavLink>
      </nav>
    </header>
  );
}
`,
    );
    put(
      'src/components/NavLink.tsx',
      `export const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} className="text-gray-400 hover:text-gray-900">{children}</a>
);
`,
    );
    put(
      'src/app/page.tsx',
      `import { Header } from '@/components/Header';
export default function Home() {
  return (<><Header /><main>Home</main></>);
}
`,
    );
    put(
      'src/app/pricing/page.tsx',
      `import { Header } from '@/components/Header';
function PricingTable() {
  return (
    <table className="pricing-table">
      <tbody><tr><td className="text-gray-400">Billed yearly</td></tr></tbody>
    </table>
  );
}
export default function Pricing() {
  return (<><Header /><PricingTable /></>);
}
`,
    );
    put(
      'src/app/about/page.tsx',
      `import { Header } from '@/components/Header';
export default function About() {
  return (<><Header /><main>About</main></>);
}
`,
    );
    return root;
  };
  // axe color-contrast evidence as it is recorded: the rendered <a>, its selector and the measured colors.
  const contrast = (path: string, href: string, text: string) =>
    f('axe/color-contrast', path, {
      evidence: [
        {
          type: 'element',
          selector: `header > nav > a[href="${href}"]`,
          snippet: `<a href="${href}" class="text-gray-400 hover:text-gray-900">${text}</a>`,
          data: { fgColor: '#9ca3af', bgColor: '#ffffff', contrastRatio: 2.54 },
        },
      ],
    });

  it('findings on three pages located in Header.tsx form one root cause naming the component', async () => {
    const findings = [
      contrast('/', '/pricing', 'Pricing'),
      contrast('/pricing', '/pricing', 'Pricing'),
      contrast('/about', '/about', 'About us'),
    ];
    const r = run(findings);
    await locateFindings(r, repo());
    for (const x of findings) {
      expect(x.sources?.[0]?.file).toBe('src/components/Header.tsx');
      expect(x.sources?.[0]?.component).toEqual({
        name: 'Header',
        file: 'src/components/Header.tsx',
        usedBy: 3,
      });
    }
    // Two different lines of the header (the Pricing and the About link), one cause.
    expect(new Set(findings.map((x) => x.sources?.[0]?.line)).size).toBe(2);
    expect(new Set(findings.map(rootCauseKey))).toEqual(
      new Set(['axe/color-contrast|component|src/components/Header.tsx#Header']),
    );
    const html = renderHtml(r);
    expect(html.match(/<article class="rc /g)).toHaveLength(1);
    expect(html).toContain('component Header, used by 3 routes');
  });

  it('a code file the parser cannot read never fails locating: it is named in one limitation line', async () => {
    const root = repo();
    writeFileSync(join(root, 'src/components/Broken.tsx'), 'export const Broken = () => <div>{</div>;\n');
    const findings = [contrast('/', '/pricing', 'Pricing'), contrast('/about', '/about', 'About us')];
    const r = run(findings);
    expect(await locateFindings(r, root)).toBe(2);
    expect(findings.map(rootCauseKey)).toEqual([
      'axe/color-contrast|component|src/components/Header.tsx#Header',
      'axe/color-contrast|component|src/components/Header.tsx#Header',
    ]);
    expect(r.limitations.filter((l) => l.includes('component graph'))).toEqual([
      '1 code file(s) were left out of the component graph (broken or newer syntax, or code the parser could not walk), so findings in them are grouped per source line: src/components/Broken.tsx.',
    ]);
  });

  it('a finding in a page-only component keeps its per-page root cause', async () => {
    const x = f('axe/color-contrast', '/pricing', {
      evidence: [
        {
          type: 'element',
          selector: 'table.pricing-table td',
          snippet: '<td class="text-gray-400">Billed yearly</td>',
          data: { fgColor: '#9ca3af', bgColor: '#ffffff', contrastRatio: 2.54 },
        },
      ],
    });
    await locateFindings(run([x]), repo());
    expect(x.sources?.[0]).toMatchObject({ file: 'src/app/pricing/page.tsx', line: 5 });
    expect(x.sources?.[0]?.component).toBeUndefined();
    expect(rootCauseKey(x)).toBe('axe/color-contrast|src|src/app/pricing/page.tsx:5');
  });
});
