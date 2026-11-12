import { existsSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AuditOptions, runAudit, STOP_GRACE_MS } from '../../audit/engine.js';
import { severityRank } from '../../audit/finding.js';
import { exitCodeForOutcome, runOutcome } from '../../audit/outcome.js';
import type { BrowserName } from '../../browser/runtime.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { displayPath } from '../../core/fs-safety.js';
import { isDirectoryTarget, servedPort, serveStatic } from '../../core/static-server.js';
import type { Category, Run, Severity } from '../../core/types.js';
import { loadContext } from '../../integrations/context.js';
import { locateFindings } from '../../repair/locate.js';
import { writeReports } from '../../report/index.js';
import {
  type Command,
  type CommandResult,
  type Context,
  denyLocalFrom,
  flag,
  list,
  maxDurationOption,
  num,
  type OptionSpec,
  pagesOption,
  parseEvidence,
  parseStateOptions,
  requirePositional,
  str,
} from '../framework.js';
import { loadJourneys } from './journeys.js';

export const AUDIT_OPTIONS: OptionSpec = {
  pages: { type: 'string' },
  depth: { type: 'string' },
  viewports: { type: 'string' },
  url: { type: 'string', multiple: true },
  include: { type: 'string', multiple: true },
  browser: { type: 'string' },
  headed: { type: 'boolean' },
  'no-keyboard': { type: 'boolean' },
  throttle: { type: 'boolean' },
  'ignore-robots': { type: 'boolean' },
  'allow-private': { type: 'boolean' },
  'deny-local': { type: 'boolean' },
  mask: { type: 'string', multiple: true },
  auth: { type: 'string' },
  locale: { type: 'string' },
  timezone: { type: 'string' },
  clock: { type: 'string' },
  'setup-journey': { type: 'string' },
  timeout: { type: 'string' },
  repo: { type: 'string' },
  sarif: { type: 'boolean' },
  'no-forms': { type: 'boolean' },
  'allow-submit': { type: 'boolean' },
  brand: { type: 'string' },
  runs: { type: 'string' },
  'fail-on': { type: 'string' },
  'max-duration': { type: 'string' },
  'run-id': { type: 'string' },
  evidence: { type: 'string' },
};

const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const BROWSERS: BrowserName[] = ['chromium', 'firefox', 'webkit', 'chrome', 'msedge'];

/** The line a second stop signal leaves before the process quits (JSON with --json, like other errors). */
export function stoppedTwiceLine(json: boolean): string {
  const message = 'A second stop signal: quitting at once (exit 130). No run was written for this audit.';
  return json
    ? `${JSON.stringify({ type: 'error', error: { code: 'STOPPED_TWICE', message } })}\n`
    : `jourilo: ${message}\n`;
}

/**
 * The first SIGINT/SIGTERM, or the end of the --max-duration budget, stops the audit with a partial run: the page in
 * progress gets STOP_GRACE_MS to finish, then it is abandoned. A second signal exits at once, after one line on
 * stderr. `dispose` removes the handlers and the timer, so they never outlive the command.
 */
function stopController(ctx: Context, maxDurationS: number | undefined) {
  const controller = new AbortController();
  const grace = `${STOP_GRACE_MS / 1000} s`;
  let signals = 0;
  const onSignal = () => {
    if (++signals > 1) {
      // Synchronous: the line must be on stderr before the process ends.
      writeSync(2, stoppedTwiceLine(ctx.json));
      process.exit(130);
    }
    ctx.log(
      `Stopping: the page in progress gets up to ${grace} to finish, then a partial run is written (signal again to quit now) …`,
    );
    controller.abort('signal');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const timer = maxDurationS
    ? setTimeout(() => {
        ctx.log(
          `--max-duration ${maxDurationS}s reached: the page in progress gets up to ${grace} to finish, then a partial run is written …`,
        );
        controller.abort('max-duration');
      }, maxDurationS * 1000)
    : undefined;
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      clearTimeout(timer);
    },
  };
}

export async function auditCommand(
  ctx: Context,
  usage: string,
  categories?: Category[],
): Promise<CommandResult> {
  const targetArg = requirePositional(ctx, 0, 'url|dir', usage);
  const browser = (str(ctx, 'browser') ?? 'chromium') as BrowserName;
  if (!BROWSERS.includes(browser))
    throw new JouriloError('USAGE', `--browser must be one of ${BROWSERS.join(', ')}.`);
  const failOn = str(ctx, 'fail-on') as Severity | undefined;
  if (failOn && !SEVERITIES.includes(failOn))
    throw new JouriloError('USAGE', `--fail-on must be one of ${SEVERITIES.join(', ')}.`);
  const state = parseStateOptions(ctx);
  const auth = str(ctx, 'auth');
  if (auth && !existsSync(auth)) throw new JouriloError('NOT_FOUND', `Auth state file not found: ${auth}`);

  const maxDuration = maxDurationOption(ctx);
  const maxPages = pagesOption(ctx, 6);

  const evidence = parseEvidence(ctx);
  const setupRef = str(ctx, 'setup-journey');
  const setupJourney = setupRef ? loadJourneys(ctx.ws, [setupRef])[0] : undefined;

  const stop = stopController(ctx, maxDuration);
  let server: Awaited<ReturnType<typeof serveStatic>> | undefined;
  try {
    const isDir = isDirectoryTarget(targetArg);
    server = isDir ? await serveStatic(resolve(targetArg)) : undefined;
    const repo = str(ctx, 'repo') ?? (isDir ? resolve(targetArg) : undefined);
    const opts: AuditOptions = {
      target: server ? server.url : targetArg,
      viewports: parseViewports(str(ctx, 'viewports')),
      maxPages,
      maxDepth: num(ctx, 'depth', 3),
      browser,
      headed: flag(ctx, 'headed'),
      respectRobots: !flag(ctx, 'ignore-robots'),
      allowPrivate: flag(ctx, 'allow-private'),
      ...(denyLocalFrom(ctx)
        ? { denyLocal: true, ...(server ? { servedPort: servedPort(server) } : {}) }
        : {}),
      keyboard: !flag(ctx, 'no-keyboard'),
      throttle: flag(ctx, 'throttle'),
      runs: num(ctx, 'runs', 1),
      timeoutMs: num(ctx, 'timeout', 30) * 1000,
      mask: list(ctx, 'mask'),
      urls: list(ctx, 'url'),
      include: list(ctx, 'include'),
      ...(auth ? { storageState: auth } : {}),
      ...(str(ctx, 'locale') ? { locale: str(ctx, 'locale')! } : {}),
      ...state,
      ...(setupJourney ? { setupJourney } : {}),
      ...(evidence ? { evidence } : {}),
      ...(categories ? { categories } : {}),
      context: loadContext(repo ?? process.cwd(), str(ctx, 'brand') ? { brand: str(ctx, 'brand')! } : {}),
      ...(str(ctx, 'run-id') !== undefined ? { runId: str(ctx, 'run-id')! } : {}),
      mode: repo ? 'repository' : 'website',
      forms: !flag(ctx, 'no-forms'),
      allowSubmit: flag(ctx, 'allow-submit'),
      onProgress: ctx.log,
      signal: stop.signal,
    };
    if (
      flag(ctx, 'ignore-robots') &&
      !server &&
      !/^(localhost|127\.|\[::1\])/.test(
        new URL(opts.target.includes('://') ? opts.target : `https://${opts.target}`).hostname,
      )
    ) {
      ctx.log('Note: --ignore-robots is only appropriate for sites you own or are authorized to test.');
    }
    const { run, runDir } = await runAudit(ctx.ws, opts);
    if (server) {
      run.target = `${displayPath(resolve(targetArg))} (served at ${server.url})`;
      run.settings.servedDir = resolve(targetArg);
    }
    if (repo) run.settings.repo = repo;
    if (repo) {
      const located = locateFindings(run, repo);
      ctx.log(`Mapped ${located} finding(s) to likely source locations in ${repo}`);
    }
    run.outcome = runOutcome(run);
    ctx.ws.saveRun(run);
    const reports = writeReports(runDir, run, undefined, {
      sarif: flag(ctx, 'sarif'),
      history: ctx.ws.listRuns(),
    });
    const gate = failOn
      ? run.findings.some((f) => f.kind === 'defect' && severityRank(f.severity) <= severityRank(failOn))
      : false;
    return {
      data: {
        runId: run.id,
        outcome: run.outcome,
        ...(run.stoppedBy ? { stoppedBy: run.stoppedBy } : {}),
        runDir,
        reports,
        summary: run.summary,
        findings: run.findings,
        limitations: run.limitations,
        gateFailed: gate,
      },
      text: summaryText(run, reports.html),
      exitCode: exitCodeForOutcome(run.outcome, gate),
    };
  } finally {
    stop.dispose();
    await server?.close();
  }
}

export function summaryText(run: Run, reportPath: string): string {
  const s = run.summary;
  const lines = [
    '',
    ...partialLines(run),
    ...noPageLines(run),
    `Jourilo · ${run.target}`,
    `  ${s.byKind.defect} defects   critical ${s.findings.critical} · serious ${s.findings.serious} · moderate ${s.findings.moderate} · minor ${s.findings.minor}`,
    `  ${s.byKind.hypothesis} conversion hypotheses (untested) · ${s.byKind['needs-review']} need manual review`,
    '',
  ];
  const top = run.findings.filter((f) => f.kind === 'defect').slice(0, 8);
  for (const f of top) {
    const p = (() => {
      try {
        return new URL(f.url).pathname;
      } catch {
        return f.url;
      }
    })();
    lines.push(
      `  ${f.severity.toUpperCase().padEnd(9)} ${f.title}${f.occurrences > 1 ? ` ×${f.occurrences}` : ''}  ${p} [${f.viewport}]`,
    );
  }
  if (run.findings.filter((f) => f.kind === 'defect').length > top.length) lines.push('  …');
  lines.push('', `  Report: ${reportPath}`, `  Run id: ${run.id}`, '');
  return lines.join('\n');
}

function partialLines(run: Run): string[] {
  if (run.outcome !== 'partial') return [];
  const stop = run.limitations.find((l) => l.startsWith('The run was stopped early'));
  return [`Partial run: ${stop ?? 'the run was stopped early.'}`, ''];
}

function noPageLines(run: Run): string[] {
  if (run.outcome !== 'no-page-loaded') return [];
  const first = run.findings.find((f) => f.ruleId === 'jourilo/page-unreachable');
  const why = first?.description ?? run.limitations.find((l) => l.includes('could not be resolved'));
  return [`No page could be loaded from ${run.target}.`, ...(why ? [`  ${why}`] : []), ''];
}

export const audit: Command = {
  name: 'audit',
  summary:
    'Audit a website URL or a static build directory in a real browser (accessibility, UX, responsive, performance, reliability, conversion).',
  usage:
    'jourilo audit <url|dir> [--pages 6] [--viewports desktop,mobile] [--url /path ...] [--repo .] [--fail-on serious]',
  options: AUDIT_OPTIONS,
  details: `Options:
  --pages N            Pages to audit after discovery (default 6; 1 = only the target; 0 is a usage error)
  --depth N            Link depth for discovery (default 3)
  --url PATH           Audit exactly these paths/URLs on the target origin (repeatable; skips discovery)
  --include PATH       Add pages to discovery (repeatable)
  --viewports LIST     desktop, laptop, tablet, mobile, reflow (320px) or WIDTHxHEIGHT (default desktop,mobile)
  --browser NAME       chromium (default), firefox, webkit, chrome, msedge
  --headed             Show the browser window instead of running headless
  --locale TAG         Browser locale for every page (e.g. tr-TR); sets Accept-Language and navigator.language
  --timeout SECS       Per-page navigation timeout in seconds (default 30)
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --runs N             Visits per page and viewport for lab metrics; reports the median and range (default 1, max 9)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --timezone ZONE      IANA time zone for every page (e.g. Europe/Istanbul)
  --clock ISO          Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --setup-journey REF  Run this journey first (an id or a .json file) and audit the state it leaves, e.g. a chosen theme or
                       a dismissed banner; it follows the journeys safety policy and starts from --auth
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --deny-local         Refuse local targets (localhost, 127.0.0.1, [::1], *.localhost, *.test), also as a redirect (exit 3);
                       JOURILO_DENY_LOCAL=1 does the same. For hosted integrations; a directory target is still served
  --no-forms           Skip the form validation probe
                       (by default, on local hosts, an empty submission is simulated: nothing that sends data
                       leaves the browser, so no database is written; server-side feedback is reported as untested)
  --allow-submit       Really send empty submissions to test server-side validation, on local or other hosts
                       (disposable/test environments you are authorized to use only; never to delete/payment URLs);
                       also lets a --setup-journey submit forms
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
  --evidence MODE      full (default) or minimal: keep first screens and only the full-page screenshots findings need; JPEG quality 55
  --run-id ID          Use this run id instead of a generated one (1-64 of A-Z a-z 0-9 _ -); refused (exit 2) if its
                       directory exists, even without a run.json (left by a crashed run)
  --max-duration SECS  Stop after this many seconds (1 to 86400) and write a partial run (exit 6), as SIGINT/SIGTERM do;
                       the page in progress gets up to 3 s to finish, then it is left out; a second signal quits at
                       once (exit 130) after one line on stderr (STOPPED_TWICE with --json)`,
  run: (ctx) => auditCommand(ctx, audit.usage),
};

export const accessibility: Command = {
  ...audit,
  name: 'accessibility',
  summary:
    'Accessibility-only audit: axe-core WCAG 2.2 rules, keyboard walk, focus visibility, target size, input purpose.',
  usage: 'jourilo accessibility <url|dir> [audit options]',
  run: (ctx) => auditCommand(ctx, accessibility.usage, ['accessibility']),
};

export const conversion: Command = {
  ...audit,
  name: 'conversion',
  summary:
    'Conversion-focused audit: CTAs, value proposition, trust signals, form friction, pricing clarity (as hypotheses).',
  usage: 'jourilo conversion <url|dir> [audit options]',
  run: (ctx) => auditCommand(ctx, conversion.usage, ['conversion', 'usability']),
};
