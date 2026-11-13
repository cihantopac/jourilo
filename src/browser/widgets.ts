// Composite widget checks, operated with the keyboard like a keyboard user would:
//  - dialogs: focus moves into the dialog when it opens (WCAG 2.4.3), Escape closes it, focus returns to the trigger;
//  - disclosures/menus: aria-expanded reflects whether the controlled content is shown (WCAG 4.1.2).
// Only triggers that declare a popup or expanded state are operated (aria-haspopup / aria-expanded), and never one
// whose name looks destructive or financial. Nothing is submitted.
import type { Page } from 'playwright-core';
import type { Rect } from '../core/types.js';
import { DESTRUCTIVE, FINANCIAL } from '../journeys/safety.js';

export interface WidgetIssue {
  kind:
    | 'dialog-focus-not-moved'
    | 'dialog-escape'
    | 'dialog-focus-not-returned'
    | 'dialog-focus-escapes'
    | 'dialog-no-role'
    | 'expanded-state-mismatch'
    | 'composite-unreachable'
    | 'menu-arrows'
    | 'menu-home-end'
    | 'menu-escape'
    | 'menu-focus-not-returned';
  trigger: string;
  name: string;
  rect: Rect;
  detail: string;
  /** How to reproduce, when it is not "focus the trigger and press Enter". */
  steps?: string[];
}

export interface WidgetCheck {
  triggers: number;
  dialogs: number;
  disclosures: number;
  /** Composite widgets (tabs, radio groups, listboxes, menubars, trees) whose arrow keys were tested. */
  composites: number;
  issues: WidgetIssue[];
}

// Generic triggers are operated too, but never ones that change data or carts.
const AVOID =
  /(?<![\p{L}])(add to (cart|basket|bag)|sepete ekle|in den warenkorb|añadir al carrito|ajouter au panier|like|beğen|follow|takip et|vote|oy ver|log ?out|sign ?out|çıkış yap|abmelden|cerrar sesión|déconnexion)(?![\p{L}])/iu;

const TRIGGERS = `(() => {
  const sel = (e) => {
    if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) return '#' + CSS.escape(e.id);
    const parts = []; let c = e;
    while (c && c.nodeType === 1 && c !== document.documentElement && parts.length < 6) {
      let p = c.tagName.toLowerCase();
      const par = c.parentElement;
      if (par) { const same = Array.from(par.children).filter((x) => x.tagName === c.tagName); if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(c) + 1) + ')'; }
      parts.unshift(p); c = c.parentElement;
    }
    return parts.join(' > ');
  };
  return Array.from(document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [aria-controls], a[href="#"], a[href^="#"]:not([href="#main"]):not([href^="#content"]), a[href^="javascript:"]'))
    .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && /^(BUTTON|A|SUMMARY)$|^button$/i.test(e.tagName === 'DIV' || e.tagName === 'SPAN' ? (e.getAttribute('role') || '') : e.tagName))
    // A link to a section that is already on screen is in-page navigation (skip links, table of contents), not a
    // popup trigger; following it only scrolls.
    .filter((e) => {
      const href = e.tagName === 'A' ? e.getAttribute('href') || '' : '';
      if (!/^#./.test(href) || e.hasAttribute('aria-haspopup') || e.hasAttribute('aria-expanded') || e.hasAttribute('aria-controls')) return true;
      let id = href.slice(1);
      try { id = decodeURIComponent(id); } catch {}
      const target = document.getElementById(id) || document.getElementsByName(id)[0];
      return !(target && target.getClientRects().length > 0 && getComputedStyle(target).visibility !== 'hidden');
    })
    .slice(0, 8)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        selector: sel(e),
        name: (e.getAttribute('aria-label') || e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        popup: e.getAttribute('aria-haspopup'),
        inPageLink: e.tagName === 'A' && !e.hasAttribute('aria-haspopup') && !e.hasAttribute('aria-expanded'),
        expanded: e.getAttribute('aria-expanded'),
        controls: e.getAttribute('aria-controls'),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      };
    });
})()`;

// Records which positioned layers are visible before activation, so a layer that appears afterwards (a lightbox
// built without ARIA) can be recognised. Stored on window only; the DOM is not modified.
const SNAPSHOT_LAYERS = `(() => {
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight * 0.02; };
  const layers = Array.from(document.querySelectorAll('body *')).filter((e) => {
    const cs = getComputedStyle(e);
    return (cs.position === 'fixed' || cs.position === 'absolute') && e.getClientRects().length > 0 && cs.visibility !== 'hidden' && big(e);
  });
  // Signatures, not node identity: frameworks that re-render replace nodes without anything new appearing.
  // Page coordinates for absolutely positioned layers, so scrolling does not make an existing layer look new.
  const sig = (e) => { const r = e.getBoundingClientRect(); const fixed = getComputedStyle(e).position === 'fixed'; return e.tagName + '.' + String(e.className) + '|' + Math.round(r.left + (fixed ? 0 : scrollX)) + ',' + Math.round(r.top + (fixed ? 0 : scrollY)) + ',' + Math.round(r.width) + ',' + Math.round(r.height); };
  window.__jouriloLayers = new Set(layers.map(sig));
})()`;

// mode "open": find a dialog that opened (a real one, else a new overlay layer); "same": is the dialog found by the
// last "open" call still shown? Checking only that element keeps other layers (toasts, launchers) from looking open.
const STATE = `(controls, mode) => {
  const visible = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  if (mode === 'same') {
    const d = window.__jouriloDialog;
    const ae = document.activeElement;
    let deep = ae;
    while (deep && deep.shadowRoot && deep.shadowRoot.activeElement) deep = deep.shadowRoot.activeElement;
    // A focus guard (Base UI, Radix, React Aria, Headless UI) is an empty sentinel; focus parked there is not an escape.
    const onSentinel = !!deep && deep !== document.body && !(deep.textContent || '').trim() && (deep.getAttribute('aria-hidden') === 'true' || deep.getAttributeNames().some((n) => /focus-?guard|focus-?trap|data-.*sentinel/i.test(n)));
    return { dialogOpen: visible(d) && (d.tagName !== 'DIALOG' || d.open), unlabelled: false, focusInDialog: !!d && !!ae && d.contains(ae), onSentinel, focusables: 0, controlledVisible: null, activeSelector: ae && ae !== document.body ? (ae.id ? '#' + ae.id : ae.tagName.toLowerCase()) : null };
  }
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  let d = dialogs[dialogs.length - 1] || null;
  let unlabelled = false;
  if (!d && window.__jouriloLayers) {
    const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight * 0.02; };
    const fresh = Array.from(document.querySelectorAll('body *')).filter((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const fixed = cs.position === 'fixed';
      const sig = e.tagName + '.' + String(e.className) + '|' + Math.round(r.left + (fixed ? 0 : scrollX)) + ',' + Math.round(r.top + (fixed ? 0 : scrollY)) + ',' + Math.round(r.width) + ',' + Math.round(r.height);
      return (cs.position === 'fixed' || cs.position === 'absolute') && visible(e) && big(e) && !window.__jouriloLayers.has(sig);
    });
    const outer = fresh.filter((e) => !fresh.some((o) => o !== e && o.contains(e)));
    if (outer.length) { d = outer[outer.length - 1]; unlabelled = true; }
  }
  window.__jouriloDialog = d;
  const ae = document.activeElement;
  const controlled = controls ? controls.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean) : [];
  const focusables = d ? Array.from(d.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')).filter(visible).length : 0;
  return {
    dialogOpen: !!d,
    unlabelled,
    focusInDialog: !!d && !!ae && d.contains(ae),
    focusables,
    controlledVisible: controlled.length ? controlled.some(visible) : null,
    activeSelector: ae && ae !== document.body ? (ae.id ? '#' + ae.id : ae.tagName.toLowerCase()) : null,
  };
}`;

// Resolves once the deep active element (through shadow roots) is unchanged on four consecutive animation frames
// (about 64 ms; two frames raced a 30 ms guard timer), or after 250 ms (a setTimeout cap too, since requestAnimationFrame is paused in a background tab). Dialog libraries park focus on a guard and wrap it a tick later.
export const WAIT_FOCUS_STABLE = `new Promise((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(true); } };
  setTimeout(finish, 250);
  const deepActive = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const start = performance.now();
  let last = deepActive();
  let same = 0;
  const tick = () => {
    const now = deepActive();
    same = now === last ? same + 1 : 0;
    last = now;
    if (done) return;
    if (same >= 4 || performance.now() - start >= 250) finish();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})`;

type State = {
  dialogOpen: boolean;
  unlabelled: boolean;
  focusInDialog: boolean;
  /** Focus sits on an empty focus-guard sentinel (only reported by the "same" mode). */
  onSentinel?: boolean;
  focusables: number;
  controlledVisible: boolean | null;
  activeSelector: string | null;
};

// Composite widgets that keep only one item in the Tab order (roving tabindex, or focus on the container with
// aria-activedescendant). Their other items are reachable only with arrow keys, so if arrows do nothing, those items
// cannot be reached with a keyboard at all (WCAG 2.1.1). Composites whose items are all tabbable are not tested:
// Tab already reaches every item.
const COMPOSITES = `(() => {
  const ITEM = { tablist: 'tab', radiogroup: 'radio', listbox: 'option', menubar: 'menuitem, [role="menuitemcheckbox"], [role="menuitemradio"]', tree: 'treeitem' };
  const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const tabbable = (e) => e.tabIndex >= 0 && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && visible(e);
  const out = [];
  for (const [role, item] of Object.entries(ITEM)) {
    for (const c of document.querySelectorAll('[role="' + role + '"]')) {
      if (!visible(c) || out.length >= 6) continue;
      const items = Array.from(c.querySelectorAll(item.split(',').map((s) => s.trim().startsWith('[') ? s : '[role="' + s.trim() + '"]').join(','))).filter(visible);
      if (items.length < 2) continue;
      const stops = items.filter(tabbable);
      const containerStop = tabbable(c) && c.hasAttribute('aria-activedescendant');
      if (stops.length > 1 || (!stops.length && !containerStop)) continue;
      const id = 'jourilo-composite-' + out.length;
      c.setAttribute('data-jourilo-composite', id);
      if (stops[0]) stops[0].setAttribute('data-jourilo-composite-stop', id);
      const r = c.getBoundingClientRect();
      const orientation = c.getAttribute('aria-orientation') || (role === 'listbox' || role === 'tree' ? 'vertical' : 'horizontal');
      out.push({ id, role, orientation, items: items.length, name: (c.getAttribute('aria-label') || items.map((i) => i.innerText.trim()).filter(Boolean).slice(0, 3).join(' / ')).replace(/\\s+/g, ' ').slice(0, 80), rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) } });
    }
  }
  return out;
})()`;

const COMPOSITE_STATE = `(id) => {
  const c = document.querySelector('[data-jourilo-composite="' + id + '"]');
  if (!c) return null;
  const ae = document.activeElement;
  const marks = Array.from(c.querySelectorAll('[aria-selected], [aria-checked]')).map((e) => (e.getAttribute('aria-selected') || '') + (e.getAttribute('aria-checked') || '')).join('');
  return { focusIn: !!ae && c.contains(ae), active: ae ? (ae.id || ae.textContent || '').trim().slice(0, 40) + '#' + Array.from(c.querySelectorAll('*')).indexOf(ae) : '', descendant: c.getAttribute('aria-activedescendant') || '', marks };
}`;

async function checkComposites(page: Page, out: WidgetCheck): Promise<void> {
  const found = (await page.evaluate(COMPOSITES).catch(() => [])) as {
    id: string;
    role: string;
    orientation: string;
    items: number;
    name: string;
    rect: Rect;
  }[];
  for (const c of found) {
    const stop = page.locator(`[data-jourilo-composite-stop="${c.id}"]`);
    const target = (await stop.count()) ? stop.first() : page.locator(`[data-jourilo-composite="${c.id}"]`);
    const read = () =>
      page.evaluate(`(${COMPOSITE_STATE})(${JSON.stringify(c.id)})`) as Promise<{
        focusIn: boolean;
        active: string;
        descendant: string;
        marks: string;
      } | null>;
    try {
      await target.focus({ timeout: 2000 });
    } catch {
      continue;
    }
    const before = await read();
    if (!before?.focusIn) continue;
    out.composites++;
    const keys = c.orientation === 'vertical' ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight', 'ArrowDown'];
    let moved = false;
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      const after = await read();
      if (
        after &&
        (after.active !== before.active ||
          after.descendant !== before.descendant ||
          after.marks !== before.marks)
      ) {
        moved = true;
        break;
      }
    }
    if (!moved)
      out.issues.push({
        kind: 'composite-unreachable',
        trigger: `[role="${c.role}"]`,
        name: c.name || c.role,
        rect: c.rect,
        detail: `Only one of the ${c.items} items of this ${c.role} is in the Tab order, and the arrow keys do not move to the others, so ${c.items - 1} item(s) cannot be reached with a keyboard.`,
        steps: [
          `Press Tab until the ${c.role} "${c.name || c.role}" has focus.`,
          `Press ${keys.join(' and ')}: focus and selection stay where they are.`,
        ],
      });
  }
  await page
    .evaluate(
      `document.querySelectorAll('[data-jourilo-composite],[data-jourilo-composite-stop]').forEach((e) => { e.removeAttribute('data-jourilo-composite'); e.removeAttribute('data-jourilo-composite-stop'); })`,
    )
    .catch(() => undefined);
}

// Menu buttons that open a role="menu" popup (APG "Menu Button"). The menu is opened with Enter (or ArrowDown), then
// ArrowDown/ArrowUp, Home/End and Escape are pressed. An item is never activated (no Enter or Space while the menu is
// open): items are often links that navigate or actions that change data. The page is reloaded if anything changed
// the URL anyway.
const MENU_TRIGGERS = `(() => {
  const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const out = [];
  for (const b of document.querySelectorAll('[aria-haspopup="menu"], [aria-haspopup="true"]')) {
    if (out.length >= 4 || !visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
    if (b.closest('[role="menu"], [role="menubar"]')) continue;
    const id = 'jourilo-menu-' + out.length;
    b.setAttribute('data-jourilo-menu', id);
    const r = b.getBoundingClientRect();
    out.push({ id, name: (b.getAttribute('aria-label') || b.innerText || b.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 80), rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) } });
  }
  return out;
})()`;

const MENU_STATE = `(id) => {
  const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const b = document.querySelector('[data-jourilo-menu="' + id + '"]');
  if (!b) return null;
  const controls = (b.getAttribute('aria-controls') || '').split(/\\s+/).map((i) => document.getElementById(i)).filter(Boolean);
  const menus = controls.filter((e) => e.getAttribute('role') === 'menu');
  if (!menus.length) menus.push(...Array.from(document.querySelectorAll('[role="menu"]')));
  const menu = menus.find(visible);
  const ae = document.activeElement;
  if (!menu) return { open: false, items: 0, pos: -1, onTrigger: ae === b };
  const items = Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')).filter((e) => visible(e) && e.getAttribute('aria-disabled') !== 'true');
  const ad = menu.getAttribute('aria-activedescendant') || (ae && ae.getAttribute && ae.getAttribute('aria-activedescendant')) || '';
  const target = ad && document.getElementById(ad) ? document.getElementById(ad) : ae;
  return { open: true, items: items.length, pos: target ? items.findIndex((i) => i === target || i.contains(target)) : -1, onTrigger: ae === b };
}`;

async function checkMenus(page: Page, out: WidgetCheck): Promise<void> {
  const found = (await page.evaluate(MENU_TRIGGERS).catch(() => [])) as {
    id: string;
    name: string;
    rect: Rect;
  }[];
  type MenuState = { open: boolean; items: number; pos: number; onTrigger: boolean } | null;
  const startUrl = page.url();
  for (const m of found) {
    if (DESTRUCTIVE.test(m.name) || FINANCIAL.test(m.name) || AVOID.test(m.name)) continue;
    const trigger = page.locator(`[data-jourilo-menu="${m.id}"]`).first();
    const selector = `[aria-haspopup][data-jourilo-menu="${m.id}"]`;
    const read = () => page.evaluate(`(${MENU_STATE})(${JSON.stringify(m.id)})`) as Promise<MenuState>;
    const issue = (kind: WidgetIssue['kind'], detail: string, steps: string[]) =>
      out.issues.push({ kind, trigger: selector, name: m.name, rect: m.rect, detail, steps });
    let opened: MenuState = null;
    try {
      await trigger.focus({ timeout: 2000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      opened = await read();
      if (!opened?.open) {
        await trigger.focus({ timeout: 2000 });
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(300);
        opened = await read();
      }
    } catch {
      continue;
    }
    if (!opened?.open || opened.items < 2) {
      await restoreMenuPage(page, startUrl, !!opened?.open);
      continue;
    }
    const last = opened.items - 1;
    const open = [`Focus the menu button "${m.name}" and press Enter to open its menu.`];
    let cur = opened;
    // Focus normally moves to an item on open; when it stays on the button, ArrowDown has to enter the menu.
    if (cur.pos < 0) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
      cur = (await read()) ?? cur;
    }
    const press = async (key: string): Promise<MenuState> => {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
      return read();
    };
    const p0 = cur.pos;
    const afterDown = await press('ArrowDown');
    const afterUp = await press('ArrowUp');
    const downMoved = !!afterDown?.open && afterDown.pos !== p0 && afterDown.pos >= 0;
    const upMoved = !!afterUp?.open && afterUp.pos !== (afterDown?.pos ?? p0) && afterUp.pos >= 0;
    if (!downMoved && !upMoved)
      issue(
        'menu-arrows',
        `ArrowDown and ArrowUp do not move focus between the ${opened.items} menu items.`,
        [...open, 'Press ArrowDown and ArrowUp: focus does not move to another menu item.'],
      );
    const home = await press('Home');
    const end = await press('End');
    const homeOk = home?.pos === 0;
    const endOk = end?.pos === last;
    if (!homeOk || !endOk)
      issue(
        'menu-home-end',
        `${[!homeOk && 'Home does not move to the first item', !endOk && 'End does not move to the last item'].filter(Boolean).join(' and ')}.`,
        [...open, 'Press Home, then End: focus does not jump to the first and last menu items.'],
      );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const closed = await read();
    if (closed?.open) {
      issue('menu-escape', 'Pressing Escape did not close the menu.', [
        ...open,
        'Press Escape: the menu stays open.',
      ]);
      await restoreMenuPage(page, startUrl, true);
      continue;
    }
    if (!closed?.onTrigger)
      issue(
        'menu-focus-not-returned',
        'After Escape closed the menu, focus did not return to the menu button.',
        [...open, 'Press Escape: the menu closes, but focus is not on the menu button.'],
      );
  }
  await page
    .evaluate(
      `document.querySelectorAll('[data-jourilo-menu]').forEach((e) => e.removeAttribute('data-jourilo-menu'))`,
    )
    .catch(() => undefined);
}

// Leave the page as it was found: reload when the URL changed or a menu would not close.
async function restoreMenuPage(page: Page, startUrl: string, menuStillOpen: boolean): Promise<void> {
  if (page.url() !== startUrl) await page.goto(startUrl, { waitUntil: 'load' }).catch(() => undefined);
  else if (menuStillOpen) await page.reload({ waitUntil: 'load' }).catch(() => undefined);
  else return;
  // The reload dropped the marks; the same selector walk puts the same ids back on the same buttons.
  await page.evaluate(MENU_TRIGGERS).catch(() => undefined);
}

export async function checkWidgets(page: Page): Promise<WidgetCheck> {
  const triggers = (await page.evaluate(TRIGGERS)) as {
    selector: string;
    name: string;
    popup: string | null;
    inPageLink: boolean;
    expanded: string | null;
    controls: string | null;
    rect: Rect;
  }[];
  const out: WidgetCheck = {
    triggers: triggers.length,
    dialogs: 0,
    disclosures: 0,
    composites: 0,
    issues: [],
  };
  // Composites first: dialog checks may reload the page.
  await checkComposites(page, out);
  // Menus next, for the same reason: a menu that ignores Escape is reloaded away.
  await checkMenus(page, out);
  const state = (controls: string | null, mode: 'open' | 'same' = 'open') =>
    page.evaluate(`(${STATE})(${JSON.stringify(controls)}, ${JSON.stringify(mode)})`) as Promise<State>;
  for (const t of triggers) {
    if (DESTRUCTIVE.test(t.name) || FINANCIAL.test(t.name) || AVOID.test(t.name)) continue;
    const loc = page.locator(t.selector).first();
    await page.evaluate(SNAPSHOT_LAYERS).catch(() => undefined);
    const before = await state(t.controls);
    if (before.dialogOpen) break; // a dialog is already open; the page is in an unexpected state
    try {
      await loc.focus({ timeout: 3000 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(350);
    } catch {
      continue;
    }
    const after = await state(t.controls);
    const expandedAfter = await loc.getAttribute('aria-expanded').catch(() => null);

    // A trigger with aria-expanded and aria-controls whose controlled element toggles is a disclosure, even when its
    // panel is a large positioned layer. Only an opened element with a dialog role, <dialog> or aria-modal
    // (unlabelled === false) is still judged as a dialog.
    const disclosure = t.expanded !== null && !!t.controls && after.controlledVisible !== null;
    if (after.dialogOpen && !before.dialogOpen && !(after.unlabelled && disclosure)) {
      out.dialogs++;
      const issue = (kind: WidgetIssue['kind'], detail: string) =>
        out.issues.push({ kind, trigger: t.selector, name: t.name, rect: t.rect, detail });
      if (after.unlabelled)
        issue(
          'dialog-no-role',
          'An overlay opened without role="dialog" (or <dialog>), so assistive technology does not announce it as a dialog.',
        );
      if (!after.focusInDialog) {
        issue(
          'dialog-focus-not-moved',
          `After opening, focus stayed on ${after.activeSelector ?? 'the page'} instead of moving into the dialog.`,
        );
      } else {
        // A modal layer must keep Tab inside it while it is open.
        for (let k = 0; k <= after.focusables; k++) await page.keyboard.press('Tab');
        await page.evaluate(WAIT_FOCUS_STABLE).catch(() => undefined);
        const tabbed = await state(t.controls, 'same');
        if (tabbed.dialogOpen && !tabbed.focusInDialog && !tabbed.onSentinel)
          issue(
            'dialog-focus-escapes',
            `Pressing Tab ${after.focusables + 1} time(s) moved focus out of the open dialog to ${tabbed.activeSelector ?? 'the page'}.`,
          );
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await state(t.controls, 'same');
      if (closed.dialogOpen) {
        issue('dialog-escape', 'Pressing Escape did not close the dialog.');
        // Leave the page as we found it so later checks are not affected.
        await page.reload({ waitUntil: 'load' }).catch(() => undefined);
        continue;
      }
      const backOnTrigger = await loc.evaluate((el) => el === document.activeElement).catch(() => false);
      if (!backOnTrigger)
        issue(
          'dialog-focus-not-returned',
          `After closing, focus went to ${closed.activeSelector ?? 'the start of the page'} instead of back to the control that opened the dialog.`,
        );
      continue;
    }

    if (disclosure) {
      out.disclosures++;
      // The controlled content changed visibility: aria-expanded must say so.
      if (
        after.controlledVisible !== before.controlledVisible &&
        String(after.controlledVisible) !== expandedAfter
      )
        out.issues.push({
          kind: 'expanded-state-mismatch',
          trigger: t.selector,
          name: t.name,
          rect: t.rect,
          detail: `The controlled content is now ${after.controlledVisible ? 'shown' : 'hidden'} but aria-expanded is "${expandedAfter}".`,
        });
      // Restore the original state.
      if (after.controlledVisible !== before.controlledVisible) {
        await page.keyboard.press('Enter').catch(() => undefined);
        await page.waitForTimeout(200);
      }
    }
  }
  return out;
}
