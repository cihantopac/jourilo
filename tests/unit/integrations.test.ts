import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../src/audit/finding.js';
import {
  deltaE,
  flattenTokens,
  loadContext,
  nearestBrandColor,
  parseCssColor,
} from '../../src/integrations/context.js';
import { respectLockedBrand } from '../../src/integrations/design-rules.js';

const site = join(import.meta.dirname, '../../fixtures/sites/brand-site');

describe('jourilo.context/v1', () => {
  it('flattens W3C design tokens', () => {
    const t = flattenTokens({
      color: { a: { $type: 'color', $value: '#ABCDEF' } },
      font: { b: { $type: 'fontFamily', $value: ['DM Sans', 'system-ui'] } },
    });
    expect(t.colors).toEqual([{ name: 'color.a', value: '#abcdef' }]);
    expect(t.fonts).toEqual(['DM Sans']);
  });
  it('reads Markilo and Searvex data when present, and nothing when absent', () => {
    const c = loadContext(site);
    expect(c.brand).toMatchObject({ source: 'markilo', name: 'Fern', locked: true, fonts: ['Georgia'] });
    expect(c.brand!.colors.map((x) => x.value)).toContain('#166534');
    expect(c.search!.findings[0]).toMatchObject({
      ruleId: 'meta/description-missing',
      url: 'http://localhost/',
    });
    const none = loadContext(join(import.meta.dirname, '../../fixtures/sites/clean-shop'));
    expect(none.brand).toBeNull();
    expect(none.search).toBeNull();
  });
  it('measures color distance in Lab space', () => {
    expect(parseCssColor('rgb(22, 101, 52)')).toEqual([22, 101, 52]);
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toBeNull();
    expect(deltaE([255, 255, 255], [255, 255, 255])).toBe(0);
    expect(deltaE([255, 0, 0], [0, 0, 255])).toBeGreaterThan(100);
    const brand = loadContext(site).brand!;
    expect(nearestBrandColor('rgb(22, 101, 52)', brand)!.deltaE).toBe(0);
  });
  it('rewrites contrast advice for locked brand colors only', () => {
    const brand = loadContext(site).brand!;
    const f = (fg: string) =>
      makeFinding({
        ruleId: 'axe/color-contrast',
        title: 't',
        category: 'accessibility',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: 'http://x/',
        description: '',
        impact: '',
        recommendation: 'Raise contrast',
        standards: [],
        evidence: [{ type: 'element', data: { fgColor: fg } }],
      });
    const locked = f('#86efac');
    const other = f('#aaaaaa');
    respectLockedBrand([locked, other], brand);
    expect(locked.recommendation).toMatch(/locked brand token/);
    expect(other.recommendation).toBe('Raise contrast');
  });
});
