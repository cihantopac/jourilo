#!/usr/bin/env node
// Comparative benchmark on the GOV.UK accessibility tool audit (https://alphagov.github.io/accessibility-tool-audit/):
// 142 published test pages, each containing one known accessibility barrier. Every tool audits every page with the
// same Chromium build; a tool "detects" a case when it reports something on that page beyond its own template
// noise (rules it reports on >= 60% of pages, e.g. the shared <h1> outside <main>).
//
// This measures whether a tool flags *something* on the page, not whether its message names the exact barrier
// (GOV.UK's own audit judged that by hand). The same rule applies to every tool.
//
// Usage: node govuk.mjs [--limit N] [--only jourilo,pa11y,lighthouse] [--out ../../docs/evaluation]
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import pa11y from 'pa11y';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const BASE = 'https://alphagov.github.io/accessibility-tool-audit/';
const { values: args } = parseArgs({
  options: {
    limit: { type: 'string' },
    only: { type: 'string' },
    out: { type: 'string' },
    reuse: { type: 'string' },
  },
});
const tools = (args.only ?? 'jourilo,pa11y,lighthouse').split(',');
const chromePath = chromium.executablePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCases() {
  const html = await (await fetch(`${BASE}test-cases.html`)).text();
  const cases = [];
  let category = '';
  const re =
    /<h2[^>]*>([^<]+)<\/h2>|<h3 class="heading-medium" id="([^"]+)">\s*<a href="(tests\/[^"]+)">\s*([^<]+?)\s*<\/a>/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) category = m[1].trim();
    else cases.push({ id: m[2], url: new URL(m[3], BASE).toString(), title: m[4], category });
  }
  return args.limit ? cases.slice(0, Number(args.limit)) : cases;
}

// ---- Jourilo: one run over all pages (desktop, keyboard walk on, read-only) ----
function runJourilo(cases) {
  const ws = join(root, 'tests', '.tmp', 'compare-govuk');
  const urlArgs = cases.flatMap((c) => ['--url', new URL(c.url).pathname]);
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    [
      join(root, 'plugin', 'dist', 'jourilo.mjs'),
      'audit',
      BASE,
      ...urlArgs,
      '--viewports',
      'desktop',
      '--workspace',
      ws,
      '--json',
      '-q',
    ],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (r.status !== 0 && r.status !== 1) throw new Error(`jourilo failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const byPage = new Map();
  for (const f of out.findings) {
    // Barrier-related categories only; conversion hypotheses and lab performance are not accessibility checks.
    if (!['accessibility', 'usability', 'responsive'].includes(f.category)) continue;
    const key = new URL(f.url).pathname;
    const list = byPage.get(key) ?? [];
    list.push({ rule: f.ruleId, level: f.kind === 'defect' ? 'error' : 'warning' });
    byPage.set(key, list);
  }
  return { ms: Date.now() - t0, results: cases.map((c) => byPage.get(new URL(c.url).pathname) ?? []) };
}

// ---- Pa11y: default runner (HTML_CodeSniffer, WCAG2AA), errors and warnings ----
async function runPa11y(cases) {
  const t0 = Date.now();
  const results = [];
  for (const c of cases) {
    try {
      const r = await pa11y(c.url, {
        includeWarnings: true,
        timeout: 60000,
        chromeLaunchConfig: { executablePath: chromePath, args: ['--no-sandbox'] },
      });
      results.push(r.issues.map((i) => ({ rule: i.code, level: i.type === 'error' ? 'error' : 'warning' })));
    } catch (e) {
      results.push([{ rule: `tool-error:${e.message.slice(0, 60)}`, level: 'tool-error' }]);
    }
    await sleep(200);
  }
  return { ms: Date.now() - t0, results };
}

// ---- Lighthouse: accessibility category, desktop, failing binary audits ----
async function runLighthouse(cases) {
  const t0 = Date.now();
  const chrome = await chromeLauncher.launch({ chromePath, chromeFlags: ['--headless=new', '--no-sandbox'] });
  const results = [];
  try {
    for (const c of cases) {
      try {
        const r = await lighthouse(
          c.url,
          { port: chrome.port, logLevel: 'error', output: 'json' },
          {
            extends: 'lighthouse:default',
            settings: {
              onlyCategories: ['accessibility'],
              formFactor: 'desktop',
              screenEmulation: {
                mobile: false,
                width: 1350,
                height: 940,
                deviceScaleFactor: 1,
                disabled: false,
              },
            },
          },
        );
        const lhr = r.lhr;
        const refs = lhr.categories.accessibility.auditRefs.map((a) => lhr.audits[a.id]);
        results.push(
          refs
            .filter((a) => a.scoreDisplayMode === 'binary' && a.score === 0)
            .map((a) => ({ rule: a.id, level: 'error' })),
        );
      } catch (e) {
        results.push([{ rule: `tool-error:${e.message.slice(0, 60)}`, level: 'tool-error' }]);
      }
    }
  } finally {
    await chrome.kill();
  }
  return { ms: Date.now() - t0, results };
}

function classify(results) {
  const pages = results.length;
  const freq = new Map();
  for (const list of results)
    for (const rule of new Set(list.map((x) => x.rule))) freq.set(rule, (freq.get(rule) ?? 0) + 1);
  // Template noise: rules a tool reports on >= 60% of pages. Generic signals: rules on >= 10% of pages (e.g. "form
  // has no submit button", "missing autocomplete"). A detection is "specific" when an error-level rule that fires on
  // < 10% of pages is present.
  const noise = new Set([...freq].filter(([, n]) => n / pages >= 0.6).map(([r]) => r));
  const generic = new Set([...freq].filter(([, n]) => n / pages >= 0.1).map(([r]) => r));
  return {
    noise: [...noise],
    perCase: results.map((list) => {
      if (list.some((x) => x.level === 'tool-error'))
        return { verdict: 'tool-error', specific: false, rules: list.map((x) => x.rule) };
      const real = list.filter((x) => !noise.has(x.rule));
      const verdict = real.some((x) => x.level === 'error') ? 'error' : real.length ? 'warning' : 'none';
      const specific = real.some((x) => x.level === 'error' && !generic.has(x.rule));
      return {
        verdict,
        specific,
        rules: [...new Set(real.map((x) => `${x.level === 'error' ? '' : '~'}${x.rule}`))],
      };
    }),
  };
}

const cases = await loadCases();
console.error(`${cases.length} GOV.UK test cases; tools: ${tools.join(', ')}; Chromium ${chromePath}`);
// --reuse <report.json>: keep earlier raw results for tools that are not rerun (their versions did not change).
const reused = args.reuse ? JSON.parse(readFileSync(args.reuse, 'utf8')) : null;
const raw = {};
if (tools.includes('jourilo')) raw.jourilo = runJourilo(cases);
if (tools.includes('pa11y')) raw.pa11y = await runPa11y(cases);
if (tools.includes('lighthouse')) raw.lighthouse = await runLighthouse(cases);

const jouriloVersion = execFileSync(
  process.execPath,
  [join(root, 'plugin', 'dist', 'jourilo.mjs'), '--version'],
  { encoding: 'utf8' },
).trim();
const report = {
  source: BASE,
  date: new Date().toISOString(),
  method:
    'detected = reports something on the case page beyond the tool template noise (rules on >= 60% of pages); specific = an error-level rule that fires on < 10% of pages',
  versions: {
    jourilo: jouriloVersion,
    pa11y: '10.0.0 (HTML_CodeSniffer, WCAG2AA, warnings included)',
    lighthouse: '13.6.0 (accessibility category, desktop)',
    chromium: chromePath.match(/chromium[-_]\d+/)?.[0] ?? 'playwright chromium',
  },
  tools: {},
  cases: cases.map((c) => ({ id: c.id, category: c.category, title: c.title, url: c.url })),
};
const summarize = (r, extra = {}) => {
  const cls = classify(r.results);
  const count = (v) => cls.perCase.filter((x) => x.verdict === v).length;
  return {
    seconds: Math.round(r.ms / 100) / 10,
    error: count('error'),
    specific: cls.perCase.filter((x) => x.specific).length,
    warning: count('warning'),
    none: count('none'),
    toolError: count('tool-error'),
    noise: cls.noise,
    raw: r.results,
    perCase: cls.perCase,
    ...extra,
  };
};
for (const [tool, r] of Object.entries(raw)) report.tools[tool] = summarize(r);
for (const [tool, t] of Object.entries(reused?.tools ?? {})) {
  if (report.tools[tool] || !t.raw) continue;
  report.tools[tool] = summarize({ results: t.raw, ms: t.seconds * 1000 }, { reusedFrom: reused.date });
}

const names = Object.keys(report.tools);
const lines = [
  '| Tool | Error-level detection | of which specific | Warning only | Not detected | Tool errors | Time |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];
for (const n of names) {
  const t = report.tools[n];
  lines.push(
    `| ${n} | ${t.error} / ${cases.length} | ${t.specific} | ${t.warning} | ${t.none} | ${t.toolError} | ${t.seconds} s |`,
  );
}
const cats = [...new Set(cases.map((c) => c.category))];
lines.push(
  '',
  `| Category | Cases | ${names.map((n) => `${n} (specific / error / any)`).join(' | ')} |`,
  `| --- | --- | ${names.map(() => '---').join(' | ')} |`,
);
for (const cat of cats) {
  const idx = cases.map((c, i) => (c.category === cat ? i : -1)).filter((i) => i >= 0);
  lines.push(
    `| ${cat} | ${idx.length} | ${names
      .map((n) => {
        const pc = report.tools[n].perCase;
        const sp = idx.filter((i) => pc[i].specific).length;
        const er = idx.filter((i) => pc[i].verdict === 'error').length;
        const any = idx.filter((i) => pc[i].verdict === 'error' || pc[i].verdict === 'warning').length;
        return `${sp} / ${er} / ${any}`;
      })
      .join(' | ')} |`,
  );
}
const outDir = args.out ?? join(root, 'docs', 'evaluation');
mkdirSync(outDir, { recursive: true });
const stamp = report.date.slice(0, 10);
writeFileSync(join(outDir, `compare-govuk-${stamp}.json`), `${JSON.stringify(report)}\n`);
writeFileSync(join(outDir, `compare-govuk-${stamp}.md`), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
