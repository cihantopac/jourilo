// Composite widget checks, operated with the keyboard like a keyboard user would:
//  - dialogs: focus moves into the dialog when it opens (WCAG 2.4.3), Escape closes it, focus returns to the trigger;
//  - disclosures/menus: aria-expanded reflects whether the controlled content is shown (WCAG 4.1.2).
// Only triggers that declare a popup or expanded state are operated (aria-haspopup / aria-expanded), and never one
// whose name looks destructive or financial. Nothing is submitted.
import type { Page } from 'playwright-core';
import type { Rect } from '../core/types.js';
import { DESTRUCTIVE, FINANCIAL } from '../journeys/safety.js';

export interface WidgetIssue {
  kind: 'dialog-focus-not-moved' | 'dialog-escape' | 'dialog-focus-not-returned' | 'expanded-state-mismatch';
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
  return Array.from(document.querySelectorAll('[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded]'))
    .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && /^(BUTTON|A|SUMMARY)$|^button$/i.test(e.tagName === 'DIV' || e.tagName === 'SPAN' ? (e.getAttribute('role') || '') : e.tagName))
    .slice(0, 8)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        selector: sel(e),
        name: (e.getAttribute('aria-label') || e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        popup: e.getAttribute('aria-haspopup'),
        expanded: e.getAttribute('aria-expanded'),
        controls: e.getAttribute('aria-controls'),
        rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      };
    });
})()`;

const STATE = `(controls) => {
  const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]')).filter(visible);
  const d = dialogs[dialogs.length - 1] || null;
  const ae = document.activeElement;
  const controlled = controls ? controls.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean) : [];
  return {
    dialogOpen: !!d,
    focusInDialog: !!d && !!ae && d.contains(ae),
    controlledVisible: controlled.length ? controlled.some(visible) : null,
    activeSelector: ae && ae !== document.body ? (ae.id ? '#' + ae.id : ae.tagName.toLowerCase()) : null,
  };
}`;

type State = {
  dialogOpen: boolean;
  focusInDialog: boolean;
  controlledVisible: boolean | null;
  activeSelector: string | null;
};

export async function checkWidgets(page: Page): Promise<WidgetCheck> {
  const triggers = (await page.evaluate(TRIGGERS)) as {
    selector: string;
    name: string;
    popup: string | null;
    expanded: string | null;
    controls: string | null;
    rect: Rect;
  }[];
  const out: WidgetCheck = { triggers: triggers.length, dialogs: 0, disclosures: 0, issues: [] };
  const state = (controls: string | null) =>
    page.evaluate(`(${STATE})(${JSON.stringify(controls)})`) as Promise<State>;
  for (const t of triggers) {
    if (DESTRUCTIVE.test(t.name) || FINANCIAL.test(t.name)) continue;
    const loc = page.locator(t.selector).first();
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
      if (!after.focusInDialog)
        out.issues.push({
          kind: 'dialog-focus-not-moved',
          trigger: t.selector,
          name: t.name,
          rect: t.rect,
          detail: `After opening, focus stayed on ${after.activeSelector ?? 'the page'} instead of moving into the dialog.`,
        });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await state(t.controls);
      if (closed.dialogOpen) {
        out.issues.push({
          kind: 'dialog-escape',
          trigger: t.selector,
          name: t.name,
          rect: t.rect,
          detail: 'Pressing Escape did not close the dialog.',
        });
        // Leave the page as we found it so later checks are not affected.
        await page.reload({ waitUntil: 'load' }).catch(() => undefined);
        continue;
      }
      const backOnTrigger = await loc.evaluate((el) => el === document.activeElement).catch(() => false);
      if (!backOnTrigger)
        out.issues.push({
          kind: 'dialog-focus-not-returned',
          trigger: t.selector,
          name: t.name,
          rect: t.rect,
          detail: `After closing, focus went to ${closed.activeSelector ?? 'the start of the page'} instead of back to the button that opened the dialog.`,
        });
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
