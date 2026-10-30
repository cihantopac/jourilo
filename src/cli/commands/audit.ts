import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AuditOptions, runAudit } from '../../audit/engine.js';
import { severityRank } from '../../audit/finding.js';
import type { BrowserName } from '../../browser/runtime.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { serveStatic } from '../../core/static-server.js';
import type { Category, Run, Severity } from '../../core/types.js';
import { locateFindings } from '../../repair/locate.js';
import { writeReports } from '../../report/index.js';
import {
  type Command,
  type CommandResult,
  type Context,
  flag,
  list,
  num,
  type OptionSpec,
  requirePositional,
  str,
} from '../framework.js';

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
  mask: { type: 'string', multiple: true },
  auth: { type: 'string' },
  locale: { type: 'string' },
  timeout: { type: 'string' },
  repo: { type: 'string' },
  sarif: { type: 'boolean' },
  'fail-on': { type: 'string' },
};

const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'minor'];
const BROWSERS: BrowserName[] = ['chromium', 'firefox', 'webkit', 'chrome', 'msedge'];

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
  const auth = str(ctx, 'auth');
  if (auth && !existsSync(auth)) throw new JouriloError('NOT_FOUND', `Auth state file not found: ${auth}`);

  const isDir =
    !/^[a-z]+:\/\//i.test(targetArg) && existsSync(targetArg) && statSync(targetArg).isDirectory();
  const server = isDir ? await serveStatic(resolve(targetArg)) : undefined;
  const repo = str(ctx, 'repo') ?? (isDir ? resolve(targetArg) : undefined);
  try {
    const opts: AuditOptions = {
      target: server ? server.url : targetArg,
      viewports: parseViewports(str(ctx, 'viewports')),
      maxPages: num(ctx, 'pages', 6),
      maxDepth: num(ctx, 'depth', 3),
      browser,
      headed: flag(ctx, 'headed'),
      respectRobots: !flag(ctx, 'ignore-robots'),
      allowPrivate: flag(ctx, 'allow-private'),
      keyboard: !flag(ctx, 'no-keyboard'),
      throttle: flag(ctx, 'throttle'),
      timeoutMs: num(ctx, 'timeout', 30) * 1000,
      mask: list(ctx, 'mask'),
      urls: list(ctx, 'url'),
      include: list(ctx, 'include'),
      ...(auth ? { storageState: auth } : {}),
      ...(str(ctx, 'locale') ? { locale: str(ctx, 'locale')! } : {}),
      ...(categories ? { categories } : {}),
      mode: repo ? 'repository' : 'website',
      onProgress: ctx.log,
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
    if (server) run.target = `${resolve(targetArg)} (served at ${server.url})`;
    if (repo) {
      const located = locateFindings(run, repo);
      ctx.log(`Mapped ${located} finding(s) to likely source locations in ${repo}`);
    }
    ctx.ws.saveRun(run);
    const reports = writeReports(runDir, run, undefined, { sarif: flag(ctx, 'sarif') });
    const gate = failOn
      ? run.findings.some((f) => f.kind === 'defect' && severityRank(f.severity) <= severityRank(failOn))
      : false;
    return {
      data: {
        runId: run.id,
        runDir,
        reports,
        summary: run.summary,
        findings: run.findings,
        limitations: run.limitations,
        gateFailed: gate,
      },
      text: summaryText(run, reports.html),
      exitCode: gate ? 1 : 0,
    };
  } finally {
    await server?.close();
  }
}

export function summaryText(run: Run, reportPath: string): string {
  const s = run.summary;
  const lines = [
    '',
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

export const audit: Command = {
  name: 'audit',
  summary:
    'Audit a website URL or a static build directory in a real browser (accessibility, UX, responsive, performance, reliability, conversion).',
  usage:
    'jourilo audit <url|dir> [--pages 6] [--viewports desktop,mobile] [--url /path ...] [--repo .] [--fail-on serious]',
  options: AUDIT_OPTIONS,
  details: `Options:
  --pages N            Pages to audit after discovery (default 6; 1 = only the target)
  --depth N            Link depth for discovery (default 3)
  --url PATH           Audit exactly these paths/URLs on the target origin (repeatable; skips discovery)
  --include PATH       Add pages to discovery (repeatable)
  --viewports LIST     desktop, laptop, tablet, mobile, reflow (320px) or WIDTHxHEIGHT (default desktop,mobile)
  --browser NAME       chromium (default), firefox, webkit, chrome, msedge
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)`,
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
