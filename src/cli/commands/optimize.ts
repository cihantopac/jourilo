import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAudit } from '../../audit/engine.js';
import { exitCodeForOutcome, runOutcome } from '../../audit/outcome.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { displayPath } from '../../core/fs-safety.js';
import { redactedQueryPaths } from '../../core/redact.js';
import { isDirectoryTarget, servedPort, serveStatic } from '../../core/static-server.js';
import { loadContext } from '../../integrations/context.js';
import type { JourneySpec } from '../../journeys/schema.js';
import { unifiedDiff } from '../../repair/diff.js';
import { composeEdits, planFixes } from '../../repair/fixes.js';
import {
  type Checkpoint,
  createCheckpoint,
  diffSince,
  loadCheckpoint,
  markRolledBack,
  rollbackCheckpoint,
} from '../../repair/git.js';
import { locateFindings } from '../../repair/locate.js';
import {
  applyTransaction,
  isTransaction,
  previewRollback,
  rollbackTransaction,
} from '../../repair/transaction.js';
import { compareRuns, type MetricDelta } from '../../report/compare.js';
import { writeReports } from '../../report/index.js';
import {
  type Command,
  chromiumSandboxFrom,
  denyLocalFrom,
  flag,
  list,
  NETWORK_OPTIONS,
  networkFrom,
  networkOptionsHelp,
  refuseDenyLocalWebkit,
  str,
} from '../framework.js';
import { loadJourneys } from './journeys.js';

export const optimize: Command = {
  name: 'optimize',
  summary:
    'Plan (and with --apply, make) minimal source fixes for located findings; shows diffs, writes one reversible change.',
  usage: 'jourilo optimize [run=latest] --repo <path> [--rule id ...] [--apply]',
  options: {
    repo: { type: 'string' },
    rule: { type: 'string', multiple: true },
    finding: { type: 'string', multiple: true },
    apply: { type: 'boolean' },
  },
  details: `Deterministic fixers (others are reported with source candidates for a person or agent to fix):
  axe/html-has-lang, jourilo/missing-viewport-meta, jourilo/input-purpose, jourilo/focus-visible, jourilo/paste-blocked,
  jourilo/unsized-images, jourilo/placeholder-label, jourilo/button-implicit-submit, jourilo/focus-obscured
Options:
  --repo PATH      Repository to fix (default: the run's repo, else the current directory)
  --rule ID        Only fix findings of this rule (repeatable)
  --finding ID     Only fix this finding, by fingerprint (repeatable)
  --apply          Write the changes
Without --apply nothing is written. With --apply, all files are written as one change: each file must be unchanged
since the plan, writes are atomic, an interrupted apply is undone, and \`jourilo rollback <id>\` restores the files
(git is not required).
Afterwards run \`jourilo verify <run>\` to repeat the audit and compare.`,
  async run(ctx) {
    const { run, dir } = ctx.ws.loadRun(ctx.positionals[0] ?? 'latest');
    const repo = resolve(str(ctx, 'repo') ?? (run.settings.repo as string | undefined) ?? '.');
    if (!existsSync(repo)) throw new JouriloError('NOT_FOUND', `Repository not found: ${repo}`);
    if (run.findings.every((f) => !f.sources)) await locateFindings(run, repo);
    const rules = list(ctx, 'rule');
    const only = list(ctx, 'finding');
    const selected = run.findings.filter(
      (f) => (!rules.length || rules.includes(f.ruleId)) && (!only.length || only.includes(f.fingerprint)),
    );
    const plans = planFixes(selected, repo);
    const manual = selected.filter(
      (f) => f.kind === 'defect' && !plans.some((p) => p.fingerprint === f.fingerprint),
    );
    const diffs = plans.map((p) => ({
      ...p,
      diff: p.edits.map((e) => unifiedDiff(e.file, e.before, e.after)).join(''),
    }));
    const lines = [`${plans.length} deterministic fix(es) for run ${run.id} in ${repo}`];
    for (const d of diffs)
      lines.push(
        '',
        `## ${d.title} (${d.ruleId}, ${d.fingerprint})`,
        d.explanation,
        `Expected effect: ${d.expectedEffect}`,
        ...d.assumptions.map((a) => `Assumption: ${a}`),
        d.diff,
      );
    let checkpoint: string | null = null;
    if (flag(ctx, 'apply') && plans.length) {
      const edits = composeEdits(plans);
      const tx = applyTransaction(
        repo,
        ctx.ws.root,
        edits.map((e) => ({
          file: e.file,
          before: Buffer.from(e.before, 'utf8'),
          after: Buffer.from(e.after, 'utf8'),
        })),
        {
          note: `optimize run ${run.id}`,
        },
      );
      checkpoint = tx.id;
      const outDir = join(ctx.ws.root, 'fixes');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        join(outDir, `${run.id}.json`),
        `${JSON.stringify({ run: run.id, checkpoint, applied: plans.map((p) => ({ fingerprint: p.fingerprint, ruleId: p.ruleId, title: p.title, files: p.edits.map((e) => e.file) })) }, null, 2)}\n`,
      );
      lines.push(
        `Applied ${plans.length} fix(es) to ${edits.length} file(s) as change ${checkpoint} (undo: jourilo rollback ${checkpoint} --yes).`,
        `Next: jourilo verify ${run.id}`,
      );
    } else if (plans.length) {
      lines.push('Dry run: nothing written. Re-run with --apply to make these changes.');
    }
    lines.push(
      '',
      `${manual.length} other defect(s) need a person or agent; source candidates are in the report (${join(dir, 'report.html')}).`,
    );
    return {
      data: {
        run: run.id,
        repo,
        applied: flag(ctx, 'apply'),
        checkpoint,
        fixes: diffs.map(({ edits, ...rest }) => ({ ...rest, files: edits.map((e) => e.file) })),
        manual: manual.map((f) => ({
          fingerprint: f.fingerprint,
          ruleId: f.ruleId,
          title: f.title,
          url: f.url,
          sources: f.sources ?? [],
        })),
      },
      text: lines.join('\n'),
    };
  },
};

function metricSummary(metrics: MetricDelta[]): string[] {
  if (!metrics.length) return [];
  const n = (v: MetricDelta['verdict']) => metrics.filter((m) => m.verdict === v);
  const lines = [
    `  lab metrics: ${n('improved').length} improved · ${n('regressed').length} regressed · ${n('noise').length} within noise · ${n('unconfirmed').length} unconfirmed`,
    ...[...n('improved'), ...n('regressed')].map(
      (m) =>
        `    ${m.verdict === 'improved' ? '↓' : '↑'} ${m.name} ${new URL(m.url).pathname} (${m.viewport}): ${m.before} → ${m.after}`,
    ),
  ];
  if (n('unconfirmed').length)
    lines.push(
      '    Unconfirmed changes come from single visits; repeat with `jourilo audit … --runs 5` to confirm.',
    );
  return lines;
}

/** A `verify --target` that is not a directory must be an http(s) URL; anything else is a typo, not a crash. */
function verifyTargetUrl(target: string): URL {
  const hint = 'Give a directory to serve, or a URL that starts with http:// or https://.';
  if (existsSync(target))
    throw new JouriloError('INVALID_INPUT', `--target ${target} is a file, not a directory or a URL.`, hint);
  let url: URL | undefined;
  try {
    url = new URL(target);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname)
    throw new JouriloError(
      'INVALID_INPUT',
      `--target ${target} is neither an existing directory nor an http(s) URL.`,
      hint,
    );
  return url;
}

export const verify: Command = {
  name: 'verify',
  summary:
    'Repeat a run with the same scope (pages, viewports) after a change and compare: fixed, new, persisting, metric deltas.',
  usage: 'jourilo verify <baseline-run> [--target url|dir] [--fail-on-regression]',
  options: {
    target: { type: 'string' },
    'fail-on-regression': { type: 'boolean' },
    'deny-local': { type: 'boolean' },
    repo: { type: 'string' },
    ...NETWORK_OPTIONS,
  },
  details: `Options:
  --target URL|DIR       Where to repeat the audit (default: the baseline run's target)
  --repo PATH            Repository for source mapping (default: the baseline run's repo)
  --deny-local           Refuse a local target (localhost, 127.0.0.1, [::1], *.localhost, *.test) with exit 3; a redirect to one is blocked by the network guard and listed in the limitations;
                         JOURILO_DENY_LOCAL=1 does the same. Not available with --browser webkit (exit 3)
${networkOptionsHelp(25)}
                         Without --allow-hosts / --block-hosts, the baseline run's lists are used again; so are its
                         --user-agent and --ignore-https-errors. Header values are never stored: a baseline that sent
                         --extra-header needs the headers again (exit 2 without them)
  --fail-on-regression   Exit 1 when new serious or critical defects appear`,
  async run(ctx) {
    // An explicit --target replaces the baseline's served directory, so a URL target is not ignored.
    const target = str(ctx, 'target');
    const targetDir = target !== undefined && isDirectoryTarget(target);
    const targetUrl = target !== undefined && !targetDir ? verifyTargetUrl(target) : undefined;
    const base = ctx.ws.loadRun(ctx.positionals[0] ?? 'latest').run;
    refuseDenyLocalWebkit(denyLocalFrom(ctx), String(base.browser.name ?? 'chromium'));
    const scope = base.settings.scope as { urls: string[]; viewports: string[] } | undefined;
    if (!scope)
      throw new JouriloError(
        'INVALID_INPUT',
        `Run ${base.id} has no recorded scope (created by an older version or by journeys).`,
      );
    const unreplayable = redactedQueryPaths(scope.urls);
    if (unreplayable.length)
      throw new JouriloError(
        'USAGE',
        `The baseline run's scope contains URLs whose query values were redacted (${unreplayable.map((p) => `${p}?…`).join(', ')}); they cannot be replayed. Run a new audit of those pages and verify against it.`,
      );
    const servedDir =
      target !== undefined
        ? targetDir
          ? resolve(target)
          : undefined
        : (base.settings.servedDir as string | undefined);
    const server = servedDir ? await serveStatic(servedDir) : undefined;
    try {
      const origin = server?.url ?? (targetUrl ?? new URL(scope.urls[0]!)).origin;
      const urls = scope.urls.map((u) => {
        const x = new URL(u);
        return `${x.pathname}${x.search}`;
      });
      const repo = str(ctx, 'repo') ?? (base.settings.repo as string | undefined);
      // The same host lists as the baseline unless given again; the proxy comes from --proxy or the environment.
      const network = networkFrom(ctx, origin);
      const recorded = (key: string) =>
        Array.isArray(base.settings[key]) ? (base.settings[key] as string[]) : undefined;
      const allowHosts = network.allowHosts ?? recorded('allowHosts');
      const blockHosts = network.blockHosts ?? recorded('blockHosts');
      // The baseline's user agent and certificate setting are replayed; header values were never stored, so headers
      // the baseline sent must be given again, or the pages compared would not be the same (e.g. a gated staging site).
      const userAgent =
        network.userAgent ??
        (typeof base.settings.userAgent === 'string' ? base.settings.userAgent : undefined);
      const ignoreHttpsErrors = network.ignoreHttpsErrors ?? base.settings.ignoreHttpsErrors === true;
      const baselineHeaders = recorded('extraHeaders');
      if (baselineHeaders?.length && !network.extraHeaders)
        throw new JouriloError(
          'USAGE',
          `Run ${base.id} sent extra headers (${baselineHeaders.join(', ')}); their values are not stored, so give them again with --extra-header.`,
          `Example: --extra-header "${baselineHeaders[0]}: <value>"`,
        );
      // Replay the state the baseline was audited in, or the comparison would be against the default state.
      const setupId = base.settings.setupJourney as string | undefined;
      let setupJourney: JourneySpec | undefined;
      if (setupId) {
        try {
          setupJourney = loadJourneys(ctx.ws, [setupId])[0];
        } catch (err) {
          throw new JouriloError(
            'INVALID_INPUT',
            `Run ${base.id} was audited after setup journey "${setupId}", which cannot be loaded now: ${(err as Error).message}`,
            'Restore the journey file, or audit again without it.',
          );
        }
      }
      const { run, runDir } = await runAudit(ctx.ws, {
        target: origin,
        urls,
        viewports: parseViewports(scope.viewports.join(',')),
        maxPages: urls.length,
        maxDepth: 1,
        browser: (base.browser.name as never) ?? 'chromium',
        headed: false,
        respectRobots: base.settings.respectRobots !== false,
        allowPrivate: base.settings.hostClass === 'private',
        ...(denyLocalFrom(ctx)
          ? { denyLocal: true, ...(server ? { servedPort: servedPort(server) } : {}) }
          : {}),
        ...(network.upstream ? { upstream: network.upstream } : {}),
        ...(allowHosts ? { allowHosts } : {}),
        ...(blockHosts ? { blockHosts } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(network.extraHeaders ? { extraHeaders: network.extraHeaders } : {}),
        ...(ignoreHttpsErrors ? { ignoreHttpsErrors: true } : {}),
        ...(chromiumSandboxFrom(ctx, String(base.browser.name ?? 'chromium'))
          ? { chromiumSandbox: true }
          : {}),
        keyboard: base.settings.keyboard !== false,
        throttle: base.settings.throttle === true,
        // Same number of visits as the baseline, so medians are compared with medians.
        runs: typeof base.settings.runs === 'number' ? base.settings.runs : 1,
        timeoutMs: 30_000,
        mask: [],
        mode: base.mode,
        ...(typeof base.settings.timezoneId === 'string' ? { timezoneId: base.settings.timezoneId } : {}),
        ...(typeof base.settings.waitFor === 'string' ? { waitFor: base.settings.waitFor } : {}),
        ...(typeof base.settings.clock === 'string' ? { clock: base.settings.clock } : {}),
        ...(base.settings.evidence === 'minimal' ? { evidence: 'minimal' as const } : {}),
        ...(setupJourney ? { setupJourney } : {}),
        ...(repo ? { context: loadContext(repo) } : {}),
        onProgress: ctx.progress,
      });
      if (servedDir) {
        run.target = `${displayPath(servedDir)} (served at ${server!.url})`;
        run.settings.servedDir = servedDir;
      }
      if (repo) {
        run.settings.repo = repo;
        await locateFindings(run, repo);
      }
      run.settings.baseline = base.id;
      run.outcome = runOutcome(run);
      ctx.ws.saveRun(run);
      const cmp = compareRuns(base, run);
      const reports = writeReports(runDir, run, cmp, { history: ctx.ws.listRuns({ trend: true }) });
      const failed = flag(ctx, 'fail-on-regression') && !cmp.regressionFree;
      // Without loaded pages nothing was re-checked; a stopped run re-checked only part of the scope.
      const caveat =
        run.outcome === 'no-page-loaded'
          ? `  No page could be loaded from ${origin}, so no comparison was possible: no finding is counted as fixed.`
          : run.outcome === 'partial'
            ? '  The run was stopped early: the comparison is partial, and findings on pages not re-checked are not counted as fixed.'
            : undefined;
      return {
        data: {
          baseline: base.id,
          run: run.id,
          outcome: run.outcome,
          fixed: cmp.fixed.map((f) => ({ fingerprint: f.fingerprint, title: f.title })),
          dismissed: cmp.dismissed.map((f) => ({ fingerprint: f.fingerprint, title: f.title })),
          introduced: cmp.introduced,
          persisting: cmp.persisting.length,
          metrics: cmp.metrics,
          regressionFree: cmp.regressionFree,
          report: reports.html,
        },
        text: [
          `Verified ${run.id} against ${base.id}`,
          ...(caveat ? [caveat] : []),
          ...(run.outcome === 'no-page-loaded'
            ? []
            : [
                `  fixed ${cmp.fixed.length} · new ${cmp.introduced.length} · still present ${cmp.persisting.length}`,
              ]),
          ...cmp.fixed.map((f) => `  ✓ fixed  ${f.title} (${new URL(f.url).pathname})`),
          ...cmp.dismissed.map((f) => `  – dismissed (not fixed)  ${f.title} (${new URL(f.url).pathname})`),
          ...cmp.introduced.map((f) => `  ✗ new    ${f.severity} ${f.title} (${new URL(f.url).pathname})`),
          ...metricSummary(cmp.metrics),
          cmp.regressionFree
            ? '  No new serious/critical defects.'
            : '  ⚠ Regression: new serious/critical defects.',
          `  Report: ${reports.html}`,
        ].join('\n'),
        exitCode: exitCodeForOutcome(run.outcome, failed),
      };
    } finally {
      await server?.close();
    }
  },
};

export const checkpoint: Command = {
  name: 'checkpoint',
  summary: 'Record a git checkpoint of the working tree (no commits, branches or stash entries are created).',
  usage: 'jourilo checkpoint [--repo .] [--note text] | checkpoint diff [id=latest]',
  options: { repo: { type: 'string' }, note: { type: 'string' } },
  async run(ctx) {
    const repo = resolve(str(ctx, 'repo') ?? '.');
    if (ctx.positionals[0] === 'diff') {
      const cp = loadCheckpoint(ctx.ws.root, ctx.positionals[1] ?? 'latest');
      if (isTransaction(cp))
        return {
          data: { transaction: cp, files: previewRollback(cp) },
          text: previewRollback(cp)
            .map((f) => `${f.action.padEnd(9)} ${f.file}${f.reason ? ` (${f.reason})` : ''}`)
            .join('\n'),
        };
      const d = diffSince(repo, cp);
      return {
        data: { checkpoint: cp, ...d },
        text: `${d.stat || 'No tracked changes since checkpoint.'}${d.newFiles.length ? `\nNew untracked files: ${d.newFiles.join(', ')}` : ''}\n\n${d.patch}`,
      };
    }
    const cp = createCheckpoint(repo, ctx.ws.root, str(ctx, 'note') ?? '');
    return {
      data: cp,
      text: `Checkpoint ${cp.id} (snapshot ${cp.snapshot.slice(0, 10)}). Undo later with: jourilo rollback ${cp.id} --yes`,
    };
  },
};

export const rollbackCmd: Command = {
  name: 'rollback',
  summary:
    'Undo an applied fix (or restore a checkpoint) without overwriting later edits; requires --yes. The rollback can itself be undone.',
  usage: 'jourilo rollback <id|latest> --yes [--repo .] [--file path ...] [--force]',
  options: {
    repo: { type: 'string' },
    yes: { type: 'boolean' },
    file: { type: 'string', multiple: true },
    force: { type: 'boolean' },
  },
  details: `For a change made by \`optimize --apply\` (or a previous rollback), a file is restored only while it still
holds exactly what Jourilo wrote. A file edited afterwards is reported as a conflict and left alone; --force restores
it anyway after saving the current bytes under .jourilo/checkpoints/<id>/conflicts/.
For a checkpoint made with \`jourilo checkpoint\`, every tracked file changed since then is restored (everything you
or an agent changed in the meantime); the current bytes are kept, and the printed id undoes the rollback.
Untracked files created after a checkpoint are listed, never deleted.`,
  async run(ctx) {
    const rec = loadCheckpoint(ctx.ws.root, ctx.positionals[0] ?? 'latest');
    const files = list(ctx, 'file');
    if (isTransaction(rec)) {
      const preview = previewRollback(rec).filter((f) => !files.length || files.includes(f.file));
      if (!flag(ctx, 'yes'))
        return {
          data: { transaction: rec.id, preview },
          text: [
            `Change ${rec.id} (${rec.note || 'no note'}), ${rec.state}:`,
            ...preview.map((f) => `  ${f.action.padEnd(9)} ${f.file}${f.reason ? ` — ${f.reason}` : ''}`),
            preview.some((f) => f.action === 'conflict')
              ? 'Conflicting files are left alone unless you add --force (their current bytes are saved first).'
              : '',
            'Re-run with --yes to roll back.',
          ]
            .filter(Boolean)
            .join('\n'),
        };
      const r = rollbackTransaction(ctx.ws.root, rec, {
        force: flag(ctx, 'force'),
        ...(files.length ? { files } : {}),
      });
      const conflicted = r.conflicts.filter((c) => !c.savedCopy && !flag(ctx, 'force'));
      return {
        data: { transaction: rec.id, ...r },
        text: [
          `Restored ${r.restored.length} file(s) from change ${rec.id}.`,
          ...r.alreadyRestored.map((f) => `  unchanged ${f} (already original)`),
          ...r.conflicts.map(
            (c) =>
              `  ${c.savedCopy ? 'forced   ' : 'conflict '} ${c.file} — ${c.reason}${c.savedCopy ? ` (your version saved to ${displayPath(c.savedCopy)})` : ''}`,
          ),
          conflicted.length ? 'Conflicting files were not touched. Use --force to restore them anyway.' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        exitCode: conflicted.length ? 1 : 0,
      };
    }
    const cp: Checkpoint = rec;
    const repo = resolve(str(ctx, 'repo') ?? '.');
    const d = diffSince(repo, cp);
    if (!flag(ctx, 'yes'))
      return {
        data: { checkpoint: cp, wouldRestore: d.stat, newFiles: d.newFiles },
        text: `Would restore (every change since the checkpoint, including your own edits):\n${d.stat || '(nothing)'}\nThe current versions are kept and the rollback can be undone. Re-run with --yes to roll back.`,
        exitCode: 0,
      };
    const r = rollbackCheckpoint(repo, cp, ctx.ws.root, files.length ? { files } : {});
    if (r.transaction && !files.length) markRolledBack(ctx.ws.root, cp, r.transaction.id);
    return {
      data: {
        checkpoint: cp.id,
        transaction: r.transaction?.id ?? null,
        restored: r.restored,
        leftUntracked: r.leftUntracked,
      },
      text: [
        `Restored ${r.restored.length} file(s) to checkpoint ${cp.id}.`,
        r.transaction ? `Undo this rollback with: jourilo rollback ${r.transaction.id} --yes` : '',
        r.leftUntracked.length
          ? `Not removed (created after the checkpoint): ${r.leftUntracked.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  },
};
