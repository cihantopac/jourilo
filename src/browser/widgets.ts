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
    | 'expanded-state-mismatch';
  trigger: string;
  name: string;
  rect: Rect;
  detail: string;
}

export interface WidgetCheck {
  triggers: number;
  dialogs: number;
  disclosures: number;
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
  window.__jouriloLayers = new Set(layers);
})()`;

const STATE = `(controls) => {
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  let d = dialogs[dialogs.length - 1] || null;
  let unlabelled = false;
  if (!d && window.__jouriloLayers) {
    const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height >= innerWidth * innerHeight * 0.02; };
    const fresh = Array.from(document.querySelectorAll('body *')).filter((e) => {
      const cs = getComputedStyle(e);
      return (cs.position === 'fixed' || cs.position === 'absolute') && visible(e) && big(e) && !window.__jouriloLayers.has(e);
    });
    const outer = fresh.filter((e) => !fresh.some((o) => o !== e && o.contains(e)));
    if (outer.length) { d = outer[outer.length - 1]; unlabelled = true; }
  }
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

type State = {
  dialogOpen: boolean;
  unlabelled: boolean;
  focusInDialog: boolean;
  focusables: number;
  controlledVisible: boolean | null;
  activeSelector: string | null;
};

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
  const out: WidgetCheck = { triggers: triggers.length, dialogs: 0, disclosures: 0, issues: [] };
  const state = (controls: string | null) =>
    page.evaluate(`(${STATE})(${JSON.stringify(controls)})`) as Promise<State>;
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

    if (after.dialogOpen && !before.dialogOpen) {
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
        const tabbed = await state(t.controls);
        if (tabbed.dialogOpen && !tabbed.focusInDialog)
          issue(
            'dialog-focus-escapes',
            `Pressing Tab ${after.focusables + 1} time(s) moved focus out of the open dialog to ${tabbed.activeSelector ?? 'the page'}.`,
          );
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await state(t.controls);
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

    if (t.expanded !== null && t.controls && after.controlledVisible !== null) {
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
