import { describe, expect, it } from 'vitest';
import { makeFinding, mergeFindings } from '../../src/audit/finding.js';
import {
  axeFindings,
  keyboardFindings,
  measuredA11yFindings,
  suggestAutocomplete,
  widgetFindings,
} from '../../src/audit/rules/accessibility.js';
import {
  performanceFindings,
  reliabilityFindings,
  responsiveFindings,
} from '../../src/audit/rules/experience.js';
import { wcag, wcagFromAxeTags } from '../../src/audit/standards.js';
import { VIEWPORTS } from '../../src/browser/viewports.js';
import { rate } from '../../src/browser/vitals.js';
import { conversionFindings, isLandingPath } from '../../src/conversion/rules.js';
import { obs, probe } from '../helpers.js';

const rect = { x: 0, y: 0, width: 10, height: 10 };

describe('standards', () => {
  it('maps axe tags to WCAG 2.2 criteria with Understanding links', () => {
    const refs = wcagFromAxeTags(['wcag2aa', 'wcag143', 'wcag258', 'best-practice']);
    expect(refs.map((r) => r.id)).toEqual(['1.4.3', '2.5.8']);
    expect(refs[1]!.title).toBe('Target Size (Minimum) (Level AA)');
    expect(wcag('2.4.11').url).toBe(
      'https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html',
    );
  });
  it('rates metrics with web.dev thresholds', () => {
    expect(rate('LCP', 2500)).toBe('good');
    expect(rate('LCP', 2501)).toBe('needs-improvement');
    expect(rate('LCP', 4001)).toBe('poor');
    expect(rate('CLS', 0.1)).toBe('good');
    expect(rate('INP', 600)).toBe('poor');
  });
});

describe('accessibility rules', () => {
  it('turns axe violations into measured defects and incomplete into review items', () => {
    const f = axeFindings(
      obs({
        screenshot: 'screenshots/a.jpg',
        axe: {
          version: '4.14.0',
          violations: [
            {
              id: 'color-contrast',
              impact: 'serious',
              help: 'Contrast',
              helpUrl: 'https://x',
              description: 'd',
              tags: ['wcag2aa', 'wcag143'],
              nodes: [
                {
                  target: '.sub',
                  html: '<p class="sub">x</p>',
                  summary: 'Fix',
                  rect,
                  data: { fgColor: '#b5b5b5', contrastRatio: 2.04 },
                },
              ],
            },
            {
              id: 'region',
              impact: 'moderate',
              help: 'Region',
              helpUrl: 'https://y',
              description: 'd',
              tags: ['best-practice'],
              nodes: [{ target: 'div', html: '<div>', summary: '' }],
            },
          ],
          incomplete: [
            {
              id: 'color-contrast',
              impact: 'serious',
              help: 'Contrast',
              helpUrl: 'https://x',
              description: 'd',
              tags: ['wcag143'],
              nodes: [{ target: '.bg', html: '', summary: '' }],
            },
            {
              id: 'bp-only',
              impact: 'minor',
              help: 'BP',
              helpUrl: 'https://z',
              description: 'd',
              tags: ['best-practice'],
              nodes: [{ target: 'a', html: '', summary: '' }],
            },
          ],
        },
      }),
    );
    const contrast = f.find((x) => x.ruleId === 'axe/color-contrast')!;
    expect(contrast.kind).toBe('defect');
    expect(contrast.provenance).toBe('measured');
    expect(contrast.standards[0]!.id).toBe('1.4.3');
    expect(contrast.evidence[0]!.data).toMatchObject({ contrastRatio: 2.04 });
    expect(f.find((x) => x.ruleId === 'axe/region')!.severity).toBe('moderate');
    expect(f.filter((x) => x.kind === 'needs-review').map((x) => x.ruleId)).toEqual([
      'axe-review/color-contrast',
    ]);
  });

  it('decides sampled contrast over images and keeps unsampled nodes for review (F8)', () => {
    // axe-core 4.14 incomplete data for text over a background image, as recorded in a real run.
    const node = (id: string, contrast?: { worst: number; best: number; large: boolean }) => ({
      target: `#${id}`,
      html: `<p class="hero" id="${id}">Text</p>`,
      summary:
        "Fix any of the following:\n  Element's background color could not be determined due to a background image",
      rect,
      data: {
        fgColor: '#ffffff',
        contrastRatio: 0,
        fontSize: '15.0pt (20px)',
        fontWeight: 'normal',
        messageKey: 'bgImage',
        expectedContrastRatio: '4.5:1',
      },
      ...(contrast ? { contrast } : {}),
    });
    const f = axeFindings(
      obs({
        screenshot: 'screenshots/a.jpg',
        axe: {
          version: '4.14.0',
          violations: [],
          incomplete: [
            {
              id: 'color-contrast',
              impact: 'serious',
              help: 'Elements must meet minimum color contrast ratio thresholds',
              helpUrl: 'https://x',
              description: 'd',
              tags: ['cat.color', 'wcag2aa', 'wcag143'],
              nodes: [
                node('bad-light', { worst: 1.0712, best: 1.17, large: false }),
                node('bad-mixed', { worst: 1.1, best: 17.85, large: false }),
                node('ok-dark', { worst: 10.47, best: 17.85, large: false }),
                node('ok-large', { worst: 3.4, best: 5.2, large: true }),
                node('unsampled'),
              ],
            },
          ],
        },
      }),
    );
    const defect = f.find((x) => x.ruleId === 'jourilo/contrast-over-image')!;
    expect(defect).toMatchObject({
      kind: 'defect',
      severity: 'serious',
      confidence: 'medium',
      provenance: 'measured',
      occurrences: 2,
    });
    expect(defect.standards.map((s) => s.id)).toEqual(['1.4.3']);
    expect(defect.evidence.map((e) => e.selector)).toEqual(['#bad-light', '#bad-mixed']);
    expect(defect.evidence[0]!.data).toEqual({
      worstRatio: 1.07,
      bestRatio: 1.17,
      required: 4.5,
      large: false,
    });
    // Passing nodes (3:1 is enough for large text) are dropped; the unsampled one stays for manual review.
    const review = f.find((x) => x.ruleId === 'axe-review/color-contrast')!;
    expect(review.evidence.map((e) => e.selector)).toEqual(['#unsampled']);
    expect(review.occurrences).toBe(1);
  });

  it('reports invisible focus, obscured focus and traps from the keyboard walk', () => {
    const stop = (i: number, changes: string[], obscured = false) => ({
      index: i,
      selector: `#b${i}`,
      name: `B${i}`,
      tag: 'button',
      rect,
      indicatorChanges: changes,
      indicatorChecked: true,
      obscured,
      inModal: false,
    });
    const f = keyboardFindings(
      obs({
        viewport: VIEWPORTS.desktop!,
        keyboard: {
          stops: [stop(0, []), stop(1, ['outline:solid']), stop(2, ['x'], true)],
          focusableCount: 3,
          completedCycle: true,
          trap: null,
          pressed: 4,
        },
      }),
    );
    expect(f.map((x) => x.ruleId).sort()).toEqual(['jourilo/focus-obscured', 'jourilo/focus-visible']);
    expect(f.find((x) => x.ruleId === 'jourilo/focus-visible')!.occurrences).toBe(1);
    // The element's markup identifies it (class and state) next to its visible name.
    const marked = keyboardFindings(
      obs({
        keyboard: {
          stops: [
            { ...stop(0, []), markup: '<button class="tool" aria-pressed="true">', name: 'bedava Jourilo' },
          ],
          focusableCount: 1,
          completedCycle: true,
          trap: null,
          pressed: 2,
        },
      }),
    );
    expect(marked[0]!.evidence[0]!.snippet).toBe('<button class="tool" aria-pressed="true">bedava Jourilo');
    expect(f.find((x) => x.ruleId === 'jourilo/focus-visible')!.evidence[0]!.snippet).toBe('B0');
    const trap = keyboardFindings(
      obs({
        keyboard: {
          stops: [],
          focusableCount: 20,
          completedCycle: false,
          trap: { selectors: ['#a', '#b'] },
          pressed: 20,
        },
      }),
    );
    expect(trap[0]!.severity).toBe('critical');
    // F23: focus held where nothing else is focusable is still a trap, described as what was pressed.
    const alone = keyboardFindings(
      obs({
        keyboard: {
          stops: [],
          focusableCount: 2,
          completedCycle: false,
          trap: { selectors: ['#first', '#last'], held: 12 },
          pressed: 14,
        },
      }),
    );
    expect([alone[0]!.ruleId, alone[0]!.kind, alone[0]!.severity]).toEqual([
      'jourilo/keyboard-trap',
      'defect',
      'critical',
    ]);
    expect(alone[0]!.description).toBe(
      'Focus stayed among 2 element(s) outside any modal dialog through 12 presses of Tab, 12 of Shift+Tab and 12 of Tab after Escape; it never returned to the page or the browser.',
    );
  });

  it('flags personal-data fields without autocomplete and placeholder-only labels', () => {
    const p = probe();
    p.inventory.forms = [
      {
        selector: '#signup',
        purpose: 'signup',
        action: null,
        method: 'post',
        submitText: 'Submit',
        fields: [
          { selector: '#e', type: 'email', name: 'email', label: null, required: true, autocomplete: null },
          {
            selector: '#c',
            type: 'checkbox',
            name: 'terms',
            label: 'I agree',
            required: true,
            autocomplete: null,
          },
          {
            selector: '#n',
            type: 'text',
            name: 'nickname',
            label: 'Nickname',
            required: false,
            autocomplete: 'nickname',
          },
        ],
      },
    ];
    const f = measuredA11yFindings(obs({ probe: p }));
    expect(f.find((x) => x.ruleId === 'jourilo/input-purpose')!.occurrences).toBe(1);
    expect(f.find((x) => x.ruleId === 'jourilo/placeholder-label')!.occurrences).toBe(1);
    expect(suggestAutocomplete('password', 'pw', null, 'signup')).toBe('new-password');
    expect(suggestAutocomplete('text', 'last_name', null, 'other')).toBe('family-name');
  });
});

describe('widget rules', () => {
  it('maps keyboard widget issues to WCAG findings, one per kind', () => {
    const issue = (
      kind: 'dialog-focus-not-moved' | 'expanded-state-mismatch' | 'composite-unreachable',
      name: string,
    ) => ({
      kind,
      trigger: `#${name}`,
      name,
      rect,
      detail: 'd',
    });
    const f = widgetFindings(
      obs({
        widgets: {
          triggers: 3,
          dialogs: 1,
          disclosures: 2,
          composites: 1,
          issues: [
            issue('dialog-focus-not-moved', 'a'),
            issue('expanded-state-mismatch', 'b'),
            issue('expanded-state-mismatch', 'c'),
            { ...issue('composite-unreachable', 'd'), steps: ['Press Tab.', 'Press ArrowRight.'] },
          ],
        },
      }),
    );
    expect(f.map((x) => [x.ruleId, x.occurrences, x.standards[0]!.id])).toEqual([
      ['jourilo/dialog-focus', 1, '2.4.3'],
      ['jourilo/expanded-state', 2, '4.1.2'],
      ['jourilo/composite-keyboard', 1, '2.1.1'],
    ]);
    expect(f[2]!.reproduction.slice(1)).toEqual(['Press Tab.', 'Press ArrowRight.']);
    expect(
      widgetFindings(
        obs({ widgets: { triggers: 0, dialogs: 0, disclosures: 0, composites: 0, issues: [] } }),
      ),
    ).toEqual([]);
  });
});

describe('experience rules', () => {
  it('measures horizontal overflow against the configured viewport', () => {
    const f = responsiveFindings(
      obs({
        probe: probe({
          overflow: {
            docWidth: 680,
            viewportWidth: 390,
            offenders: [{ selector: '.strip', rect, right: 680, width: 640, tag: 'div' }],
          },
        }),
      }),
    );
    expect(f[0]!.ruleId).toBe('jourilo/horizontal-overflow');
    expect(f[0]!.severity).toBe('serious');
    expect(f[0]!.description).toContain('290 px');
  });
  it('overflow with offenders stays a defect', () => {
    const f = responsiveFindings(
      obs({
        screenshot: 'screenshots/a.jpg',
        probe: probe({
          overflow: {
            docWidth: 420,
            viewportWidth: 375,
            offenders: [{ selector: '.strip', rect, right: 420, width: 400, tag: 'div' }],
          },
        }),
      }),
    );
    expect(f[0]!.kind).toBe('defect');
    expect(f[0]!.confidence).toBe('high');
  });
  it('overflow without offenders is a needs-review item', () => {
    const input = {
      screenshot: 'screenshots/a.jpg',
      probe: probe({ overflow: { docWidth: 420, viewportWidth: 375, offenders: [] } }),
    };
    const f = responsiveFindings(obs(input));
    expect(f).toHaveLength(1);
    expect(f[0]!.kind).toBe('needs-review');
    expect(f[0]!.confidence).toBe('low');
    expect(f[0]!.severity).toBe('serious');
    expect(f[0]!.description).toContain('no element could be located');
    expect(f[0]!.evidence.length).toBeGreaterThan(0);
    expect(f[0]!.evidence.some((e) => e.file === 'screenshots/a.jpg')).toBe(true);
    const withOffender = responsiveFindings(
      obs({
        ...input,
        probe: probe({
          overflow: {
            docWidth: 420,
            viewportWidth: 375,
            offenders: [{ selector: '.strip', rect, right: 420, width: 400, tag: 'div' }],
          },
        }),
      }),
    );
    expect(f[0]!.fingerprint).toBe(withOffender[0]!.fingerprint);
  });
  it('does not flag pages that fit', () => {
    expect(responsiveFindings(obs())).toEqual([]);
  });
  it('separates first-party failures from third-party noise', () => {
    const f = reliabilityFindings(
      obs({
        console: [{ type: 'pageerror', text: 'ReferenceError: x is not defined' }],
        network: [
          { url: 'https://example.test/app.js', status: 404, resourceType: 'script', firstParty: true },
          {
            url: 'https://cdn.other/pixel',
            status: null,
            resourceType: 'image',
            failure: 'net::ERR_BLOCKED',
            firstParty: false,
          },
        ],
      }),
    );
    expect(f.map((x) => [x.ruleId, x.severity])).toEqual([
      ['jourilo/console-errors', 'serious'],
      ['jourilo/failed-requests', 'serious'],
      ['jourilo/failed-third-party', 'minor'],
    ]);
  });
  it('redacts secrets in the redirect hops of an unreachable page', () => {
    const f = reliabilityFindings(
      obs({
        errors: ['navigation: net::ERR_TOO_MANY_REDIRECTS at https://example.test/a?token=secret'],
        redirects: [
          {
            status: 302,
            from: 'https://example.test/a?token=secret',
            to: 'https://example.test/b?token=secret',
          },
          {
            status: 302,
            from: 'https://example.test/b?token=secret',
            to: 'https://example.test/a?token=secret',
          },
        ],
      }),
    );
    const unreachable = f.find((x) => x.ruleId === 'jourilo/page-unreachable')!;
    expect(unreachable).toBeDefined();
    expect(JSON.stringify([unreachable.title, unreachable.description, unreachable.evidence])).not.toContain(
      'secret',
    );
  });
  it('reports a chain of three or more redirects before the page, not one or two', () => {
    // As capture records them: redacted absolute URLs, main-frame navigation hops only.
    const hops = [
      { status: 301, from: 'http://127.0.0.1:41234/old', to: 'http://127.0.0.1:41234/older' },
      { status: 302, from: 'http://127.0.0.1:41234/older', to: 'http://127.0.0.1:41234/oldest' },
      { status: 301, from: 'http://127.0.0.1:41234/oldest', to: 'https://cdn.example.test/new?token=secret' },
    ];
    const page = {
      url: 'http://127.0.0.1:41234/old',
      finalUrl: 'https://cdn.example.test/new?token=REDACTED',
    };
    const chain = performanceFindings(obs({ ...page, redirects: hops })).filter(
      (f) => f.ruleId === 'jourilo/redirect-chain',
    );
    expect(chain).toHaveLength(1);
    const f = chain[0]!;
    expect([f.kind, f.severity, f.category]).toEqual(['defect', 'minor', 'performance']);
    expect(f.standards.length).toBeGreaterThan(0);
    expect(f.title).toBe('Page is reached through 3 redirects');
    expect(f.description).toContain('301 /old → /older');
    expect(f.description).toContain('https://cdn.example.test/new');
    expect(JSON.stringify(f)).not.toContain('secret');
    // Network evidence only: there is no element or source line to point at.
    expect(f.evidence.every((e) => e.type === 'network' && !e.selector)).toBe(true);
    for (const n of [1, 2])
      expect(
        performanceFindings(obs({ ...page, redirects: hops.slice(0, n) })).some(
          (x) => x.ruleId === 'jourilo/redirect-chain',
        ),
      ).toBe(false);
  });
  it('does not report a redirect chain on top of a redirect loop', () => {
    const loop = [0, 1, 2, 3].map((i) => ({
      status: 302,
      from: `https://example.test/${i % 2 ? 'b' : 'a'}`,
      to: `https://example.test/${i % 2 ? 'a' : 'b'}`,
    }));
    const o = obs({
      errors: ['navigation: net::ERR_TOO_MANY_REDIRECTS at https://example.test/a'],
      redirects: loop,
      status: null,
      probe: null,
    });
    const all = [...reliabilityFindings(o), ...performanceFindings(o)].map((f) => f.ruleId);
    expect(all).toEqual(['jourilo/page-unreachable']);
  });
  it('labels lab metrics and ignores good values', () => {
    const vitals = {
      lcp: 4300,
      lcpElement: 'h1',
      cls: 0.02,
      clsEntries: [],
      fcp: 4200,
      ttfb: 30,
      tbt: 0,
      inp: null,
      interactions: 0,
      domContentLoaded: 4300,
      load: 4400,
      transferBytes: 1000,
      requests: 3,
      domNodes: 50,
    };
    const f = performanceFindings(obs({ vitals }));
    expect(f.map((x) => x.ruleId).sort()).toEqual(['perf/fcp', 'perf/lcp']);
    expect(f.find((x) => x.ruleId === 'perf/lcp')!.title).toContain('lab');
  });
});

describe('conversion rules', () => {
  it('treats findings as hypotheses, never defects', () => {
    const p = probe();
    p.inventory.h1 = ['Welcome'];
    p.inventory.ctas = [
      { text: 'Submit', selector: '#go', href: null, rect, aboveFold: true, emphasis: 'primary' },
    ];
    const f = conversionFindings(obs({ probe: p }));
    expect(f.length).toBeGreaterThan(0);
    expect(f.every((x) => x.kind === 'hypothesis' && x.category === 'conversion')).toBe(true);
    expect(f.map((x) => x.ruleId)).toContain('conv/unclear-value-proposition');
    expect(f.map((x) => x.ruleId)).toContain('conv/vague-cta-label');
    expect(f[0]!.impact).toMatch(/^Hypothesis/);
  });
  it('detects landing paths', () => {
    expect(isLandingPath('https://a.test/')).toBe(true);
    expect(isLandingPath('https://a.test/de')).toBe(true);
    expect(isLandingPath('https://a.test/pricing')).toBe(false);
  });
});

describe('merge', () => {
  const mk = (
    offenders: { selector: string; rect: typeof rect; right: number; width: number; tag: string }[],
    vp: 'desktop' | 'mobile',
  ) =>
    responsiveFindings(
      obs({
        viewport: VIEWPORTS[vp]!,
        probe: probe({ overflow: { docWidth: 420, viewportWidth: 375, offenders } }),
      }),
    );
  const located = [{ selector: '.strip', rect, right: 420, width: 400, tag: 'div' }];
  it('lets a located defect win over a review item in either viewport order', () => {
    const review = mk([], 'desktop');
    const defect = mk(located, 'mobile');
    for (const order of [
      [...review, ...defect],
      [...defect, ...review],
    ]) {
      const merged = mergeFindings(order);
      expect(merged).toHaveLength(1);
      expect(merged[0]!.kind).toBe('defect');
      expect(merged[0]!.confidence).toBe('high');
      expect(merged[0]!.description).toContain('Widest culprit');
      expect(merged[0]!.description).not.toContain('no element could be located');
    }
  });
  it('leaves merges of equal kind unchanged', () => {
    const merged = mergeFindings([...mk([], 'desktop'), ...mk([], 'mobile')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind).toBe('needs-review');
    expect(merged[0]!.confidence).toBe('low');
    expect(merged[0]!.description).toContain('no element could be located');
  });
  it('folds the same defect seen in two viewports into one finding', () => {
    const a = responsiveFindings(
      obs({ probe: probe({ overflow: { docWidth: 500, viewportWidth: 390, offenders: [] } }) }),
    );
    const b = responsiveFindings(
      obs({
        viewport: VIEWPORTS.reflow!,
        probe: probe({ overflow: { docWidth: 500, viewportWidth: 320, offenders: [] } }),
      }),
    );
    const merged = mergeFindings([...a, ...b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.viewport).toBe('mobile, reflow');
  });
});

describe('repeated lab runs', () => {
  it('reports medians with their range', async () => {
    const { medianVitals } = await import('../../src/browser/capture.js');
    const { toMetrics } = await import('../../src/browser/vitals.js');
    const v = (lcp: number, cls: number) => ({
      lcp,
      lcpElement: 'h1',
      cls,
      clsEntries: [],
      fcp: lcp,
      ttfb: 10,
      tbt: 0,
      inp: null,
      interactions: 0,
      domContentLoaded: 0,
      load: lcp,
      transferBytes: 1000,
      requests: 3,
      domNodes: 10,
    });
    const m = medianVitals([v(3000, 0.2), v(1000, 0.05), v(2600, 0.12)]);
    expect(m.vitals.lcp).toBe(2600);
    expect(m.vitals.cls).toBe(0.12);
    expect(m.spread.lcp).toEqual([1000, 3000]);
    const lcp = toMetrics(m.vitals, m.spread, 3).find((x) => x.name === 'LCP')!;
    expect(lcp.rating).toBe('needs-improvement');
    expect(lcp.note).toContain('Median of 3 runs (range 1000–3000)');
  });
});

describe('structure rules', () => {
  it('reports fieldsets, radio groups, header-less tables and alt/title conflicts', async () => {
    const { structureFindings } = await import('../../src/audit/rules/accessibility.js');
    const p = probe({
      structure: {
        fieldsets: [{ selector: 'fieldset', rect, issue: 'no legend' }],
        radioGroups: [{ name: 'door', selector: 'input', rect, count: 2 }],
        tables: [{ selector: 'table', rect, rows: 3, cols: 2 }],
        altTitle: [{ selector: 'img', rect, title: 'Van' }],
      },
    });
    expect(structureFindings(obs({ probe: p })).map((f) => [f.ruleId, f.standards[0]!.id])).toEqual([
      ['jourilo/fieldset-legend', '1.3.1'],
      ['jourilo/radio-group', '1.3.1'],
      ['jourilo/table-headers', '1.3.1'],
      ['jourilo/empty-alt-with-title', '1.1.1'],
    ]);
    expect(structureFindings(obs())).toEqual([]);
  });
});

describe('keyboard trap advice', () => {
  it('turns "Press Ctrl+M to exit" into a key to try', async () => {
    const { adviceKey } = await import('../../src/browser/keyboard.js');
    expect(adviceKey('Press Ctrl+M to Exit')).toBe('Control+M');
    expect(adviceKey('press Esc to leave the editor')).toBe('Escape');
    expect(adviceKey('Use Ctrl+Shift+F6 to move on')).toBe('Control+Shift+F6');
    expect(adviceKey('How to go the next element')).toBeNull();
  });
});

describe('fingerprint page identity', () => {
  it('does not change when a page URL carries trailing slashes', () => {
    const base = {
      ruleId: 'axe/html-has-lang',
      severity: 'serious',
      title: 't',
      evidence: [],
    } as unknown as Parameters<typeof makeFinding>[0];
    const fp = (url: string) => makeFinding({ ...base, url }).fingerprint;
    expect(fp('https://x.test/de/')).toBe(fp('https://x.test/de'));
    expect(fp('https://x.test/de//')).toBe(fp('https://x.test/de'));
    expect(fp('https://x.test/de/?a=1')).toBe(fp('https://x.test/de?a=1'));
    expect(fp('https://x.test/')).not.toBe(fp('https://x.test/de'));
    expect(fp('https://x.test/')).toBe(fp('https://x.test'));
  });
});
