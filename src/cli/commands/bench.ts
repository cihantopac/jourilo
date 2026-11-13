// Benchmark against fixture sites with known, seeded defects (fixtures/sites/*/expected.json). Measures what
// Jourilo finds (recall), what it must not report (false positives) and how long it takes. Results can be
// appended to docs/evaluation so improvements and regressions are tracked over time.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAudit } from '../../audit/engine.js';
import { pagesOf, pathOf, severityRank } from '../../audit/finding.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { serveStatic } from '../../core/static-server.js';
import type { Finding, Severity } from '../../core/types.js';
import { VERSION } from '../../core/version.js';
import { loadContext } from '../../integrations/context.js';
import { locateFindings } from '../../repair/locate.js';
import { type Command, str } from '../framework.js';

export interface Expectation {
  rule: string;
  path: string;
  viewport?: string;
  /** Only a finding of this kind matches (e.g. a defect must not be reported where review is right). */
  kind?: Finding['kind'];
  why?: string;
  /**
   * The evidence of the matching finding is exactly these elements: every item contains one of the texts (snippet or
   * selector) and every text is contained in some item.
   */
  evidenceExactly?: string[];
  /** The matching finding was collapsed over exactly these pages (F44), in any order. */
  pagesExactly?: string[];
  // Limits for a finding collapsed over several pages (F44): `path` matches any of its pages, but `viewport` is checked
  // against the union of viewports of all its pages and `evidenceExactly` against the first page's evidence only (a
  // collapsed finding does not keep either per page). Use them on per-page findings or on single-viewport fixtures.
}

interface DefectLimit {
  minSeverity: Severity;
  count: number;
  paths?: string[];
  /** Limit only the defects of this rule. */
  rule?: string;
}

interface Expected {
  description: string;
  mustFind: Expectation[];
  mustNotFind: Expectation[];
  /** Control pages (all pages when `paths` is omitted) may have at most `count` defects at or above minSeverity. */
  maxDefects?: DefectLimit | DefectLimit[];
  /** Text the recommendation of a finding must contain (e.g. locked-brand guidance). */
  recommendations?: { rule: string; path: string; includes: string }[];
  /** Expected source file for a rule (root-cause location accuracy). */
  sources?: { rule: string; path: string; file: string }[];
  /** Audit settings for this fixture (a static fixture is disposable, so real submissions are allowed). */
  audit?: { allowSubmit?: boolean; maxPages?: number };
}

export interface FixtureResult {
  fixture: string;
  found: number;
  expected: number;
  missed: Expectation[];
  falsePositives: { rule: string; path: string; why?: string }[];
  excessDefects: { rule: string; path: string; severity: Severity }[];
  sourceHits: number;
  sourceExpected: number;
  sourceMisses: { rule: string; path: string; file: string; got: string[] }[];
  findings: number;
  seconds: number;
}

const benchPath = (url: string) => pathOf(url).split('?')[0]!.replace(/\/$/, '');

const samePages = (f: Finding, want: string[]) => {
  const got = new Set(pagesOf(f).map((u) => benchPath(u) || '/'));
  const norm = new Set(want.map((p) => p.replace(/\/$/, '') || '/'));
  return got.size === norm.size && [...norm].every((p) => got.has(p));
};

/** A finding collapsed over several pages (F44) matches an expectation on any of its pages. */
export const benchMatches = (f: Finding, e: Expectation) =>
  f.ruleId === e.rule &&
  (!e.kind || f.kind === e.kind) &&
  pagesOf(f).some((u) => benchPath(u) === e.path.replace(/\/$/, '')) &&
  (!e.viewport || (f.viewport ?? '').split(', ').includes(e.viewport)) &&
  (!e.pagesExactly || samePages(f, e.pagesExactly));

export async function benchFixture(dir: string, wsRoot: string): Promise<FixtureResult> {
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected;
  const server = await serveStatic(dir);
  const t0 = Date.now();
  try {
    const { Workspace } = await import('../../core/workspace.js');
    const ws = new Workspace(wsRoot);
    const { run } = await runAudit(ws, {
      target: server.url,
      viewports: parseViewports('desktop,mobile'),
      maxPages: expected.audit?.maxPages ?? 8,
      maxDepth: 3,
      browser: 'chromium',
      headed: false,
      respectRobots: true,
      allowPrivate: false,
      allowSubmit: expected.audit?.allowSubmit === true,
      keyboard: true,
      throttle: false,
      timeoutMs: 30_000,
      mask: [],
      mode: 'repository',
      context: loadContext(dir),
    });
    await locateFindings(run, dir);
    const evidenceOk = (f: Finding, e: Expectation) => {
      if (!e.evidenceExactly) return true;
      const texts = f.evidence.map((ev) => `${ev.snippet ?? ''} ${ev.selector ?? ''}`);
      return (
        texts.length > 0 &&
        texts.every((t) => e.evidenceExactly!.some((n) => t.includes(n))) &&
        e.evidenceExactly.every((n) => texts.some((t) => t.includes(n)))
      );
    };
    const missed = expected.mustFind.filter(
      (e) => !run.findings.some((f) => benchMatches(f, e) && evidenceOk(f, e)),
    );
    for (const r of expected.recommendations ?? []) {
      const f = run.findings.find((x) => benchMatches(x, r));
      if (!f?.recommendation.includes(r.includes))
        missed.push({ rule: r.rule, path: r.path, why: `recommendation should include "${r.includes}"` });
    }
    const falsePositives = expected.mustNotFind
      .filter((e) => run.findings.some((f) => benchMatches(f, e) && evidenceOk(f, e)))
      .map((e) => ({ rule: e.rule, path: e.path, ...(e.why ? { why: e.why } : {}) }));
    const limits = expected.maxDefects ? [expected.maxDefects].flat() : [];
    const excessDefects: FixtureResult['excessDefects'] = [];
    for (const lim of limits) {
      const over: FixtureResult['excessDefects'] = [];
      for (const f of run.findings) {
        if (f.kind !== 'defect' || severityRank(f.severity) > severityRank(lim.minSeverity)) continue;
        if (lim.rule && f.ruleId !== lim.rule) continue;
        if (lim.paths && !pagesOf(f).some((u) => lim.paths!.includes(benchPath(u) || '/'))) continue;
        over.push({ rule: f.ruleId, path: pathOf(f.url), severity: f.severity });
      }
      excessDefects.push(...over.slice(0, Math.max(0, over.length - lim.count)));
    }
    const sourceMisses: FixtureResult['sourceMisses'] = [];
    for (const s of expected.sources ?? []) {
      const f = run.findings.find((x) => benchMatches(x, { rule: s.rule, path: s.path }));
      const got = f?.sources?.map((x) => x.file) ?? [];
      if (got[0] !== s.file) sourceMisses.push({ ...s, got });
    }
    return {
      fixture: dir.split(/[\\/]/).pop()!,
      found: expected.mustFind.length - missed.length,
      expected: expected.mustFind.length,
      missed,
      falsePositives,
      excessDefects,
      sourceHits: (expected.sources?.length ?? 0) - sourceMisses.length,
      sourceExpected: expected.sources?.length ?? 0,
      sourceMisses,
      findings: run.findings.length,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
    };
  } finally {
    await server.close();
  }
}

export const bench: Command = {
  name: 'bench',
  summary:
    'Benchmark detection quality on fixture sites with known defects (recall, false positives, source accuracy).',
  usage:
    'jourilo bench [fixtures-dir=fixtures/sites] [--only name] [--record docs/evaluation/bench-history.jsonl]',
  options: { only: { type: 'string' }, record: { type: 'string' } },
  async run(ctx) {
    const root = resolve(ctx.positionals[0] ?? 'fixtures/sites');
    if (!existsSync(root)) throw new JouriloError('NOT_FOUND', `No fixtures at ${root}`);
    const only = str(ctx, 'only');
    const dirs = readdirSync(root)
      .filter((d) => existsSync(join(root, d, 'expected.json')))
      .filter((d) => !only || d === only);
    if (!dirs.length) throw new JouriloError('NOT_FOUND', `No fixtures with expected.json in ${root}`);
    const results: FixtureResult[] = [];
    for (const d of dirs) {
      ctx.log(`bench: ${d}`);
      results.push(await benchFixture(join(root, d), join(ctx.ws.root, 'bench')));
    }
    const found = results.reduce((a, r) => a + r.found, 0);
    const expected = results.reduce((a, r) => a + r.expected, 0);
    const fp = results.reduce((a, r) => a + r.falsePositives.length + r.excessDefects.length, 0);
    const srcHit = results.reduce((a, r) => a + r.sourceHits, 0);
    const srcExp = results.reduce((a, r) => a + r.sourceExpected, 0);
    const summary = {
      version: VERSION,
      date: new Date().toISOString(),
      recall: expected ? Math.round((found / expected) * 1000) / 1000 : 1,
      found,
      expected,
      falsePositives: fp,
      sourceAccuracy: srcExp ? Math.round((srcHit / srcExp) * 1000) / 1000 : null,
      seconds: Math.round(results.reduce((a, r) => a + r.seconds, 0) * 10) / 10,
    };
    const record = str(ctx, 'record');
    if (record) {
      const prev = existsSync(record) ? readFileSync(record, 'utf8') : '';
      writeFileSync(
        record,
        `${prev}${JSON.stringify({ ...summary, fixtures: results.map((r) => ({ fixture: r.fixture, found: r.found, expected: r.expected, fp: r.falsePositives.length + r.excessDefects.length, seconds: r.seconds })) })}\n`,
      );
    }
    const lines = [
      `Jourilo ${VERSION} benchmark — recall ${found}/${expected}, false positives ${fp}${srcExp ? `, source location ${srcHit}/${srcExp}` : ''}, ${summary.seconds}s`,
    ];
    for (const r of results) {
      lines.push(
        `  ${r.fixture.padEnd(20)} found ${r.found}/${r.expected}  false+ ${r.falsePositives.length + r.excessDefects.length}  ${r.seconds}s`,
      );
      for (const m of r.missed)
        lines.push(
          `    MISSED   ${m.rule} ${m.path}${m.viewport ? ` [${m.viewport}]` : ''} — ${m.why ?? ''}`,
        );
      for (const m of r.falsePositives) lines.push(`    FALSE+   ${m.rule} ${m.path} — ${m.why ?? ''}`);
      for (const m of r.excessDefects) lines.push(`    FALSE+   ${m.rule} ${m.path} (${m.severity})`);
      for (const m of r.sourceMisses)
        lines.push(
          `    SOURCE   ${m.rule} ${m.path}: expected ${m.file}, got ${m.got.join(', ') || 'nothing'}`,
        );
    }
    const ok = found === expected && fp === 0 && srcHit === srcExp;
    return { data: { summary, results }, text: lines.join('\n'), exitCode: ok ? 0 : 1 };
  },
};
