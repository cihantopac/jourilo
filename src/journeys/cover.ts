// Explains a click that cannot land: what sits on top of the target, and where a click would still reach it.
import type { ElementHandle } from 'playwright-core';

export interface CoverInfo {
  covered: boolean;
  /** Short selector of the element hit at the center of the target. */
  cover: string | null;
  /** A clear point, relative to the target's box, usable as Playwright's click `position`. */
  visiblePoint: { x: number; y: number } | null;
}

// The same five points as the keyboard walk's focus check: center first, then the four inner corners.
const COVER_AT = `(el) => {
  const short = (e) => {
    if (e.id) return '#' + CSS.escape(e.id);
    const c = (e.getAttribute('class') || '').trim().split(/\\s+/)[0];
    return e.tagName.toLowerCase() + (c ? '.' + CSS.escape(c) : '');
  };
  // Hit-test in the target's own tree: from the document, a target inside a shadow root hits its shadow host.
  const root = el.getRootNode();
  const tree = typeof root.elementFromPoint === 'function' ? root : document;
  // The target itself, its content, or a shadow host whose shadow tree holds it does not cover it.
  const own = (hit) => {
    if (hit === el || el.contains(hit)) return true;
    for (let n = root; n && n.host; n = n.host.getRootNode()) if (n.host === hit) return true;
    return false;
  };
  const r = el.getBoundingClientRect();
  const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  let cover = null, visible = null, inViewport = 0, center = true;
  for (const [fx, fy] of pts) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    inViewport++;
    const hit = tree.elementFromPoint(x, y);
    if (hit && own(hit)) {
      if (!visible) visible = { x: r.width * fx, y: r.height * fy };
    } else if (fx === 0.5) {
      center = false;
      cover = hit ? short(hit) : null;
    }
  }
  return { inViewport, center, cover, visible };
}`;

export async function coverAt(handle: ElementHandle): Promise<CoverInfo> {
  await handle.scrollIntoViewIfNeeded().catch(() => undefined);
  const r = (await handle.evaluate(
    new Function(`return (${COVER_AT})(arguments[0])`) as (el: unknown) => unknown,
  )) as {
    inViewport: number;
    center: boolean;
    cover: string | null;
    visible: { x: number; y: number } | null;
  } | null;
  // Nothing in the viewport to judge: leave it to Playwright's own checks.
  if (!r || !r.inViewport || r.center) return { covered: false, cover: null, visiblePoint: null };
  return { covered: true, cover: r.cover, visiblePoint: r.visible };
}
