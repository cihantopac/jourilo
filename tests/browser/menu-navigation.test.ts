// Review Focus 1 (Jourilo 1.4.0): the menu keyboard check must never activate a menu item. A menu whose items are
// links must not navigate, and the page must be left as it was found.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser } from '../../src/browser/runtime.js';
import { checkWidgets } from '../../src/browser/widgets.js';
import { serveStatic } from '../../src/core/static-server.js';

const lab = join(import.meta.dirname, '../../fixtures/sites/widgets-lab');
let server: Awaited<ReturnType<typeof serveStatic>>;
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;

beforeAll(async () => {
  server = await serveStatic(lab);
  browser = await launchBrowser('chromium').catch(() => undefined);
});
afterAll(async () => {
  await browser?.close();
  await server.close();
});

describe('menu keyboard check', () => {
  it('does not activate link items and leaves the page where it found it', async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await (await browser.newContext()).newPage();
    const requests: string[] = [];
    const navigations: string[] = [];
    page.on('request', (r) => requests.push(new URL(r.url()).pathname));
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) navigations.push(new URL(f.url()).pathname);
    });
    await page.goto(`${server.url}/menu-good`, { waitUntil: 'load' });
    const loaded = navigations.length;
    const w = await checkWidgets(page);
    // The link menu ("Go to") was operated: it is the one whose items point at other pages.
    expect(w.issues.filter((i) => i.kind.startsWith('menu-'))).toEqual([]);
    expect(new URL(page.url()).pathname).toBe('/menu-good');
    for (const target of ['/accessible', '/anchors', '/launcher']) expect(requests).not.toContain(target);
    expect(navigations.length).toBe(loaded);
  });

  it('restores the page after a link trigger and a non-menu popup, so later checks still run', async (ctx) => {
    if (!browser) return ctx.skip();
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${server.url}/menu-popups`, { waitUntil: 'load' });
    const w = await checkWidgets(page);
    // (The pre-existing dialog loop may follow the link trigger itself; only the menu check must not break it.)
    expect(w.issues.map((i) => i.kind)).toContain('dialog-escape');
  });
});
