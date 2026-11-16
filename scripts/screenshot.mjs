#!/usr/bin/env node
// Dev helper: screenshot a local HTML file (e.g. a Jourilo report) for visual review and README images.
// Usage: node scripts/screenshot.mjs <file.html> <out.png> [width] [height]
//          [overview|open|findings|pages|journeys|compare|finding=<title text>|prompt] [light|dark]
// Env: SCALE=2 (device scale factor), LANG_UI=tr (switch the report language),
//      CLIP="<css selector>" (crop to the union of the matching elements), PAD=24 (padding around CLIP, px),
//      HIDE="<css selector>" (hide elements before the shot)
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [file, out, w = '1280', h = '900', action = 'overview', scheme = 'light'] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: screenshot.mjs <file.html> <out.png> [width] [height] [action] [light|dark]');
  process.exit(2);
}
const { SCALE = '1', LANG_UI, CLIP, PAD = '24', HIDE } = process.env;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  colorScheme: scheme,
  deviceScaleFactor: Number(SCALE),
});
await page.goto(pathToFileURL(resolve(file)).toString());
if (LANG_UI) await page.click(`#lang [data-lang="${LANG_UI}"]`);
if (action === 'open') await page.click('#overview details');
if (['findings', 'pages', 'journeys', 'compare'].includes(action)) await page.click(`#tab-${action}`);
if (action === 'findings') await page.click('#findings details:not([hidden])');
if (action.startsWith('finding=')) {
  await page.click('#tab-findings');
  const summary = page.locator('#findings details > summary', { hasText: action.slice(8) }).first();
  await summary.click();
  await summary.scrollIntoViewIfNeeded();
}
if (action === 'prompt') {
  await page.click('#tab-findings');
  const boxes = page.locator('#findings input.sel:visible');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.click('#actionbar [data-action="prompt"]');
  // Scroll the brief to the selected findings (the header names local paths) and drop the focus ring.
  await page.$eval('#prompt-text', (ta) => {
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    for (const k of [
      'font',
      'letterSpacing',
      'padding',
      'boxSizing',
      'whiteSpace',
      'overflowWrap',
      'tabSize',
    ])
      mirror.style[k] = cs[k];
    Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', width: `${ta.clientWidth}px` });
    mirror.textContent = ta.value.slice(0, ta.value.indexOf('\n## Selected findings') + 1);
    document.body.append(mirror);
    ta.scrollTop = mirror.offsetHeight - Number.parseFloat(cs.paddingBottom);
    mirror.remove();
    ta.blur();
  });
}
if (HIDE)
  await page.$$eval(HIDE, (els) => {
    for (const e of els) e.style.setProperty('display', 'none', 'important');
  });
await page.waitForTimeout(300);
if (CLIP) {
  const box = await page.evaluate(
    ([sel, pad]) => {
      const rs = [...document.querySelectorAll(sel)]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.height);
      if (!rs.length) return null;
      const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad + scrollX);
      const y = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad + scrollY);
      const x2 = Math.min(
        document.documentElement.scrollWidth,
        Math.max(...rs.map((r) => r.right)) + pad + scrollX,
      );
      const y2 = Math.max(...rs.map((r) => r.bottom)) + pad + scrollY;
      return { x, y, width: x2 - x, height: y2 - y };
    },
    [CLIP, Number(PAD)],
  );
  if (!box) throw new Error(`CLIP matched nothing: ${CLIP}`);
  await page.screenshot({ path: out, clip: box, fullPage: true });
} else {
  await page.screenshot({ path: out });
}
await browser.close();
