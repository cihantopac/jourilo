import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import type { Finding } from '../../src/core/types.js';
import { compareRuns } from '../../src/report/compare.js';
import { esc, renderHtml } from '../../src/report/html.js';
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
