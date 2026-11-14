// checkMenus: the cap of 4 is counted after the destructive/financial name filter, and triggers are tagged by name.
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser } from '../../src/browser/runtime.js';
import { checkMenus, type WidgetCheck } from '../../src/browser/widgets.js';

let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
beforeAll(async () => {
  browser = await launchBrowser('chromium').catch(() => undefined);
});
afterAll(async () => {
  await browser?.close();
});

// A routed page, not setContent: a menu left open is reloaded away, and a reload needs a real URL.
async function load(page: Page, html: string): Promise<void> {
  await page.route('http://menus.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><body>${html}</body></html>`,
    }),
  );
  await page.goto('http://menus.test/', { waitUntil: 'load' });
}

const empty = (): WidgetCheck => ({ triggers: 0, dialogs: 0, disclosures: 0, composites: 0, issues: [] });

// A menu button whose arrow keys do nothing: every operated one yields a menu-arrows issue.
const broken = (name: string) =>
  `<div><button type="button" aria-haspopup="menu" aria-expanded="false" onclick="this.nextElementSibling.hidden=false">${name}</button>` +
  `<div role="menu" hidden><button role="menuitem" tabindex="-1">One</button><button role="menuitem" tabindex="-1">Two</button></div></div>`;

describe('checkMenus', () => {
  it('counts the cap after the name filter and finds the menus by name', async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await (await browser.newContext()).newPage();
    const names = ['Delete', 'Pay now', 'Purchase', 'Remove', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
    await load(page, `<main>${names.map(broken).join('')}</main>`);
    const out = empty();
    await checkMenus(page, out);
    const operated = out.issues.filter((i) => i.kind === 'menu-arrows').map((i) => i.name);
    // The unsafe names are skipped without using up the cap; exactly 4 safe menus are operated.
    expect(operated).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
  });

  it('operates nothing when every trigger is destructive', async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await (await browser.newContext()).newPage();
    await load(page, `<main>${['Delete', 'Remove account'].map(broken).join('')}</main>`);
    const out = empty();
    await checkMenus(page, out);
    expect(out.issues).toEqual([]);
  });
});
