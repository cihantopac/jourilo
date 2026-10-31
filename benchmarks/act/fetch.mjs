#!/usr/bin/env node
// Downloads the W3C ACT Rules test cases (https://www.w3.org/WAI/standards-guidelines/act/rules/) and the shared
// assets they reference into benchmarks/act/.cache, mirroring the site's paths so the pages can be served locally.
// The test cases are published under the W3C Software and Document License; they are not committed here.
// Polite: one request at a time with a pause, Retry-After honoured on 429, identified user agent, each file once.
//
// Usage: node benchmarks/act/fetch.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, '.cache');
const ORIGIN = 'https://www.w3.org';
const INDEX = `${ORIGIN}/WAI/content-assets/wcag-act-rules/testcases.json`;
const UA = 'Jourilo-benchmark (+https://github.com/cihantopac/jourilo)';

const fileFor = (url) => join(cache, decodeURIComponent(new URL(url).pathname));

let rateLimitWaits = 0;
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if ((res.status === 429 || res.status === 503) && rateLimitWaits++ < 40) {
        const wait = Number(res.headers.get('retry-after')) || 30;
        console.log(`rate limited; waiting ${wait} s`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempt--;
        continue;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 2) {
        console.error(`failed ${url}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

/** Same-site references (absolute paths or relative URLs) in HTML/CSS/SVG. */
function references(text, base) {
  const out = new Set();
  const add = (raw) => {
    if (!raw || /^(data:|javascript:|mailto:|#|about:)/i.test(raw)) return;
    try {
      const u = new URL(raw, base);
      if (u.origin === ORIGIN && u.pathname.startsWith('/WAI/content-assets/'))
        out.add(u.origin + u.pathname);
    } catch {}
  };
  for (const m of text.matchAll(/\b(?:src|href|data|poster|xlink:href)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi))
    for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0]);
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  return [...out];
}

const index = JSON.parse((await get(INDEX)).toString('utf8'));
mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, 'testcases.json'), JSON.stringify(index, null, 1));
const queue = index.testcases.map((t) => t.url);
const seen = new Set(queue);
let done = 0;
let fetched = 0;
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    const file = fileFor(url);
    let body = existsSync(file) ? readFileSync(file) : null;
    if (!body) {
      body = await get(url);
      if (!body) continue;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
      fetched++;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (/\.(html?|css|svg|xml)$/i.test(url))
      for (const ref of references(body.toString('utf8'), url))
        if (!seen.has(ref)) {
          seen.add(ref);
          queue.push(ref);
        }
    if (++done % 100 === 0) console.log(`${done} files (${fetched} downloaded, ${queue.length} queued)`);
  }
}
await worker();
console.log(`Done: ${done} files in ${cache} (${fetched} downloaded now).`);
