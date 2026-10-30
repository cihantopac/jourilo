import { JouriloError } from '../core/errors.js';
import type { Viewport } from '../core/types.js';

// deviceScaleFactor stays 1 so screenshots are small and coordinates are CSS pixels; isMobile/hasTouch
// still switch Chromium into mobile layout (meta viewport, touch media queries).
export const VIEWPORTS: Record<string, Viewport> = {
  desktop: {
    name: 'desktop',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  laptop: {
    name: 'laptop',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  },
  tablet: { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  mobile: { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
  // WCAG 1.4.10 Reflow: content must work at 320 CSS px wide without two-dimensional scrolling.
  reflow: { name: 'reflow', width: 320, height: 640, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};

/** Accepts preset names or WIDTHxHEIGHT (e.g. 1024x768, treated as desktop). */
export function parseViewports(spec: string | undefined): Viewport[] {
  const names = (spec ?? 'desktop,mobile')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.map((n) => {
    const preset = VIEWPORTS[n];
    if (preset) return preset;
    const m = n.match(/^(\d{3,4})x(\d{3,4})$/);
    if (m) {
      const width = Number(m[1]);
      const mobile = width < 768;
      return {
        name: n,
        width,
        height: Number(m[2]),
        deviceScaleFactor: 1,
        isMobile: mobile,
        hasTouch: mobile,
      };
    }
    throw new JouriloError(
      'INVALID_INPUT',
      `Unknown viewport "${n}". Use ${Object.keys(VIEWPORTS).join(', ')} or WIDTHxHEIGHT.`,
    );
  });
}
