import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COLLAPSIBLE_RULES,
  collapseVolatileFindings,
  makeFinding,
  mergeFindings,
} from '../../src/audit/finding.js';
import { reliabilityFindings } from '../../src/audit/rules/experience.js';
import { VIEWPORTS } from '../../src/browser/viewports.js';
import { benchMatches } from '../../src/cli/commands/bench.js';
import type { Finding, PageCapture } from '../../src/core/types.js';
import { compareRuns } from '../../src/report/compare.js';
import { renderHtml } from '../../src/report/html.js';
import { renderMarkdown } from '../../src/report/text.js';
import { trendReport, trendSlice } from '../../src/report/trends.js';
import { obs, run } from '../helpers.js';

// Field evidence (F44, frameva.io on 1.2.1): Cloudflare's e-mail obfuscation decoder blocked by the site's CSP gave,
// on every page, a console error with that page's nonce, React error #418 and a failed request with a cache-buster.
const SITE = 'https://example.test';
const NONCES = ['Q2x0eXk3a2xhbW5vcHFy', 'ZmRzYTEyMzQ1Njc4OTBh', 'cXdlcnR5dWlvcDEyMzQ1'];
const cspText = (nonce: string) =>
  `Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self' 'nonce-${nonce}'". Either the 'unsafe-inline' keyword, a hash ('sha256-…'), or a nonce ('nonce-...') is required to enable inline execution.`;
const REACT_418 =
  'Uncaught Error: Minified React error #418; visit https://react.dev/errors/418 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.';

function fieldPage(path: string, i: number, viewport = VIEWPORTS.desktop!) {
  return obs({
    url: `${SITE}${path}`,
    finalUrl: `${SITE}${path}`,
    viewport,
    console: [
      { type: 'error', text: cspText(NONCES[i % NONCES.length]!), location: `${SITE}${path}:12` },
      { type: 'pageerror', text: REACT_418 },
    ],
    network: [
      {
        url: `${SITE}/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js?v=17314000001${i}3`,
        status: null,
        resourceType: 'script',
        failure: 'net::ERR_BLOCKED_BY_CLIENT',
        firstParty: true,
      },
    ],
  });
}

const PATHS = ['/', '/pricing', '/about'];
/** Findings as the audit engine builds them: per page and viewport, merged across viewports. */
function auditFindings(paths = PATHS, make = fieldPage): Finding[] {
  const raw = paths.flatMap((p, i) => [
    ...reliabilityFindings(make(p, i, VIEWPORTS.desktop!)),
    ...reliabilityFindings(make(p, i, VIEWPORTS.mobile!)),
  ]);
  return mergeFindings(raw);
}
const order = (paths: string[]) => paths.map((p) => `${SITE}${p}`);
const byRule = (fs: Finding[], rule: string) => fs.filter((f) => f.ruleId === rule);

/** The 1.3.0 fingerprint formula, written out independently of the code under test. */
const fp130 = (rule: string, path: string) =>
  createHash('sha256').update([rule, path, '', ''].join('\u0000')).digest('hex').slice(0, 12);

describe('collapseVolatileFindings (F44)', () => {
  it('names the rules it collapses in one list', () => {
    expect(COLLAPSIBLE_RULES).toEqual(['jourilo/console-errors', 'jourilo/failed-requests']);
  });

  it('collapses one CSP cause across 3 pages with different nonces into one finding per rule', () => {
    const merged = auditFindings();
    expect(byRule(merged, 'jourilo/console-errors')).toHaveLength(3);
    const out = collapseVolatileFindings(merged, order(PATHS));
    for (const rule of COLLAPSIBLE_RULES) {
      const [f, ...rest] = byRule(out, rule);
      expect(rest).toEqual([]);
      expect(f!.url).toBe(`${SITE}/`);
      expect(f!.pages).toEqual(order(PATHS));
      expect(f!.viewport).toBe('desktop, mobile');
      expect(f!.description).toContain(
        'Seen on 3 pages with the same evidence (volatile tokens such as nonces ignored).',
      );
      expect(f!.evidence.some((e) => e.note?.includes('same evidence appeared on 3 pages'))).toBe(true);
    }
    const ce = byRule(out, 'jourilo/console-errors')[0]!;
    expect(ce.occurrences).toBe(
      byRule(merged, 'jourilo/console-errors').reduce((n, f) => n + f.occurrences, 0),
    );
    expect(ce.severity).toBe('serious');
    expect(ce.evidence[0]!.snippet).toBe(cspText(NONCES[0]!));
  });

  it('gives a fingerprint that does not depend on page order or on which pages were sampled', () => {
    const a = collapseVolatileFindings(auditFindings(), order(PATHS));
    const reversed = [...PATHS].reverse();
    const b = collapseVolatileFindings(auditFindings(reversed), order(reversed));
    const sampled = ['/blog', '/pricing'];
    const c = collapseVolatileFindings(auditFindings(sampled), order(sampled));
    const fps = (fs: Finding[]) => COLLAPSIBLE_RULES.map((r) => byRule(fs, r)[0]!.fingerprint);
    expect(fps(b)).toEqual(fps(a));
    expect(fps(c)).toEqual(fps(a));
    expect(b.find((f) => f.ruleId === 'jourilo/console-errors')!.pages).toEqual(order(reversed));
    expect(fps(a)).not.toContain(fp130('jourilo/console-errors', '/'));
  });

  it('keeps pages with genuinely different messages or failing URLs apart', () => {
    const control = (path: string, i: number, vp = VIEWPORTS.desktop!) =>
      path === '/control'
        ? obs({
            url: `${SITE}${path}`,
            viewport: vp,
            console: [{ type: 'pageerror', text: 'Uncaught TypeError: cart is undefined' }],
            network: [{ url: `${SITE}/js/cart.js`, status: 404, resourceType: 'script', firstParty: true }],
          })
        : fieldPage(path, i, vp);
    const paths = [...PATHS, '/control'];
    const out = collapseVolatileFindings(auditFindings(paths, control), order(paths));
    for (const rule of COLLAPSIBLE_RULES) {
      const list = byRule(out, rule);
      expect(list).toHaveLength(2);
      const lone = list.find((f) => !f.pages)!;
      expect(lone.url).toBe(`${SITE}/control`);
      expect(lone.fingerprint).toBe(fp130(rule, '/control'));
    }
  });

  it('never collapses other rules or findings of different journeys', () => {
    const mk = (url: string, journey?: string) =>
      makeFinding({
        ruleId: 'jourilo/console-errors',
        title: 'Errors logged to the browser console',
        category: 'reliability',
        kind: 'defect',
        severity: 'moderate',
        confidence: 'high',
        provenance: 'observed',
        url,
        ...(journey ? { journey } : {}),
        description: 'd',
        impact: 'i',
        recommendation: 'r',
        standards: [],
        evidence: [{ type: 'console', snippet: 'boom' }],
      });
    const other = (url: string) => ({ ...mk(url), ruleId: 'jourilo/failed-third-party', fingerprint: url });
    const out = collapseVolatileFindings([
      mk(`${SITE}/a`, 'checkout'),
      mk(`${SITE}/b`, 'signup'),
      other(`${SITE}/a`),
      other(`${SITE}/b`),
    ]);
    expect(out).toHaveLength(4);
    expect(out.every((f) => !f.pages)).toBe(true);
  });

  it('leaves a finding seen on a single page exactly as in 1.3.0', () => {
    const merged = auditFindings(['/pricing']);
    const out = collapseVolatileFindings(merged, order(['/pricing']));
    expect(out).toEqual(merged);
    expect(byRule(out, 'jourilo/console-errors')[0]!.fingerprint).toBe(
      fp130('jourilo/console-errors', '/pricing'),
    );
    expect(byRule(out, 'jourilo/console-errors')[0]!.fingerprint).toBe('4a31780641c9');
    expect(byRule(out, 'jourilo/failed-requests')[0]!.fingerprint).toBe('e571cb1e432d');
    expect(byRule(out, 'jourilo/console-errors')[0]!.pages).toBeUndefined();
  });
});

const capture = (path: string, viewport = 'desktop', status: number | null = 200): PageCapture =>
  ({
    url: `${SITE}${path}`,
    finalUrl: `${SITE}${path}`,
    status,
    title: 't',
    viewport,
    loadMs: 1,
    metrics: [],
    consoleErrors: 0,
    failedRequests: 0,
    inventory: run([]).pages[0]?.inventory as never,
  }) as PageCapture;

describe('collapsed findings in compare, trends, bench and reports', () => {
  const collapsed = (paths: string[]) => collapseVolatileFindings(auditFindings(paths), order(paths));
  const ce = (fs: Finding[]) => byRule(fs, 'jourilo/console-errors')[0]!;

  it('is fixed only when none of its pages show it any more', () => {
    const base = run(collapsed(PATHS), { id: 'base', pages: PATHS.map((p) => capture(p)) });
    // Still on one page (no collapse there: a single-page finding with its 1.3.0 fingerprint).
    const stillOne = run(collapsed(['/about']), { id: 'h1', pages: PATHS.map((p) => capture(p)) });
    let cmp = compareRuns(base, stillOne);
    expect(cmp.fixed).toEqual([]);
    expect(cmp.introduced).toEqual([]);
    expect(cmp.persisting.map((f) => f.ruleId).sort()).toEqual([...COLLAPSIBLE_RULES].sort());
    // Gone from every page that was checked, but /about was not visited: not "fixed".
    const partial = run([], { id: 'h2', pages: ['/', '/pricing'].map((p) => capture(p)) });
    expect(compareRuns(base, partial).fixed).toEqual([]);
    // Gone from all its pages.
    const clean = run([], { id: 'h3', pages: PATHS.map((p) => capture(p)) });
    expect(
      compareRuns(base, clean)
        .fixed.map((f) => f.ruleId)
        .sort(),
    ).toEqual([...COLLAPSIBLE_RULES].sort());
    // A 1.3.0-style single-page base finding that now shows on several pages persists; it is not "new".
    const old = run(collapsed(['/pricing']), { id: 'old', pages: [capture('/pricing')] });
    cmp = compareRuns(old, base);
    expect(cmp.introduced).toEqual([]);
    expect(cmp.fixed).toEqual([]);
    expect(cmp.persisting).toHaveLength(2);
  });

  it('counts a collapsed finding on every one of its pages in trends', () => {
    const r = run(collapsed(PATHS), { id: 'r1', pages: PATHS.map((p) => capture(p)) });
    const t = trendReport([trendSlice(r)], { target: r.target });
    expect(t.rows).toHaveLength(3);
    // console-errors and failed-requests, each counted once on each page's row.
    for (const row of t.rows) expect(row.points[0]!.defectsPerCapture).toBe(2);
  });

  it('satisfies a per-page bench expectation on any of its pages', () => {
    const f = ce(collapsed(PATHS));
    expect(benchMatches(f, { rule: 'jourilo/console-errors', path: '/about' })).toBe(true);
    expect(benchMatches(f, { rule: 'jourilo/console-errors', path: '/' })).toBe(true);
    expect(benchMatches(f, { rule: 'jourilo/console-errors', path: '/contact' })).toBe(false);
    const all = { rule: 'jourilo/console-errors', path: '/about' };
    expect(benchMatches(f, { ...all, pagesExactly: ['/about', '/', '/pricing'] })).toBe(true);
    expect(benchMatches(f, { ...all, pagesExactly: ['/about', '/pricing'] })).toBe(false);
    const lone = ce(collapsed(['/about']));
    expect(benchMatches(lone, { ...all, pagesExactly: ['/about', '/pricing'] })).toBe(false);
  });

  it('lists the affected pages in the HTML and Markdown reports', () => {
    const r = run(collapsed(PATHS), { pages: PATHS.map((p) => capture(p)) });
    const html = renderHtml(r);
    expect(html).toContain('Affected pages (3)');
    expect(html).toMatch(/<li><code>\/pricing<\/code><\/li>/);
    const md = renderMarkdown(r);
    expect(md).toContain('`/`, `/pricing`, `/about`');
  });
});
