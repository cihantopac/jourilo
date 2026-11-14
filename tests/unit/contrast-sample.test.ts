import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { judgeContrast, sampleNodes } from '../../src/browser/contrast-sample.js';

type RGB = [number, number, number];
const WHITE: RGB = [255, 255, 255];

/**
 * A screenshot like the ones sampled in the page: 20 px text (tile 20) as glyph stems three device pixels wide with
 * a half-blended anti-aliasing pixel on each side, over a background given per pixel.
 */
function render(width: number, height: number, bg: (x: number, y: number) => RGB, text: RGB = WHITE) {
  const px = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = bg(x, y);
      const inLine = y % 20 >= 4 && y % 20 < 16;
      const col = x % 8;
      const ink = inLine && col >= 2 && col < 5 ? 1 : inLine && (col === 1 || col === 5) ? 0.5 : 0;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++)
        px[i + c] = Math.round((text[c] as number) * ink + (b[c] as number) * (1 - ink));
      px[i + 3] = 255;
    }
  }
  return px;
}

describe('judgeContrast', () => {
  it('passes white text over a dark photo: anti-aliased edges are not taken as background', () => {
    const dark = (x: number): RGB => (x < 60 ? [15, 23, 42] : [51, 65, 85]);
    const r = judgeContrast(render(120, 40, dark), 120, 40, WHITE, 20)!;
    expect(r.worst).toBeGreaterThanOrEqual(7);
  });

  it('fails white text over a light photo', () => {
    const light = (x: number): RGB => (x < 60 ? [226, 232, 240] : [214, 211, 209]);
    const r = judgeContrast(render(120, 40, light), 120, 40, WHITE, 20)!;
    expect(r.worst).toBeLessThan(3);
  });

  it('decides on the worst case when the photo is half light and half dark (Review Focus 1)', () => {
    const half = (x: number): RGB => (x < 60 ? [226, 232, 240] : [15, 23, 42]);
    const r = judgeContrast(render(120, 40, half), 120, 40, WHITE, 20)!;
    expect(r.worst).toBeLessThan(3);
    expect(r.best).toBeGreaterThanOrEqual(7);
  });

  it('judges only the line boxes: a bright sun in the padding of a dark hero is not behind the text', () => {
    // White text over a dark photo; the right half is padding with a near-white sun and no glyphs.
    const px = render(120, 40, () => [15, 23, 42]);
    for (let y = 0; y < 40; y++)
      for (let x = 60; x < 120; x++) px.set([254, 252, 232, 255], (y * 120 + x) * 4);
    const lines = [{ x: 0, y: 0, w: 60, h: 40 }];
    expect(judgeContrast(px, 120, 40, WHITE, 20, lines)!.worst).toBeGreaterThanOrEqual(7);
    // Without line boxes the glyph-free sun would be judged as background and fail.
    expect(judgeContrast(px, 120, 40, WHITE, 20)!.worst).toBeLessThan(1.5);
  });

  it('skips tiles inside the line boxes with no pixel near the text color', () => {
    // Dark text over white; the right half of the line box is a light grey part of the image with no glyphs.
    const text: RGB = [17, 24, 39];
    const px = render(120, 40, () => [255, 255, 255], text);
    for (let y = 0; y < 40; y++)
      for (let x = 60; x < 120; x++) px.set([150, 150, 150, 255], (y * 120 + x) * 4);
    const lines = [{ x: 0, y: 0, w: 120, h: 40 }];
    expect(judgeContrast(px, 120, 40, text, 20, lines)!.worst).toBeGreaterThanOrEqual(7);
  });

  it('returns null when no pixel is near the computed text color (text under a tint)', () => {
    const px = render(120, 40, () => [15, 23, 42], [120, 120, 120]);
    expect(judgeContrast(px, 120, 40, WHITE, 20)).toBeNull();
  });
});

describe('judgeContrast on thin line pieces', () => {
  it('samples a line box narrower than 16 px and a one-pixel row instead of skipping them', () => {
    const px = render(120, 40, () => [226, 232, 240]);
    // A 10 px wide line box (under 16 px) and, separately, a 20 x 1 row: both are judged, and both fail.
    const narrow = judgeContrast(px, 120, 40, WHITE, 20, [{ x: 0, y: 0, w: 10, h: 20 }]);
    expect(narrow).not.toBeNull();
    expect(narrow!.worst).toBeLessThan(1.5);
    const row = judgeContrast(px, 120, 40, WHITE, 20, [{ x: 0, y: 8, w: 20, h: 1 }]);
    expect(row).not.toBeNull();
    // Cut into pieces by a line box that straddles a tile of a shared grid: the thin remainder joins its neighbour.
    const cut = judgeContrast(px, 120, 40, WHITE, 20, [{ x: 0, y: 0, w: 61, h: 20 }]);
    expect(cut!.worst).toBeLessThan(1.5);
  });

  it('does not fail a dark photo through a thin piece of a line box', () => {
    const px = render(120, 40, () => [15, 23, 42]);
    const r = judgeContrast(px, 120, 40, WHITE, 20, [{ x: 0, y: 0, w: 61, h: 20 }]);
    expect(r!.worst).toBeGreaterThanOrEqual(7);
  });
});

describe('sampleNodes', () => {
  const node = (target: string, messageKey = 'bgImage') => ({ target, data: { messageKey } });
  const ok = { worst: 8, best: 9, large: false };

  it('stops at the time budget and counts the nodes it left', async () => {
    let t = 0;
    const nodes = [node('#a'), node('#b'), node('#c'), node('#d')];
    const r = await sampleNodes({} as Page, nodes, {
      budgetMs: 15_000,
      now: () => t,
      sample: async () => {
        t += 6000;
        return ok;
      },
    });
    expect(r).toEqual({ sampled: 3, overBudget: 1 });
    expect(nodes.map((n) => 'contrast' in n)).toEqual([true, true, true, false]);
  });

  it('control: within budget every decidable node is sampled; other reasons are not', async () => {
    const nodes = [node('#a'), node('#b', 'fgOnBgFailure'), node('#c', 'bgGradient')];
    const r = await sampleNodes({} as Page, nodes, { sample: async () => ok });
    expect(r).toEqual({ sampled: 2, overBudget: 0 });
    expect('contrast' in nodes[1]!).toBe(false);
  });
});
