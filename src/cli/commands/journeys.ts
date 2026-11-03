import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runAudit, summarize } from '../../audit/engine.js';
import { makeFinding, mergeFindings } from '../../audit/finding.js';
import type { BrowserName } from '../../browser/runtime.js';
import { networkLimitations, openGuardedBrowser } from '../../browser/session.js';
import { parseViewports } from '../../browser/viewports.js';
import { applyDismissals, loadDismissals } from '../../core/dismissals.js';
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
import { wouldBeCommitted } from '../../repair/git.js';
import { locateFindings } from '../../repair/locate.js';
import { writeReports } from '../../report/index.js';
import { type Command, type Context, flag, list, num, parseStateOptions, str } from '../framework.js';

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

/**
 * One result for several attempts of the same journey. All passed → passed; all failed → the first failure; mixed →
 * failed and marked flaky, with a review item that says how often it passed.
 */
export function summarizeAttempts(
  spec: JourneySpec,
  attempts: { result: JourneyResult; findings: Finding[] }[],
): { result: JourneyResult; findings: Finding[] } {
  if (attempts.length === 1) return attempts[0]!;
  const passed = attempts.filter((a) => a.result.status === 'passed').length;
  const rep = attempts.find((a) => a.result.status !== 'passed') ?? attempts[0]!;
  const result: JourneyResult = {
    ...rep.result,
    attempts: attempts.map((a) => ({ status: a.result.status, durationMs: a.result.durationMs })),
    stability: passed === 0 || passed === attempts.length ? 'stable' : 'flaky',
  };
  if (result.stability === 'stable') return { result, findings: rep.findings };
  const findings = [
    ...rep.findings.map((f) => ({ ...f, confidence: 'low' as const })),
    makeFinding({
      ruleId: 'journey/flaky',
      key: spec.id,
      journey: spec.id,
      title: `Journey "${spec.name}" passed ${passed} of ${attempts.length} times`,
      category: 'reliability',
      kind: 'needs-review',
      severity: 'moderate',
      confidence: 'high',
      provenance: 'observed',
      url: rep.result.steps.at(-1)?.url || spec.start,
      viewport: rep.result.viewport,
      description: `The same steps gave different outcomes across ${attempts.length} runs (${attempts.map((a) => a.result.status).join(', ')}). Either the product behaves inconsistently (race conditions, timing, data dependence) or the journey depends on timing; the failing run's evidence is attached to the journey.`,
      impact: 'Intermittent failures reach real users and make before/after comparisons unreliable.',
      recommendation:
        'Compare the failing attempt with a passing one: look for requests that finish in a different order, elements that render late, or data created by an earlier run. Fix the product if it is a race; otherwise make the journey wait for the right state.',
      standards: [],
      evidence: [{ type: 'step', snippet: rep.result.steps.find((s) => s.status !== 'passed')?.error ?? '' }],
      reproduction: [
        `Run the journey ${attempts.length} times: jourilo journeys run ${spec.id} --repeat ${attempts.length}`,
      ],
    }),
  ];
  return { result, findings };
}

async function runCmd(ctx: Context) {
  // Read before any browser work, so a corrupt dismissed.json fails fast instead of losing a finished run.
  const dismissals = loadDismissals(ctx.ws);
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
  const state = parseStateOptions(ctx);
  const isDir = existsSync(baseArg) && !baseArg.includes('://');
  const server = isDir ? await serveStatic(resolve(baseArg)) : undefined;
  try {
    const base = parseTargetUrl(server?.url ?? baseArg);
    const hostClass = await checkTarget(base, { allowPrivate: flag(ctx, 'allow-private') });
    const id = newRunId();
    const runDir = ctx.ws.createRunDir(id);
    const browserName = (str(ctx, 'browser') ?? 'chromium') as BrowserName;
    const session = await openGuardedBrowser(browserName, flag(ctx, 'headed'), {
      target: hostClass,
      allowPrivate: flag(ctx, 'allow-private'),
    });
    const browser = session.browser;
    const browserVersion = browser.version();
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
    const allowOrigins = list(ctx, 'allow-origin').map((o) => {
      const u = parseTargetUrl(o);
      return u.origin;
    });
    const repeat = Math.max(1, Math.min(10, num(ctx, 'repeat', 1)));
    const saveAuthArg = str(ctx, 'save-auth');
    if (saveAuthArg && repeat > 1)
      throw new JouriloError('USAGE', '--save-auth cannot be combined with --repeat.');
    if (saveAuthArg && specs.length !== 1)
      throw new JouriloError('USAGE', '--save-auth needs exactly one journey (the sign-in journey).');
    const saveAuth = saveAuthArg ? resolve(saveAuthArg) : undefined;
    if (saveAuth) {
      limitations.push(
        `Signed-in state saved to ${displayPath(saveAuth)} (owner-only permissions). Treat it like a password; it is a test-account session.`,
      );
      if (wouldBeCommitted(saveAuth)) {
        const warning = `WARNING: ${displayPath(saveAuth)} is inside a git repository and not ignored, so it could be committed with its session cookies. Add it to .gitignore or save it under .jourilo/.`;
        limitations.push(warning);
        ctx.log(warning);
      }
    }
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
          // With --repeat, the same journey runs several times (fresh context and fresh test data each time) and
          // mixed outcomes are reported as flaky instead of trusting one lucky or unlucky run.
          const attempts: { result: JourneyResult; findings: Finding[] }[] = [];
          for (let k = 0; k < repeat; k++) {
            const r = await runJourney(browser, spec, {
              base,
              runDir,
              hostClass,
              policy,
              data: repeat > 1 ? testData(`${id}${k}`, parseVars(ctx)) : data,
              trace: flag(ctx, 'trace') && k === 0,
              stepTimeoutMs: num(ctx, 'timeout', 10) * 1000,
              ...(vp ? { viewportOverride: vp } : {}),
              ...(str(ctx, 'auth') ? { storageState: str(ctx, 'auth')! } : {}),
              ...state,
              ...(saveAuth ? { saveAuth } : {}),
              ...(allowOrigins.length ? { allowOrigins } : {}),
              log: k === 0 ? ctx.log : undefined,
            });
            if (repeat > 1) ctx.log(`  attempt ${k + 1}/${repeat}: ${r.result.status}`);
            attempts.push(r);
          }
          const { result, findings: jf } = summarizeAttempts(spec, attempts);
          ctx.log(
            `  → ${result.status}${result.stability ? ` (${result.stability})` : ''} (${(result.durationMs / 1000).toFixed(1)} s)`,
          );
          journeys.push(result);
          findings.push(...jf);
        }
      }
    } finally {
      await session.close();
    }
    const network = session.report();
    limitations.push(...networkLimitations(network));
    findings = mergeFindings(findings);
    const { kept, dismissed } = applyDismissals(findings, dismissals);
    findings = kept;
    const run: Run = {
      schemaVersion: RUN_SCHEMA_VERSION,
      id,
      tool: { name: 'jourilo', version: VERSION },
      mode: isDir || str(ctx, 'repo') ? 'repository' : 'website',
      target: server ? `${displayPath(resolve(baseArg))} (served at ${server.url})` : base.toString(),
      startedAt,
      finishedAt: new Date().toISOString(),
      browser: { name: browserName, version: browserVersion },
      viewports: parseViewports([...new Set(journeys.map((j) => j.viewport))].join(',') || 'desktop'),
      settings: {
        journeys: specs.map((s) => s.id),
        allowSubmit: policy.allowSubmit,
        allowDestructive: policy.allowDestructive,
        hostClass,
        ...state,
      },
      pages: [],
      journeys,
      findings,
      ...(dismissed.length ? { dismissed } : {}),
      summary: summarize(findings, 0, journeys.length),
      limitations: [
        ...limitations,
        'Journeys prove that a scripted path works (or not) in one browser; they do not measure how real people choose paths.',
      ],
      ...(network.blocked.length || network.escaped.length ? { network } : {}),
    };
    const repo = str(ctx, 'repo') ?? (isDir ? resolve(baseArg) : undefined);
    if (repo) locateFindings(run, repo);
    ctx.ws.saveRun(run);
    const reports = writeReports(runDir, run, undefined, { history: ctx.ws.listRuns() });
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
    'allow-origin': { type: 'string', multiple: true },
    'fail-on-failure': { type: 'boolean' },
    browser: { type: 'string' },
    headed: { type: 'boolean' },
    auth: { type: 'string' },
    repo: { type: 'string' },
    timeout: { type: 'string' },
    pages: { type: 'string' },
    force: { type: 'boolean' },
    'save-auth': { type: 'string' },
    repeat: { type: 'string' },
    timezone: { type: 'string' },
    clock: { type: 'string' },
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
  --allow-origin ORIGIN  Let the page navigate to another origin you are authorized to test (e.g. a test IdP)
  --trace                Record a Playwright trace per journey (contains typed values; keep private)
  --auth FILE            Playwright storage state for signed-in journeys
  --save-auth FILE       After a passing sign-in journey (exactly one), save its session for --auth (test accounts only)
  --timezone ZONE        IANA time zone for the page (e.g. Europe/Istanbul)
  --clock ISO            Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --repeat N             Run each journey N times (max 10); mixed outcomes are reported as flaky
  --fail-on-failure      Exit 1 when a journey fails

Safety: payment, purchase, delete and cancel actions are never performed on non-local hosts; form submission
on non-local hosts needs --allow-submit. The policy is checked twice: on the element about to be clicked or
pressed (its name, link target, form action and identifiers — icon-only buttons included), and on every request
the page then sends (form posts, DELETE, requests to delete/cancel/payment endpoints, navigation to other
origins). Blocked steps are reported, not skipped silently.`,
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
