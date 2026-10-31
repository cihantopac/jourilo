#!/usr/bin/env node
// Independent accuracy benchmark on the W3C ACT Rules test cases (fetch them first with fetch.mjs). The cases were
// written by the ACT Rules Community Group, not for Jourilo, and each is labelled "failed", "passed" or
// "inapplicable" for one rule. Each rule maps to the WCAG success criteria it is required for
// (`forConformance: true`); rules without such a mapping are not scored.
//
// Scoring, the same for every tool, per test case of rule R with criteria S:
//   failed example        → true positive when the tool reports an error-level problem mapped to a criterion in S
//                            on that page, otherwise false negative;
//   passed / inapplicable → false positive when it does, otherwise true negative.
// Precision = TP / (TP + FP); recall = TP / (TP + FN). Problems mapped to other criteria are ignored (test cases are
// minimal but not guaranteed free of unrelated issues).
//
// Tools: Jourilo (full audit, desktop viewport, keyboard walk, read-only form probe) and axe-core alone (same
// version and tags that Jourilo runs), so the effect of Jourilo's own checks is visible.
//
// Usage: node benchmarks/act/run.mjs [--limit N] [--rules id,id] [--out docs/evaluation] [--reuse run.json]
import { spawnSync } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cache = join(here, '.cache');
const require = createRequire(join(root, 'package.json'));
const { values: args } = parseArgs({
  options: {
    limit: { type: 'string' },
    rules: { type: 'string' },
    out: { type: 'string' },
    reuse: { type: 'string' },
    'skip-axe': { type: 'boolean' },
  },
});
if (!existsSync(join(cache, 'testcases.json'))) {
  console.error('Run node benchmarks/act/fetch.mjs first.');
  process.exit(2);
}
const index = JSON.parse(readFileSync(join(cache, 'testcases.json'), 'utf8'));

/** Primary WCAG criteria of a rule: the ones it is required for. */
function criteriaOf(reqs) {
  return Object.entries(reqs ?? {})
    .filter(([k, v]) => /^wcag2\d:\d+\.\d+\.\d+$/.test(k) && v && v.forConformance === true)
    .map(([k]) => k.split(':')[1]);
}

let cases = index.testcases
  .filter((t) => t.relativePath.endsWith('.html'))
  .map((t) => ({
    rule: t.ruleId,
    ruleName: t.ruleName,
    expected: t.expected,
    path: new URL(t.url).pathname,
    criteria: criteriaOf(t.ruleAccessibilityRequirements),
  }))
  .filter((c) => existsSync(join(cache, c.path)));
if (args.rules) cases = cases.filter((c) => args.rules.split(',').includes(c.rule));
if (args.limit) cases = cases.slice(0, Number(args.limit));
const scored = cases.filter((c) => c.criteria.length);
console.log(`${cases.length} HTML test cases, ${scored.length} on rules mapped to WCAG criteria.`);

// ---- Local server for the mirrored site ----
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
};
function serve() {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(cache, p);
    if (!file.startsWith(cache) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** "1.4.3" from a Jourilo standard reference or an axe tag such as "wcag143". */
const fromAxeTag = (tag) => {
  const m = tag.match(/^wcag(\d)(\d)(\d+)$/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
};

// ---- Jourilo ----
function runJourilo(base) {
  if (args.reuse) return JSON.parse(readFileSync(args.reuse, 'utf8'));
  const ws = join(root, 'tests', '.tmp', 'bench-act');
  const t0 = Date.now();
  const r = spawnSync(
    process.execPath,
    [
      join(root, 'plugin', 'dist', 'jourilo.mjs'),
      'audit',
      base,
      ...cases.flatMap((c) => ['--url', c.path]),
      '--viewports',
      'desktop',
      '--workspace',
      ws,
      '--json',
      '-q',
    ],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 },
  );
  if (r.status !== 0 && r.status !== 1)
    throw new Error(`jourilo failed (${r.status}): ${r.stderr.slice(0, 2000)}`);
  const out = JSON.parse(r.stdout);
  const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
  run.benchSeconds = Math.round((Date.now() - t0) / 1000);
  return run;
}

function jouriloFlags(run) {
  const byPage = new Map();
  for (const f of run.findings) {
    if (f.kind !== 'defect') continue;
    const sc = (f.standards ?? []).filter((s) => /^WCAG/.test(s.standard)).map((s) => s.id);
    for (const u of String(f.url).split(', ')) {
      const key = new URL(u).pathname;
      const list = byPage.get(key) ?? [];
      list.push({ rule: f.ruleId, sc });
      byPage.set(key, list);
    }
  }
  return byPage;
}

// ---- axe-core alone (same version and tags as Jourilo) ----
async function runAxe(base) {
  const { chromium } = await import('playwright-core');
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const byPage = new Map();
  const t0 = Date.now();
  for (const c of cases) {
    const page = await ctx.newPage();
    try {
      await page.goto(base + c.path, { waitUntil: 'load', timeout: 30_000 });
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(
        `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(TAGS)} }, resultTypes: ['violations'], rules: { 'target-size': { enabled: true } } })`,
      );
      byPage.set(
        c.path,
        res.violations.map((v) => ({ rule: v.id, sc: v.tags.map(fromAxeTag).filter(Boolean) })),
      );
    } catch (err) {
      byPage.set(c.path, []);
    } finally {
      await page.close();
    }
  }
  await browser.close();
  return { byPage, seconds: Math.round((Date.now() - t0) / 1000) };
}

function score(byPage) {
  const perRule = new Map();
  const perSc = new Map();
  const total = { tp: 0, fn: 0, fp: 0, tn: 0 };
  const misses = [];
  const falseFlags = [];
  for (const c of scored) {
    const flags = (byPage.get(c.path) ?? []).filter((f) => f.sc.some((s) => c.criteria.includes(s)));
    const hit = flags.length > 0;
    const outcome = c.expected === 'failed' ? (hit ? 'tp' : 'fn') : hit ? 'fp' : 'tn';
    total[outcome]++;
    const r = perRule.get(c.rule) ?? {
      rule: c.rule,
      name: c.ruleName,
      criteria: c.criteria,
      tp: 0,
      fn: 0,
      fp: 0,
      tn: 0,
    };
    r[outcome]++;
    perRule.set(c.rule, r);
    for (const sc of c.criteria) {
      const s = perSc.get(sc) ?? { sc, tp: 0, fn: 0, fp: 0, tn: 0 };
      s[outcome]++;
      perSc.set(sc, s);
    }
    if (outcome === 'fn') misses.push({ rule: c.rule, path: c.path });
    if (outcome === 'fp')
      falseFlags.push({ rule: c.rule, path: c.path, by: [...new Set(flags.map((f) => f.rule))] });
  }
  const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const metrics = (x) => ({ ...x, precision: ratio(x.tp, x.tp + x.fp), recall: ratio(x.tp, x.tp + x.fn) });
  return {
    total: metrics(total),
    perRule: [...perRule.values()].map(metrics).sort((a, b) => a.rule.localeCompare(b.rule)),
    perSc: [...perSc.values()]
      .map(metrics)
      .sort((a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true })),
    misses,
    falseFlags,
  };
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const run = runJourilo(base);
  const jourilo = score(jouriloFlags(run));
  const axe = args['skip-axe'] ? null : await runAxe(base);
  const axeScore = axe ? score(axe.byPage) : null;
  const date = new Date().toISOString().slice(0, 10);
  const outDir = args.out ?? join(root, 'docs', 'evaluation');
  mkdirSync(outDir, { recursive: true });
  const result = {
    date,
    corpus: {
      source: index.website,
      license: index.license,
      cases: cases.length,
      scored: scored.length,
      rules: new Set(scored.map((c) => c.rule)).size,
    },
    jourilo: { version: run.tool?.version, browser: run.browser, seconds: run.benchSeconds, ...jourilo },
    axe: axeScore
      ? {
          version: JSON.parse(readFileSync(require.resolve('axe-core/package.json'), 'utf8')).version,
          seconds: axe.seconds,
          ...axeScore,
        }
      : null,
  };
  writeFileSync(join(outDir, `act-${date}.json`), `${JSON.stringify(result, null, 1)}\n`);
  const row = (name, s) =>
    `| ${name} | ${s.tp} | ${s.fn} | ${s.fp} | ${s.tn} | ${s.precision ?? '—'} % | ${s.recall ?? '—'} % |`;
  const md = [
    `# ACT Rules benchmark (${date})`,
    '',
    `${scored.length} test cases on ${result.corpus.rules} ACT rules mapped to WCAG criteria (of ${cases.length} HTML cases). Method: benchmarks/act/run.mjs.`,
    '',
    '| Tool | TP | FN | FP | TN | Precision | Recall |',
    '| ---- | -- | -- | -- | -- | --------- | ------ |',
    row(`Jourilo ${result.jourilo.version}`, jourilo.total),
    ...(axeScore ? [row(`axe-core ${result.axe.version} alone`, axeScore.total)] : []),
    '',
    '## By WCAG success criterion',
    '',
    '| SC | Jourilo TP/FN/FP/TN | Jourilo P / R | axe TP/FN/FP/TN | axe P / R |',
    '| -- | ------------------- | ------------- | --------------- | --------- |',
    ...jourilo.perSc.map((s) => {
      const a = axeScore?.perSc.find((x) => x.sc === s.sc);
      return `| ${s.sc} | ${s.tp}/${s.fn}/${s.fp}/${s.tn} | ${s.precision ?? '—'} / ${s.recall ?? '—'} | ${a ? `${a.tp}/${a.fn}/${a.fp}/${a.tn}` : '—'} | ${a ? `${a.precision ?? '—'} / ${a.recall ?? '—'}` : '—'} |`;
    }),
    '',
    '## By ACT rule',
    '',
    '| Rule | Name | SC | Jourilo TP/FN/FP/TN | axe TP/FN/FP/TN |',
    '| ---- | ---- | -- | ------------------- | --------------- |',
    ...jourilo.perRule.map((r) => {
      const a = axeScore?.perRule.find((x) => x.rule === r.rule);
      return `| ${r.rule} | ${r.name} | ${r.criteria.join(', ')} | ${r.tp}/${r.fn}/${r.fp}/${r.tn} | ${a ? `${a.tp}/${a.fn}/${a.fp}/${a.tn}` : '—'} |`;
    }),
    '',
  ].join('\n');
  writeFileSync(join(outDir, `act-${date}.md`), md);
  console.log(md.split('\n').slice(0, 9).join('\n'));
} finally {
  server.close();
}
