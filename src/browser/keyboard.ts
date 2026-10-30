// Keyboard-only walk: presses Tab through the page like a keyboard user and records what receives focus,
// whether focus is visible (WCAG 2.4.7), hidden behind sticky content (2.4.11) or trapped (2.1.2).
import type { ElementHandle, Page } from 'playwright-core';
import type { Rect } from '../core/types.js';

export interface FocusStop {
  index: number;
  selector: string;
  name: string;
  tag: string;
  rect: Rect;
  /** Style differences between focused and unfocused state; empty means no visible focus indicator. */
  indicatorChanges: string[];
  indicatorChecked: boolean;
  obscured: boolean;
  inModal: boolean;
}

export interface KeyboardWalk {
  stops: FocusStop[];
  focusableCount: number;
  completedCycle: boolean;
  trap: { selectors: string[] } | null;
  pressed: number;
}

// Plain JS evaluated in the page; returns data about the element (or null for body/document).
const FOCUS_INFO = `(el) => {
  if (!el || el === document.body || el === document.documentElement) return null;
  const sx = window.scrollX, sy = window.scrollY;
  const r = el.getBoundingClientRect();
  const sel = (e) => {
    if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) return '#' + CSS.escape(e.id);
    const parts = []; let c = e;
    while (c && c.nodeType === 1 && c !== document.documentElement && parts.length < 6) {
      let p = c.tagName.toLowerCase();
      if (c.id && document.querySelectorAll('#' + CSS.escape(c.id)).length === 1) { parts.unshift('#' + CSS.escape(c.id)); break; }
      const par = c.parentElement;
      if (par) { const same = Array.from(par.children).filter((x) => x.tagName === c.tagName); if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(c) + 1) + ')'; }
      parts.unshift(p); c = c.parentElement;
    }
    return parts.join(' > ');
  };
  // Is the element entirely hidden by other content (e.g. a sticky header)?
  const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  let visiblePts = 0, inViewport = 0, coveredByFixed = false;
  for (const [fx, fy] of pts) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    inViewport++;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) { visiblePts++; continue; }
    for (let a = hit; a && a.nodeType === 1; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') { coveredByFixed = true; break; }
    }
  }
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  return {
    selector: sel(el), name, tag: el.tagName.toLowerCase(),
    rect: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) },
    obscured: inViewport > 0 && visiblePts === 0 && coveredByFixed,
    inModal: !!el.closest('[aria-modal="true"], dialog[open]'),
  };
}`;

// Snapshot of styles that commonly carry a focus indicator, for the element and its parent (some designs
// style a wrapper with :focus-within).
const FOCUS_STYLES = `(el) => {
  if (!el || !el.isConnected) return null;
  const pick = (e) => { if (!e) return []; const cs = getComputedStyle(e); return [
    'outline:' + cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
    'box-shadow:' + cs.boxShadow, 'border:' + cs.borderTopColor + ' ' + cs.borderBottomColor + ' ' + cs.borderTopWidth + ' ' + cs.borderBottomWidth,
    'background:' + cs.backgroundColor, 'color:' + cs.color, 'text-decoration:' + cs.textDecorationLine,
    'transform:' + cs.transform,
  ]; };
  const after = getComputedStyle(el, '::after'), before = getComputedStyle(el, '::before');
  return [...pick(el), ...pick(el.parentElement).map((s) => 'parent ' + s),
    'after:' + after.content + ' ' + after.outlineStyle + ' ' + after.boxShadow + ' ' + after.borderTopStyle,
    'before:' + before.content + ' ' + before.outlineStyle + ' ' + before.boxShadow + ' ' + before.borderTopStyle];
}`;

const COUNT_FOCUSABLE = `(() => Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]')).filter((e) => !e.disabled && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden').length)()`;

/** Wraps plain-JS source `(el) => ...` as a function Playwright can serialize for ElementHandle.evaluate. */
function inPage(src: string): (el: unknown) => unknown {
  return new Function(`return (${src})(arguments[0])`) as (el: unknown) => unknown;
}

export async function keyboardWalk(page: Page, maxTabs = 60): Promise<KeyboardWalk> {
  const focusableCount = (await page.evaluate(COUNT_FOCUSABLE)) as number;
  const stops: FocusStop[] = [];
  const walk: KeyboardWalk = { stops, focusableCount, completedCycle: false, trap: null, pressed: 0 };
  if (focusableCount === 0) return walk;

  // Start from a neutral point: blur whatever has focus and put the caret at the top of the document.
  await page.evaluate(
    '(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); })()',
  );
  let prevHandle: ElementHandle | null = null;
  let prevFocused: string[] | null = null;
  const limit = Math.min(maxTabs, focusableCount + 5);
  const sequence: string[] = [];

  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    walk.pressed++;
    const handle = (await page.evaluateHandle('document.activeElement')) as ElementHandle;
    const data = (await handle.evaluate(inPage(FOCUS_INFO))) as Omit<
      FocusStop,
      'index' | 'indicatorChanges' | 'indicatorChecked'
    > | null;

    // The previous stop is now unfocused: compare its styles to what we recorded while it had focus.
    if (prevHandle && prevFocused && stops.length) {
      const unfocused = (await prevHandle.evaluate(inPage(FOCUS_STYLES)).catch(() => null)) as
        | string[]
        | null;
      const last = stops[stops.length - 1]!;
      if (unfocused) {
        last.indicatorChanges = prevFocused.filter((s, k) => s !== unfocused[k]);
        last.indicatorChecked = true;
      }
    }

    if (!data) {
      // Focus left the document (end of the tab order).
      if (stops.length) walk.completedCycle = true;
      prevHandle = null;
      prevFocused = null;
      break;
    }
    if (stops.length && data.selector === stops[0]!.selector) {
      walk.completedCycle = true;
      break;
    }
    prevFocused = (await handle.evaluate(inPage(FOCUS_STYLES)).catch(() => null)) as string[] | null;
    prevHandle = handle;
    sequence.push(data.selector);
    stops.push({ ...data, index: stops.length, indicatorChanges: [], indicatorChecked: false });
  }

  // Trap: Tab keeps cycling through a small set of elements outside a modal while the page has more.
  if (!walk.completedCycle && sequence.length >= 6) {
    const tail = sequence.slice(-6);
    const distinct = new Set(tail);
    const inModal = stops.slice(-6).some((s) => s.inModal);
    if (distinct.size <= 3 && focusableCount > distinct.size + 2 && !inModal) {
      walk.trap = { selectors: [...distinct] };
    }
  }
  return walk;
}
