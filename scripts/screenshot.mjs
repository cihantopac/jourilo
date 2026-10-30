#!/usr/bin/env node
// Dev helper: screenshot a local HTML file (e.g. a Jourilo report) for visual review and README images.
// Usage: node scripts/screenshot.mjs <file.html> <out.png> [width] [height] [overview|open|findings|pages|journeys|compare] [dark]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const [file, out, w = '1280', h = '900', action = 'overview', scheme = 'light'] = process.argv.slice(2);
if (!file || !out) {
  console.error('usage: screenshot.mjs <file.html> <out.png> [width] [height] [action] [light|dark]');
  process.exit(2);
}
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  colorScheme: scheme,
});
await page.goto(pathToFileURL(resolve(file)).toString());
if (action === 'open') await page.click('#overview details');
if (['findings', 'pages', 'journeys', 'compare'].includes(action)) await page.click(`[data-tab=${action}]`);
if (action === 'findings') await page.click('#findings details:not([hidden])');
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
