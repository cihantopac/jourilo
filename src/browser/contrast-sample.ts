// Decides text contrast that axe-core leaves for manual review because the background is an image, a gradient or an
// overlapping element (F8). The node is screenshotted as rendered, the PNG is decoded on a canvas in the page (no
// image dependency), and the text color is compared with the background pixels behind it. Any failure returns null,
// so the node stays a manual-review item.
import type { Page } from 'playwright-core';
import { asJourilo } from './own-activity.js';

export interface ContrastSample {
  /** Lowest WCAG contrast ratio between the text color and a sampled background pixel. */
  worst: number;
  /** Highest WCAG contrast ratio between the text color and a sampled background pixel. */
  best: number;
  /** Large text in WCAG terms: at least 24 px, or 18.66 px bold. */
  large: boolean;
}

/** axe-core 4.14 `color-contrast` incomplete reasons (messageKey) that pixel sampling can decide. */
export const SAMPLED_REASONS = new Set(['bgImage', 'bgGradient', 'bgOverlap']);

/** At most this many nodes are sampled per capture. */
export const CONTRAST_SAMPLE_CAP = 30;

/** Larger screenshots (device pixels) are not sampled: too slow to move into the page and decode. */
const MAX_DEVICE_PIXELS = 4_000_000;

/**
 * Judges RGBA pixels of a screenshot against the text color. Only pixels inside the text's line boxes (`lines`, in
 * image pixels; the whole image when omitted) are judged. They are cut into square tiles of about one font size, so a
 * background that is light in one place and dark in another is judged where it is light too. A tile counts only when
 * it holds pixels near the text color (text, or background as light as the text). In each such tile the
 * 20 % of pixels farthest from the text color are its background: anti-aliased glyph edges and the glyphs themselves
 * are nearer. Returns the lowest and highest contrast of the text color against those pixels, or null when no pixel
 * near the text color was found (the text is not rendered in its computed color, e.g. under a tint).
 *
 * Self-contained: it is also serialized into the page.
 */
export function judgeContrast(
  px: ArrayLike<number>,
  width: number,
  height: number,
  text: [number, number, number],
  tile: number,
  lines?: { x: number; y: number; w: number; h: number }[],
): { worst: number; best: number } | null {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const [tr, tg, tb] = text;
  const lt = lum(tr, tg, tb);
  // Squared RGB distance under which a pixel is taken as text color (glyph cores render at the computed color).
  const near = 48 * 48;
  const size = Math.max(4, Math.round(tile));
  // Only pixels inside the text's line boxes are behind the text: padding and the empty width beside centred text
  // are not, even when the image there is as light as the text.
  let mask: Uint8Array | null = null;
  if (lines) {
    mask = new Uint8Array(width * height);
    for (const l of lines) {
      const xa = Math.max(0, Math.floor(l.x));
      const ya = Math.max(0, Math.floor(l.y));
      const xb = Math.min(width, Math.ceil(l.x + l.w));
      const yb = Math.min(height, Math.ceil(l.y + l.h));
      for (let y = ya; y < yb; y++) mask.fill(1, y * width + xa, y * width + Math.max(xa, xb));
    }
  }
  let textPixels = 0;
  let worst = Number.POSITIVE_INFINITY;
  let best = 0;
  for (let y0 = 0; y0 < height; y0 += size) {
    for (let x0 = 0; x0 < width; x0 += size) {
      const x1 = Math.min(width, x0 + size);
      const y1 = Math.min(height, y0 + size);
      const at = new Int32Array((x1 - x0) * (y1 - y0));
      const dist = new Float64Array(at.length);
      let count = 0;
      let nearHere = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = y * width + x;
          if (mask && !mask[p]) continue;
          const i = p * 4;
          const dr = (px[i] as number) - tr;
          const dg = (px[i + 1] as number) - tg;
          const db = (px[i + 2] as number) - tb;
          const d = dr * dr + dg * dg + db * db;
          if (d <= near) nearHere++;
          at[count] = i;
          dist[count++] = d;
        }
      }
      if (count < 16 || !nearHere) continue;
      textPixels += nearHere;
      const cut = dist.slice(0, count).sort()[Math.floor(count * 0.8)] as number;
      for (let k = 0; k < count; k++) {
        if ((dist[k] as number) < cut) continue;
        const i = at[k] as number;
        const lb = lum(px[i] as number, px[i + 1] as number, px[i + 2] as number);
        const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
        if (ratio < worst) worst = ratio;
        if (ratio > best) best = ratio;
      }
    }
  }
  if (textPixels < 4 || !Number.isFinite(worst)) return null;
  return { worst, best };
}

interface NodeStyle {
  rgb: [number, number, number];
  fontSize: number;
  fontWeight: number;
  width: number;
  height: number;
  dpr: number;
  /** The text's line boxes in CSS px, relative to the element's border box. */
  lines: { x: number; y: number; w: number; h: number }[];
}

/** In the page: the element's text color (opaque only), font and box, or null when its text is covered. */
const readNodeStyle = (sel: string): NodeStyle | null => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = cs.color;
  g.fillRect(0, 0, 1, 1);
  const c = g.getImageData(0, 0, 1, 1).data;
  if (c[3] !== 255) return null;
  // Text covered by another element is not visible text; its pixels say nothing about its contrast.
  const box = el.getBoundingClientRect();
  const range = document.createRange();
  const lines: NodeStyle['lines'] = [];
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || (top !== el && !el.contains(top))) return null;
      // Line boxes relative to the element's border box, which is what the screenshot shows.
      lines.push({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height });
    }
  }
  if (!lines.length) return null;
  return {
    rgb: [c[0] as number, c[1] as number, c[2] as number],
    fontSize: Number.parseFloat(cs.fontSize) || 0,
    fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
    width: box.width,
    height: box.height,
    dpr: devicePixelRatio || 1,
    lines,
  };
};

/** In the page: decode the PNG and judge its pixels with the serialized `judgeContrast`. */
const decodeAndJudge = async (
  a: {
    url: string;
    rgb: [number, number, number];
    tileCss: number;
    width: number;
    lines: NodeStyle['lines'];
  },
  judge: typeof judgeContrast,
): Promise<{ worst: number; best: number } | null> => {
  // Decode from bytes rather than an <img src="data:">, which a page's img-src CSP can block.
  const bin = atob(a.url.slice(a.url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(bmp, 0, 0);
  const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
  // Tiles and line boxes are in CSS px; the screenshot is in device pixels.
  const k = bmp.width / Math.max(1, a.width);
  const lines = a.lines.map((l) => ({ x: l.x * k, y: l.y * k, w: l.w * k, h: l.h * k }));
  return judge(data, bmp.width, bmp.height, a.rgb, a.tileCss * k, lines);
};

/**
 * Samples the rendered pixels of the element at `target` (an axe target without shadow or frame hops). Returns the
 * worst and best WCAG contrast of its text color against the background pixels, or null when it cannot be measured.
 * The page's scroll position is restored afterwards.
 */
export async function sampleContrast(page: Page, target: string): Promise<ContrastSample | null> {
  if (!target || target.includes('>>>')) return null;
  const scroll = (await page.evaluate('[scrollX, scrollY]').catch(() => null)) as [number, number] | null;
  try {
    const locator = page.locator(`css=${target}`).first();
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    const style = (await page.evaluate(
      `(${String(readNodeStyle)})(${JSON.stringify(target)})`,
    )) as NodeStyle | null;
    if (!style || style.width < 1 || style.height < 1) return null;
    if (style.width * style.height * style.dpr * style.dpr > MAX_DEVICE_PIXELS) return null;
    const png = await asJourilo(page, () =>
      locator.screenshot({
        type: 'png',
        animations: 'disabled',
        caret: 'hide',
        timeout: 2000,
      }),
    );
    const arg = {
      url: `data:image/png;base64,${png.toString('base64')}`,
      rgb: style.rgb,
      tileCss: Math.max(12, style.fontSize),
      width: style.width,
      lines: style.lines,
    };
    const judged = (await page.evaluate(
      `(${String(decodeAndJudge)})(${JSON.stringify(arg)}, ${String(judgeContrast)})`,
    )) as { worst: number; best: number } | null;
    if (!judged) return null;
    const large = style.fontSize >= 24 || (style.fontSize >= 18.66 && style.fontWeight >= 700);
    return { worst: judged.worst, best: judged.best, large };
  } catch {
    return null;
  } finally {
    if (scroll)
      await page
        .evaluate(`scrollTo({ left: ${scroll[0]}, top: ${scroll[1]}, behavior: "instant" })`)
        .catch(() => undefined);
  }
}
