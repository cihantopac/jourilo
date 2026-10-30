import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runAudit, summarize } from '../../audit/engine.js';
import { mergeFindings } from '../../audit/finding.js';
import { type BrowserName, launchBrowser } from '../../browser/runtime.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { displayPath } from '../../core/fs-safety.js';
import { newRunId } from '../../core/hash.js';
import { serveStatic } from '../../core/static-server.js';
import type { Finding, JourneyResult, Run } from '../../core/types.js';
import { RUN_SCHEMA_VERSION } from '../../core/types.js';
import { checkTarget, parseTargetUrl } from '../../core/url-safety.js';
import { VERSION } from '../../core/version.js';
import type { Workspace } from '../../core/workspace.js';
import { runJourney } from '../../journeys/runner.js';
import { testData } from '../../journeys/safety.js';
import { type JourneySpec, validateJourney } from '../../journeys/schema.js';
import { suggestJourneys } from '../../journeys/suggest.js';
import { locateFindings } from '../../repair/locate.js';
import { writeReports } from '../../report/index.js';
import { type Command, type Context, flag, list, num, str } from '../framework.js';

export function journeysDir(ws: Workspace): string {
  return join(ws.root, 'journeys');
}

export function loadJourneys(ws: Workspace, refs: string[]): JourneySpec[] {
  const dir = journeysDir(ws);
  const files: string[] = [];
  if (!refs.length) {
    if (!existsSync(dir)) return [];
    files.push(
      ...readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => join(dir, f)),
    );
  } else {
    for (const r of refs) {
      if (r.endsWith('.json') && existsSync(r)) files.push(resolve(r));
      else if (existsSync(join(dir, `${r}.json`))) files.push(join(dir, `${r}.json`));
      else throw new JouriloError('NOT_FOUND', `Journey not found: ${r} (looked in ${dir})`);
    }
  }
  return files.map((f) => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(f, 'utf8'));
    } catch (err) {
      throw new JouriloError('INVALID_INPUT', `${basename(f)} is not valid JSON: ${(err as Error).message}`);
    }
    return validateJourney(raw, basename(f));
  });
}

function parseVars(ctx: Context): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (k.startsWith('JOURILO_VAR_') && v) out[k.slice(12).toLowerCase()] = v;
  for (const kv of list(ctx, 'var')) {
    const i = kv.indexOf('=');
    if (i < 1) throw new JouriloError('USAGE', `--var must be key=value (got ${kv})`);
    out[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return out;
}

async function suggest(ctx: Context) {
  const target = ctx.positionals[1];
  let run: Run;
  if (!target || ctx.ws.listRuns().some((r) => r.id === target) || target === 'latest') {
    run = ctx.ws.loadRun(target ?? 'latest').run;
  } else {
    const isDir = existsSync(target) && !target.includes('://');
    const server = isDir ? await serveStatic(resolve(target)) : undefined;
    try {
      ctx.log('Discovering pages to derive journeys (no audit rules applied) …');
      run = (
        await runAudit(ctx.ws, {
          target: server?.url ?? target,
          viewports: parseViewports('desktop'),
          maxPages: num(ctx, 'pages', 8),
          maxDepth: 3,
          browser: 'chromium',
          headed: false,
          respectRobots: true,
          allowPrivate: flag(ctx, 'allow-private'),
          keyboard: false,
          throttle: false,
          timeoutMs: 30_000,
          mask: [],
          forms: false,
          mode: isDir ? 'repository' : 'website',
          onProgress: ctx.log,
        })
      ).run;
    } finally {
      await server?.close();
    }
  }
  const specs = suggestJourneys(run);
  const dir = journeysDir(ctx.ws);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const kept: string[] = [];
  for (const s of specs) {
    const file = join(dir, `${s.id}.json`);
    // Never overwrite a journey someone edited; suggestions only fill gaps.
    if (existsSync(file) && !flag(ctx, 'force')) {
      kept.push(s.id);
      continue;
    }
    writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
    written.push(file);
  }
  return {
    data: { journeys: specs, written, kept, dir },
    text: [
      `Suggested ${specs.length} journey(s) from run ${run.id} → ${dir}`,
      ...specs.map(
        (s) =>
          `  ${s.id.padEnd(32)} ${s.name}${s.safety?.submitsForms ? '  [submits forms]' : ''}${s.safety?.destructive ? '  [destructive]' : ''}`,
      ),
      kept.length ? `  (kept ${kept.length} existing file(s); --force to overwrite)` : '',
      'Review and edit them, then: jourilo journeys run --base <url>',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

async function runCmd(ctx: Context) {
  const baseArg = str(ctx, 'base');
  if (!baseArg)
    throw new JouriloError('USAGE', '--base <url|dir> is required (the site to run journeys against).');
  const specs = loadJourneys(ctx.ws, ctx.positionals.slice(1));
  if (!specs.length)
    throw new JouriloError(
      'NOT_FOUND',
      'No journeys to run.',
      'Create some with `jourilo journeys suggest <url>`.',
    );
  const isDir = existsSync(baseArg) && !baseArg.includes('://');
  const server = isDir ? await serveStatic(resolve(baseArg)) : undefined;
  try {
    const base = parseTargetUrl(server?.url ?? baseArg);
    const hostClass = await checkTarget(base, { allowPrivate: flag(ctx, 'allow-private') });
    const id = newRunId();
    const runDir = ctx.ws.createRunDir(id);
    const browserName = (str(ctx, 'browser') ?? 'chromium') as BrowserName;
    const browser = await launchBrowser(browserName, flag(ctx, 'headed'));
    const startedAt = new Date().toISOString();
    const journeys: JourneyResult[] = [];
    let findings: Finding[] = [];
    const limitations: string[] = [];
    const data = testData(id, parseVars(ctx));
    const policy = {
      hostClass,
      allowSubmit: flag(ctx, 'allow-submit'),
      allowDestructive: flag(ctx, 'allow-destructive'),
    };
    if (policy.allowDestructive && hostClass !== 'local')
      limitations.push(
        '--allow-destructive is ignored on non-local hosts: irreversible and payment actions were blocked.',
      );
    if (flag(ctx, 'trace')) {
      mkdirSync(join(runDir, 'traces'), { recursive: true });
      limitations.push(
        'Playwright traces contain DOM snapshots and typed values: keep them private (they are excluded from git).',
      );
    }
    try {
      const viewports = str(ctx, 'viewport') ? list(ctx, 'viewport') : [undefined];
      for (const spec of specs) {
        for (const vp of viewports) {
          ctx.log(`journey ${spec.id}${vp ? ` (${vp})` : ''}`);
          const { result, findings: jf } = await runJourney(browser, spec, {
            base,
            runDir,
            hostClass,
            policy,
            data,
            trace: flag(ctx, 'trace'),
            stepTimeoutMs: num(ctx, 'timeout', 10) * 1000,
            ...(vp ? { viewportOverride: vp } : {}),
            ...(str(ctx, 'auth') ? { storageState: str(ctx, 'auth')! } : {}),
            log: ctx.log,
          });
          ctx.log(`  → ${result.status} (${(result.durationMs / 1000).toFixed(1)} s)`);
          journeys.push(result);
          findings.push(...jf);
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
    findings = mergeFindings(findings);
    const run: Run = {
      schemaVersion: RUN_SCHEMA_VERSION,
      id,
      tool: { name: 'jourilo', version: VERSION },
      mode: isDir || str(ctx, 'repo') ? 'repository' : 'website',
      target: server ? `${displayPath(resolve(baseArg))} (served at ${server.url})` : base.toString(),
      startedAt,
      finishedAt: new Date().toISOString(),
      browser: { name: browserName, version: '' },
      viewports: parseViewports([...new Set(journeys.map((j) => j.viewport))].join(',') || 'desktop'),
      settings: {
        journeys: specs.map((s) => s.id),
        allowSubmit: policy.allowSubmit,
        allowDestructive: policy.allowDestructive,
        hostClass,
      },
      pages: [],
      journeys,
      findings,
      summary: summarize(findings, 0, journeys.length),
      limitations: [
        ...limitations,
        'Journeys prove that a scripted path works (or not) in one browser; they do not measure how real people choose paths.',
      ],
    };
    const repo = str(ctx, 'repo') ?? (isDir ? resolve(baseArg) : undefined);
    if (repo) locateFindings(run, repo);
    ctx.ws.saveRun(run);
    const reports = writeReports(runDir, run);
    const failed = journeys.filter((j) => j.status === 'failed').length;
    return {
      data: { runId: id, runDir, reports, journeys, findings },
      text: [
        '',
        ...journeys.map(
          (j) =>
            `  ${j.status === 'passed' ? '✓' : j.status === 'blocked' ? '⛔' : '✗'} ${j.name} [${j.viewport}] ${j.status}${
              j.status !== 'passed'
                ? ` — ${
                    j.steps.find((s) => s.status === 'failed' || s.status === 'blocked')?.error ??
                    j.successCriteria
                      .filter((c) => !c.met)
                      .map((c) => `${c.description}: ${c.detail ?? ''}`)
                      .join('; ')
                  }`
                : ''
            }`,
        ),
        '',
        `  Report: ${reports.html}`,
        `  Run id: ${id}`,
      ].join('\n'),
      exitCode: failed && flag(ctx, 'fail-on-failure') ? 1 : 0,
    };
  } finally {
    await server?.close();
  }
}

export const journeys: Command = {
  name: 'journeys',
  summary:
    'Discover, list, validate and run user journeys (reusable scenarios with explicit success criteria).',
  usage: 'jourilo journeys <suggest [url|dir|run]|list|validate [files]|run [ids] --base <url|dir>>',
  options: {
    base: { type: 'string' },
    viewport: { type: 'string' },
    var: { type: 'string', multiple: true },
    trace: { type: 'boolean' },
    'allow-submit': { type: 'boolean' },
    'allow-destructive': { type: 'boolean' },
    'allow-private': { type: 'boolean' },
    'fail-on-failure': { type: 'boolean' },
    browser: { type: 'string' },
    headed: { type: 'boolean' },
    auth: { type: 'string' },
    repo: { type: 'string' },
    timeout: { type: 'string' },
    pages: { type: 'string' },
    force: { type: 'boolean' },
  },
  details: `Subcommands:
  suggest [url|dir|run]  Derive journeys from a site (or an existing run) into .jourilo/journeys/*.json
  list                   List journey files
  validate [files]       Check journey files against the schema
  run [ids|files]        Run journeys against --base <url|dir>

Run options:
  --viewport LIST        desktop, mobile, … (default: the journey's own viewport or desktop)
  --var key=value        Test data for {{key}} placeholders (also JOURILO_VAR_KEY env vars)
  --allow-submit         Allow form submission on non-local hosts (authorized test environments only)
  --allow-destructive    Allow irreversible/payment actions — local hosts with sandbox data only
  --trace                Record a Playwright trace per journey (contains typed values; keep private)
  --auth FILE            Playwright storage state for signed-in journeys
  --fail-on-failure      Exit 1 when a journey fails

Safety: payment, purchase, delete and cancel actions are never performed on non-local hosts; form submission
on non-local hosts needs --allow-submit. Blocked steps are reported, not skipped silently.`,
  async run(ctx) {
    const sub = ctx.positionals[0] ?? 'list';
    if (sub === 'suggest') return suggest(ctx);
    if (sub === 'run') return runCmd(ctx);
    if (sub === 'list' || sub === 'validate') {
      const specs = loadJourneys(ctx.ws, ctx.positionals.slice(1));
      return {
        data: specs,
        text: specs.length
          ? `${specs.length} valid journey(s):\n${specs.map((s) => `  ${s.id.padEnd(32)} ${s.steps.length} steps, ${s.success.length} criteria  ${s.name}`).join('\n')}`
          : `No journeys in ${journeysDir(ctx.ws)}. Create some with \`jourilo journeys suggest <url>\`.`,
      };
    }
    throw new JouriloError('USAGE', `Unknown subcommand "${sub}".`, `Usage: ${journeys.usage}`);
  },
};
