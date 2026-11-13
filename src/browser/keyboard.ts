// Keyboard-only walk: presses Tab through the page like a keyboard user and records what receives focus,
// whether focus is visible (WCAG 2.4.7), hidden behind sticky content (2.4.11) or trapped (2.1.2).
import type { ElementHandle, Page } from 'playwright-core';
import type { Rect } from '../core/types.js';

export interface FocusStop {
  index: number;
  selector: string;
  name: string;
  tag: string;
  /** Opening tag with the attributes that identify the element and its state, e.g. `<button class="tool" aria-pressed="true">`. */
  markup?: string;
  rect: Rect;
  /** Style differences between focused and unfocused state; empty means no visible focus indicator. */
  indicatorChanges: string[];
  indicatorChecked: boolean;
  obscured: boolean;
  /** Selector of the content covering the element, when obscured. */
  coverSelector?: string;
  inModal: boolean;
  /**
   * The stop has no box to draw an indicator on (its rect, measured while focused, is at most 1 px wide or tall and
   * no descendant is larger, and it has no text or accessible name) or is a dev-server overlay. It is not page content and is not judged for focus-visible.
   */
  boxless?: boolean;
}

/** Dev-server overlays that take focus but are not part of the audited page. */
export const DEV_OVERLAY =
  'nextjs-portal, vite-error-overlay, astro-dev-toolbar, #webpack-dev-server-client-overlay';

export interface KeyboardWalk {
  stops: FocusStop[];
  focusableCount: number;
  completedCycle: boolean;
  /**
   * advice: text on the page that explains how to leave (WCAG 2.1.2 allows a documented non-standard key).
   * held: focus never left the selectors (and never returned to the page) through this many presses each of Tab,
   * Shift+Tab and Tab after Escape; such a trap is found wherever focus starts, even with nothing else to reach.
   */
  trap: { selectors: string[]; advice?: string; adviceWorks?: boolean; held?: number } | null;
  pressed: number;
  // The browser build has no key that moves focus to links, so links were not part of the walk.
  skipsLinks?: boolean;
}

// Plain JS: a CSS selector for an element (a unique id, or a short tag path with :nth-of-type).
const SELECTOR_OF = `(e) => {
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
  }`;

// The focused element's selector, or null when focus is on the page itself or has left the document.
const ACTIVE_SELECTOR = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  return (${SELECTOR_OF})(el);
})()`;

// Plain JS evaluated in the page; returns data about the element (or null for body/document). It runs while the
// element has focus, so the rect of an element that is off-screen until focused is its focused rect.
const FOCUS_INFO = `(el) => {
  if (!el || el === document.body || el === document.documentElement) return null;
  const sx = window.scrollX, sy = window.scrollY;
  const r = el.getBoundingClientRect();
  const sel = ${SELECTOR_OF};
  // Is the element entirely hidden by other content (a sticky header, a half-closed shutter, a panel)? Content
  // counts as a cover when it paints (background colour, image, media) and is not the element's own label or
  // ancestor; transparent click-catchers do not.
  const paints = (e) => {
    const cs = getComputedStyle(e);
    const m = /^rgba?\\(([^)]*)\\)$/.exec(cs.backgroundColor);
    let alpha = cs.backgroundColor === 'transparent' ? 0 : 1;
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean); alpha = p.length > 3 ? parseFloat(p[3]) * (p[3].endsWith('%') ? 0.01 : 1) : 1; }
    return alpha > 0.1 || cs.backgroundImage !== 'none' || /^(img|video|canvas|svg)$/i.test(e.tagName);
  };
  const labels = el.labels ? Array.from(el.labels) : [];
  const isCover = (hit) => {
    if (hit === el || el.contains(hit) || hit.contains(el) || labels.some((l) => l.contains(hit))) return false;
    for (let a = hit; a && a.nodeType === 1 && !a.contains(el); a = a.parentElement) if (paints(a)) return true;
    return false;
  };
  // A control that hides itself (opacity 0, 1px) or sits in a hidden or collapsed ancestor (opacity 0, clipped to
  // nothing) is not "obscured"; that belongs to focus-visible.
  const hiddenByAncestor = () => {
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (parseFloat(cs.opacity) < 0.1) return true;
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const ar = a.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { l = Math.max(l, ar.left); rt = Math.min(rt, ar.right); }
        if (cs.overflowY !== 'visible') { t = Math.max(t, ar.top); b = Math.min(b, ar.bottom); }
        if (rt - l <= 1 || b - t <= 1) return true;
      }
    }
    return false;
  };
  const selfHidden = parseFloat(getComputedStyle(el).opacity) < 0.1 || r.width <= 1 || r.height <= 1 || hiddenByAncestor();
  const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];
  let visiblePts = 0, inViewport = 0, cover = null;
  for (const [fx, fy] of pts) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    inViewport++;
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit === el || el.contains(hit) || hit.contains(el)) { visiblePts++; continue; }
    if (isCover(hit)) cover = cover || hit;
  }
  const noBox = (e) => { const b = e.getBoundingClientRect(); return b.width <= 1 || b.height <= 1; };
  const rootHost = el.getRootNode && el.getRootNode().host;
  // A stop with text or an accessible name is content a person can reach, so a hidden one is a real focus-visible
  // failure (a clipped skip link that stays 1 x 1 while focused), not a stop without a box.
  const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
    .map((id) => { const n = document.getElementById(id); return n ? (n.textContent || '') : ''; }).join('').trim();
  const hasName = !!((el.textContent || '').trim() || (el.getAttribute('aria-label') || '').trim() || labelledBy ||
    (el.getAttribute('title') || '').trim() || (el.getAttribute('alt') || '').trim());
  const boxless = !!(el.matches(${JSON.stringify(DEV_OVERLAY)}) || (rootHost && rootHost.matches(${JSON.stringify(DEV_OVERLAY)})) ||
    (noBox(el) && !hasName && !Array.from(el.querySelectorAll('*')).some((d) => !noBox(d)) &&
      !(el.shadowRoot && Array.from(el.shadowRoot.querySelectorAll('*')).some((d) => !noBox(d)))));
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
  // The element's identity as markup (like an axe node's html), so a state rule (.tool[aria-pressed]) can be found.
  const attrs = ['id', 'class', 'role', 'aria-pressed', 'aria-expanded', 'aria-selected', 'aria-checked', 'aria-current', 'data-state']
    .filter((a) => el.hasAttribute(a))
    .map((a) => ' ' + a + '="' + el.getAttribute(a).replace(/\\s+/g, ' ').trim().slice(0, 80).replace(/"/g, '&quot;') + '"');
  const markup = '<' + el.tagName.toLowerCase() + attrs.join('') + '>';
  return {
    selector: sel(el), name, tag: el.tagName.toLowerCase(), markup: markup.length > 200 ? markup.slice(0, 198) + '…>' : markup,
    rect: { x: Math.round(r.left + sx), y: Math.round(r.top + sy), width: Math.round(r.width), height: Math.round(r.height) },
    obscured: !selfHidden && inViewport > 0 && visiblePts === 0 && !!cover,
    coverSelector: cover ? sel(cover) : undefined,
    inModal: !!el.closest('[aria-modal="true"], dialog[open], [role="dialog"], [role="alertdialog"]'),
    boxless,
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

// Is this element the last tabbable element of the document (nothing focusable follows it)?
const IS_LAST_TABBABLE = `(el) => {
  const all = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'))
    .filter((e) => !e.disabled && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
  return all.length > 0 && all[all.length - 1] === el;
}`;

// Where focus is after a key press from the top: on the document's first link or button, somewhere else, or nowhere
// (some builds focus the page itself on the first press).
const FIRST_STOP_STATE = `(() => {
  const first = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'))
    .find((e) => !e.disabled && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !(e.tabIndex > 0));
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return 'none';
  if (!first || !/^(A|BUTTON)$/.test(first.tagName)) return 'n/a';
  return active === first ? 'first' : 'other';
})()`;

// Focuses the first focusable element after the trapped ones (in document order, outside their container).
const ESCAPE_TRAP = `(sels) => {
  const trapped = sels.map((s) => document.querySelector(s)).filter(Boolean);
  if (!trapped.length) return false;
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const last = trapped.reduce((acc, el) => (after(acc, el) ? el : acc));
  let box = last.parentElement;
  while (box && box !== document.body && !trapped.every((t) => box.contains(t))) box = box.parentElement;
  const all = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
    .filter((e) => !e.disabled && e.getClientRects().length > 0);
  const next = all.find((e) => after(last, e) && !(box && box !== document.body && box.contains(e)));
  if (!next) return false;
  next.focus();
  return true;
}`;

// Instructions for leaving a trap: "Press Ctrl+M to exit" in the page text, or a help control among the trapped
// elements ("How to move on", "Help", "Exit").
const TRAP_ADVICE = `(selectors) => {
  const text = document.body.innerText || '';
  const m = text.match(/(press|use|hit)\\s+(ctrl|control|alt|option|shift|cmd|command|esc|escape|f\\d+)[^.\\n]{0,24}?\\s+to\\s+(exit|leave|escape|close|quit|move on|continue)[^.\\n]{0,40}/i);
  if (m) return m[0].trim();
  for (const s of selectors) {
    const el = document.querySelector(s);
    const name = el ? (el.getAttribute('aria-label') || el.textContent || '').trim() : '';
    if (/\\b(how to|help|exit|leave|skip out)\\b/i.test(name)) return name.slice(0, 80);
  }
  return null;
}`;

// Held focus (F23) is judged over this many presses per direction, for a set of at most HELD_MAX elements.
const HELD_PRESSES = 12;
const HELD_MAX = 10;

/** Lets focus handlers run after a key press: a trap often pulls focus back from onblur with a short timeout. */
async function settleFocus(page: Page): Promise<void> {
  await page
    .evaluate(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 20))))',
    )
    .catch(() => undefined);
}

/**
 * Is focus held among `selectors` wherever it starts (F23)? From the first of them, HELD_PRESSES presses of Tab, then
 * of Shift+Tab, then of Tab after Escape must never take focus to the page itself or out of the document, and only the
 * Tab round may add elements (up to HELD_MAX). A dialog that keeps focus inside (aria-modal, an open <dialog>, or
 * role="dialog" / "alertdialog", which cookie walls often use without aria-modal) is not a trap. Returns the held
 * set, or null when focus got out.
 */
async function heldFocus(page: Page, tabKey: string, selectors: string[]): Promise<string[] | null> {
  const set = new Set(selectors);
  const start = async () => {
    await page
      .evaluate(
        `((s) => { const el = document.querySelector(s); if (el) el.focus(); })(${JSON.stringify(selectors[0])})`,
      )
      .catch(() => undefined);
    await settleFocus(page);
  };
  const stays = async (key: string, grow: boolean): Promise<boolean> => {
    for (let i = 0; i < HELD_PRESSES; i++) {
      await page.keyboard.press(key);
      await settleFocus(page);
      const sel = (await page.evaluate(ACTIVE_SELECTOR).catch(() => null)) as string | null;
      if (!sel || (!grow && !set.has(sel))) return false;
      set.add(sel);
      if (set.size > HELD_MAX) return false;
    }
    return true;
  };
  await start();
  if (!(await stays(tabKey, true))) return null;
  await start();
  if (!(await stays(`Shift+${tabKey}`, false))) return null;
  await start();
  await page.keyboard.press('Escape');
  await settleFocus(page);
  if (!(await stays(tabKey, false))) return null;
  const inModal = (await page
    .evaluate(
      `((sels) => sels.some((s) => { const el = document.querySelector(s); return !!el && !!el.closest('[aria-modal="true"], dialog[open], [role="dialog"], [role="alertdialog"]'); }))(${JSON.stringify([...set])})`,
    )
    .catch(() => true)) as boolean;
  return inModal ? null : [...set];
}

/**
 * The area around a focus stop in page coordinates. Comparing it focused and with nothing focused shows indicators
 * that other elements draw (a sibling that lights up, a moving underline), which a style comparison of the element
 * and its parent cannot see.
 */
async function shotAround(page: Page, r: Rect): Promise<Buffer | null> {
  const pad = 24;
  const clip = {
    x: Math.max(0, r.x - pad),
    y: Math.max(0, r.y - pad),
    width: r.width + pad * 2,
    height: r.height + pad * 2,
  };
  if (r.width < 1 || r.height < 1 || clip.width * clip.height > 640 * 480) return null;
  return page
    .screenshot({ clip, fullPage: true, animations: 'disabled', caret: 'hide', type: 'png' })
    .catch(() => null);
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
  let prevShot: Buffer | null = null;
  const limit = Math.min(maxTabs, focusableCount + 12);
  const sequence: string[] = [];
  const newStop = (d: Omit<FocusStop, 'index' | 'indicatorChanges' | 'indicatorChecked'>): FocusStop => ({
    ...d,
    index: stops.length,
    indicatorChanges: [],
    indicatorChecked: false,
  });

  // WebKit on macOS follows Safari's default, where Tab skips links and buttons and Option+Tab visits every
  // focusable element (what a keyboard-only user enables). Other WebKit builds behave differently, so observe which
  // key reaches the document's first link or button from the top and walk with that one.
  let tabKey = 'Tab';
  if (page.context().browser()?.browserType().name() === 'webkit') {
    const reset =
      '(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); })()';
    const probes: string[] = [];
    for (const key of ['Tab', 'Alt+Tab']) {
      let state = 'none';
      for (let k = 0; k < 2 && state === 'none'; k++) {
        await page.keyboard.press(key);
        state = (await page.evaluate(FIRST_STOP_STATE).catch(() => 'n/a')) as string;
      }
      await page.evaluate(reset);
      probes.push(`${key}=${state}`);
      if (state === 'first' || state === 'n/a') {
        tabKey = key;
        break;
      }
    }
    if (probes.every((p) => p.endsWith('=other'))) walk.skipsLinks = true;
    if (process.env.JOURILO_DEBUG?.includes('keyboard'))
      process.stderr.write(`[keyboard] webkit key probe ${probes.join(' ')} -> ${tabKey}\n`);
  }
  // Firefox keeps activeElement on the last tab stop while focus goes to its own UI, so a single element that keeps
  // focus there cannot be told from the end of the tab order; Chromium and WebKit move focus to the page itself.
  const endsOnPage = page.context().browser()?.browserType().name() !== 'firefox';
  let escaped = false;
  let i = 0;
  for (; i < limit; i++) {
    await page.keyboard.press(tabKey);
    walk.pressed++;
    await settleFocus(page);
    const handle = (await page.evaluateHandle('document.activeElement')) as ElementHandle;
    const data = (await handle.evaluate(inPage(FOCUS_INFO))) as Omit<
      FocusStop,
      'index' | 'indicatorChanges' | 'indicatorChecked'
    > | null;

    // Tab did not move focus. On the last tab stop this is the end of the order (Firefox keeps activeElement on it
    // while focus goes to the browser UI); elsewhere a single element is holding focus.
    const prevSelector = sequence[sequence.length - 1];
    const noMove = !!data && prevSelector === data.selector;
    let isLast = false;
    if (noMove) {
      isLast = (await handle.evaluate(inPage(IS_LAST_TABBABLE)).catch(() => false)) as boolean;
      if (isLast) {
        await handle.evaluate(inPage('(el) => el.blur()')).catch(() => undefined);
      } else if (!walk.trap && !data!.inModal) {
        walk.trap = { selectors: [data!.selector] };
      }
    }

    // The new stop's focused state is recorded first: the comparison below may blur it for a moment.
    const isNewStop = !!data && !noMove && !stops.some((s) => s.selector === data.selector);
    const curFocused = isNewStop
      ? ((await handle.evaluate(inPage(FOCUS_STYLES)).catch(() => null)) as string[] | null)
      : null;
    const curShot = isNewStop ? await shotAround(page, data!.rect) : null;

    // The previous stop is now unfocused: compare its styles to what we recorded while it had focus.
    if (prevHandle && prevFocused && stops.length) {
      const unfocused = (await prevHandle.evaluate(inPage(FOCUS_STYLES)).catch(() => null)) as
        | string[]
        | null;
      const last = stops[stops.length - 1]!;
      if (unfocused) {
        last.indicatorChanges = prevFocused.filter((s, k) => s !== unfocused[k]);
        last.indicatorChecked = true;
        // No style change on the element or its parent: look at the pixels around it with nothing focused.
        if (!last.indicatorChanges.length && prevShot) {
          await handle.evaluate(inPage('(el) => el.blur && el.blur()')).catch(() => undefined);
          const neutral = await shotAround(page, last.rect);
          await handle.evaluate(inPage('(el) => el.focus && el.focus()')).catch(() => undefined);
          if (neutral && !neutral.equals(prevShot))
            last.indicatorChanges = [
              'the area around the element changes on focus (indicator drawn by another element)',
            ];
        }
        if (process.env.JOURILO_DEBUG?.includes('keyboard'))
          process.stderr.write(
            `[keyboard]   ${last.selector} changes=${JSON.stringify(last.indicatorChanges)}\n`,
          );
      }
    }
    if (noMove) {
      if (isLast && endsOnPage && !walk.trap && !data!.inModal) {
        const held = await heldFocus(page, tabKey, [data!.selector]);
        if (held) walk.trap = { selectors: held, held: HELD_PRESSES };
      }
      if (!walk.trap || walk.trap.selectors[0] !== data!.selector) walk.completedCycle = true;
      break;
    }
    prevFocused = null;
    prevShot = null;

    if (!data) {
      // Focus left the document (end of the tab order).
      if (stops.length) walk.completedCycle = true;
      break;
    }
    if (stops.length && data.selector === stops[0]!.selector) {
      // Back at the first stop and focus never left the document on the way: held focus, when it stays held.
      const held =
        !walk.trap && stops.length <= HELD_MAX ? await heldFocus(page, tabKey, [...new Set(sequence)]) : null;
      if (held) walk.trap = { selectors: held, held: HELD_PRESSES };
      else walk.completedCycle = true;
      break;
    }
    sequence.push(data.selector);
    // JOURILO_DEBUG=keyboard prints every stop, to diagnose browser differences.
    if (process.env.JOURILO_DEBUG?.includes('keyboard'))
      process.stderr.write(
        `[keyboard] ${i} ${data.selector} name=${JSON.stringify(data.name)} modal=${data.inModal}\n`,
      );

    // Trap: Tab keeps cycling through a small set of elements outside a modal while the page has more.
    if (!walk.trap && sequence.length >= 6) {
      // The trap is the set of elements that keep coming back, not everything seen recently.
      const tail = sequence.slice(-6);
      const counts = new Map<string, number>();
      for (const s of tail) counts.set(s, (counts.get(s) ?? 0) + 1);
      const distinct = new Set([...counts].filter(([, n]) => n >= 2).map(([s]) => s));
      const cycling = distinct.size > 0 && tail.slice(-4).every((s) => distinct.has(s));
      // Focusable elements that Tab never reached while focus kept cycling are what the trap keeps out of reach.
      const unreached = focusableCount - new Set(sequence).size;
      if (cycling && distinct.size <= 3 && unreached > 0 && !data.inModal) {
        walk.trap = { selectors: [...distinct] };
        // Record the trap, then step past it once so the rest of the page is still checked.
        if (
          !escaped &&
          (await page.evaluate(`(${ESCAPE_TRAP})(${JSON.stringify([...distinct])})`).catch(() => false))
        ) {
          escaped = true;
          const next = (await page.evaluateHandle('document.activeElement')) as ElementHandle;
          const info = (await next.evaluate(inPage(FOCUS_INFO))) as typeof data;
          if (info && !stops.some((s) => s.selector === info.selector)) {
            prevFocused = (await next.evaluate(inPage(FOCUS_STYLES)).catch(() => null)) as string[] | null;
            prevHandle = next;
            stops.push(newStop(info));
          }
          continue;
        }
        break;
      }
    }
    // Revisits (inside a trap) are not new stops.
    if (stops.some((s) => s.selector === data.selector)) {
      prevHandle = null;
      continue;
    }
    prevFocused = curFocused;
    prevShot = curShot;
    prevHandle = handle;
    stops.push(newStop(data));
  }
  // Every press used and focus never left the document: if the last presses kept to a few elements, they may hold it
  // even though every focusable element was reached once on the way in.
  if (i >= limit && !walk.trap) {
    const tail = [...new Set(sequence.slice(-HELD_PRESSES))];
    const held = tail.length && tail.length <= HELD_MAX ? await heldFocus(page, tabKey, tail) : null;
    if (held) walk.trap = { selectors: held, held: HELD_PRESSES };
  }
  if (walk.trap) {
    const advice = (await page
      .evaluate(`(${TRAP_ADVICE})(${JSON.stringify(walk.trap.selectors)})`)
      .catch(() => null)) as string | null;
    if (advice) {
      walk.trap.advice = advice;
      // Try the advertised key: does it actually let focus out of the trapped elements?
      const key = adviceKey(advice);
      if (key) {
        const trapped = walk.trap.selectors;
        await page
          .locator(trapped[0]!)
          .first()
          .focus({ timeout: 2000 })
          .catch(() => undefined);
        await page.keyboard.press(key).catch(() => undefined);
        await page
          .evaluate('new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)))')
          .catch(() => undefined);
        const out = (await page
          .evaluate(
            `((sel) => { const a = document.activeElement; return !!a && a !== document.body && !sel.some((s) => a.matches(s)); })(${JSON.stringify(trapped)})`,
          )
          .catch(() => false)) as boolean;
        walk.trap.adviceWorks = out;
      }
    }
  }
  return walk;
}

/** Playwright key for "Press Ctrl+M to exit"-style advice, or null when the advice is not a key. */
export function adviceKey(advice: string): string | null {
  const m = advice.match(/\b(?:press|use|hit)\s+([a-z0-9]+(?:\s*[+-]\s*[a-z0-9]+)*)/i);
  if (!m) return null;
  const NAMES: Record<string, string> = {
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
    option: 'Alt',
    shift: 'Shift',
    cmd: 'Meta',
    command: 'Meta',
    esc: 'Escape',
    escape: 'Escape',
    tab: 'Tab',
    enter: 'Enter',
  };
  const parts = m[1]!
    .split(/\s*[+-]\s*/)
    .map(
      (k) =>
        NAMES[k.toLowerCase()] ??
        (/^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k.length === 1 ? k.toUpperCase() : null),
    );
  if (
    parts.some((p) => !p) ||
    !parts.some((p) => (p !== 'Shift' && !/^(Control|Alt|Meta)$/.test(p!)) || parts.length === 1)
  )
    return null;
  return parts.join('+');
}
