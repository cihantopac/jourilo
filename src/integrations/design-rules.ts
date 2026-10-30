// Design-system consistency checks against brand context (jourilo.context/v1). They only run when brand data
// exists, and they are heuristics: a color outside the palette may be intentional.

import { makeFinding } from '../audit/finding.js';
import type { PageObservation } from '../browser/capture.js';
import type { Finding } from '../core/types.js';
import { type BrandContext, nearestBrandColor } from './context.js';

/** ΔE above which a color is clearly not a palette color (CIE76; ~2.3 is just noticeable). */
const OFF_PALETTE = 10;

export function designFindings(obs: PageObservation, brand: BrandContext): Finding[] {
  const st = obs.probe?.styles;
  if (!st || !brand.colors.length) return [];
  const out: Finding[] = [];
  const shot = obs.screenshot ? { file: obs.screenshot } : {};
  const off = st.ctas
    .map((c) => ({ c, near: nearestBrandColor(c.background, brand) }))
    .filter((x) => x.near && x.near.deltaE > OFF_PALETTE);
  if (off.length) {
    out.push(
      makeFinding({
        ruleId: 'design/off-brand-cta-color',
        title: 'Primary buttons use colors outside the brand palette',
        category: 'design-system',
        kind: 'defect',
        severity: 'minor',
        confidence: 'medium',
        provenance: 'measured',
        url: obs.url,
        viewport: obs.viewport.name,
        description: `${off.length} primary call(s) to action use a background color that is far from every ${brand.source} palette color (ΔE > ${OFF_PALETTE}).`,
        impact: 'Inconsistent action colors weaken recognition of what is clickable and dilute the brand.',
        recommendation: `Use the brand token closest to the intended role (nearest: ${off
          .slice(0, 3)
          .map((o) => `${o.near!.name} ${o.near!.value}`)
          .join(
            ', ',
          )}).${brand.locked ? ' The brand is locked: change the component, not the brand palette.' : ''}`,
        standards: [{ standard: `${brand.source} brand tokens`, id: brand.file, title: brand.name }],
        evidence: off.map((o) => ({
          type: 'element' as const,
          selector: o.c.selector,
          rect: o.c.rect,
          snippet: o.c.text,
          data: {
            background: o.c.background,
            nearest: o.near!.value,
            token: o.near!.name,
            deltaE: o.near!.deltaE,
          },
          ...shot,
        })),
        occurrences: off.length,
      }),
    );
  }
  if (brand.fonts.length) {
    const allowed = brand.fonts.map((f) => f.toLowerCase());
    const used = [st.body.font, ...st.headings.map((h) => h.font)].filter(Boolean);
    const foreign = [...new Set(used.filter((f) => !allowed.includes(f.toLowerCase())))];
    if (foreign.length) {
      out.push(
        makeFinding({
          ruleId: 'design/off-brand-font',
          title: 'Text uses fonts that are not in the brand typography',
          category: 'design-system',
          kind: 'defect',
          severity: 'minor',
          confidence: 'medium',
          provenance: 'measured',
          url: obs.url,
          viewport: obs.viewport.name,
          description: `Computed font families ${foreign.map((f) => `"${f}"`).join(', ')} are not among the brand fonts (${brand.fonts.join(', ')}). The brand font may have failed to load.`,
          impact:
            'The product looks inconsistent with the brand; a failed web-font load can also shift layout.',
          recommendation: `Load and apply ${brand.fonts[0]} through the shared typography tokens; check the font request in the network panel.`,
          standards: [{ standard: `${brand.source} brand tokens`, id: brand.file, title: brand.name }],
          evidence: [
            {
              type: 'dom',
              snippet: `body: ${st.body.font}; headings: ${st.headings.map((h) => h.font).join(', ')}`,
            },
          ],
        }),
      );
    }
  }
  return out;
}

/** When the brand is locked, contrast fixes must not recolor brand tokens. */
export function respectLockedBrand(findings: Finding[], brand: BrandContext | null): void {
  if (!brand?.locked) return;
  for (const f of findings) {
    if (f.ruleId !== 'axe/color-contrast') continue;
    const fg = f.evidence.find((e) => typeof e.data?.fgColor === 'string')?.data?.fgColor as
      | string
      | undefined;
    const near = fg ? nearestBrandColor(fg, brand) : null;
    if (near && near.deltaE < 2.3) {
      f.recommendation = `The text color ${fg} is the locked brand token ${near.name}. Do not change it: raise contrast by changing the background, using a darker/lighter step the brand already defines for text, or increasing size/weight to qualify as large text. Consult the brand owner before any palette change.`;
    }
  }
}
