import { describe, expect, it } from 'vitest';
import { judgeContrast } from '../../src/browser/contrast-sample.js';

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
