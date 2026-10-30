import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runAudit } from '../../audit/engine.js';
import { parseViewports } from '../../browser/viewports.js';
import { JouriloError } from '../../core/errors.js';
import { displayPath, resolveInside } from '../../core/fs-safety.js';
import { serveStatic } from '../../core/static-server.js';
import { loadContext } from '../../integrations/context.js';
import { unifiedDiff } from '../../repair/diff.js';
import { planFixes } from '../../repair/fixes.js';
import {
  backupFiles,
  createCheckpoint,
  diffSince,
  isGitRepo,
  loadCheckpoint,
  rollback,
} from '../../repair/git.js';
import { locateFindings } from '../../repair/locate.js';
import { compareRuns } from '../../report/compare.js';
import { writeReports } from '../../report/index.js';
import { type Command, flag, list, str } from '../framework.js';

export const optimize: Command = {
  name: 'optimize',
  summary:
    'Plan (and with --apply, make) minimal source fixes for located findings; shows diffs, checkpoints first.',
  usage: 'jourilo optimize [run=latest] --repo <path> [--rule id ...] [--apply]',
  options: {
    repo: { type: 'string' },
    rule: { type: 'string', multiple: true },
    finding: { type: 'string', multiple: true },
    apply: { type: 'boolean' },
  },
  details: `Deterministic fixers (others are reported with source candidates for a person or agent to fix):
  axe/html-has-lang, jourilo/missing-viewport-meta, jourilo/input-purpose, jourilo/focus-visible, jourilo/paste-blocked
Without --apply nothing is written. With --apply, a git checkpoint is created first (jourilo rollback undoes it).
Afterwards run \`jourilo verify <run>\` to repeat the audit and compare.`,
  async run(ctx) {
    const { run, dir } = ctx.ws.loadRun(ctx.positionals[0] ?? 'latest');
    const repo = resolve(str(ctx, 'repo') ?? (run.settings.repo as string | undefined) ?? '.');
    if (!existsSync(repo)) throw new JouriloError('NOT_FOUND', `Repository not found: ${repo}`);
    if (run.findings.every((f) => !f.sources)) locateFindings(run, repo);
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
      const finalContent = new Map<string, string>();
      for (const p of plans) for (const e of p.edits) finalContent.set(e.file, e.after);
      if (isGitRepo(repo)) {
        const cp = createCheckpoint(repo, ctx.ws.root, `before optimize of run ${run.id}`);
        backupFiles(repo, ctx.ws.root, cp, [...finalContent.keys()]);
        checkpoint = cp.id;
      } else ctx.log('Warning: not a git repository, so no checkpoint/rollback is available.');
      for (const [file, content] of finalContent) writeFileSync(resolveInside(repo, file), content);
      const outDir = join(ctx.ws.root, 'fixes');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        join(outDir, `${run.id}.json`),
        `${JSON.stringify({ run: run.id, checkpoint, applied: plans.map((p) => ({ fingerprint: p.fingerprint, ruleId: p.ruleId, title: p.title, files: p.edits.map((e) => e.file) })) }, null, 2)}\n`,
      );
      lines.push(
        `Applied ${plans.length} fix(es) to ${finalContent.size} file(s).${checkpoint ? ` Checkpoint ${checkpoint} (jourilo rollback ${checkpoint}).` : ''}`,
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

export const verify: Command = {
  name: 'verify',
  summary:
    'Repeat a run with the same scope (pages, viewports) after a change and compare: fixed, new, persisting, metric deltas.',
  usage: 'jourilo verify <baseline-run> [--target url|dir] [--fail-on-regression]',
  options: {
    target: { type: 'string' },
    'fail-on-regression': { type: 'boolean' },
    repo: { type: 'string' },
  },
  async run(ctx) {
    const base = ctx.ws.loadRun(ctx.positionals[0] ?? 'latest').run;
    const scope = base.settings.scope as { urls: string[]; viewports: string[] } | undefined;
    if (!scope)
      throw new JouriloError(
        'INVALID_INPUT',
        `Run ${base.id} has no recorded scope (created by an older version or by journeys).`,
      );
    const servedDir =
      (str(ctx, 'target') && existsSync(str(ctx, 'target')!) ? resolve(str(ctx, 'target')!) : undefined) ??
      (base.settings.servedDir as string | undefined);
    const server = servedDir ? await serveStatic(servedDir) : undefined;
    try {
      const origin = server?.url ?? new URL(str(ctx, 'target') ?? scope.urls[0]!).origin;
      const urls = scope.urls.map((u) => {
        const x = new URL(u);
        return `${x.pathname}${x.search}`;
      });
      const repo = str(ctx, 'repo') ?? (base.settings.repo as string | undefined);
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
        keyboard: base.settings.keyboard !== false,
        throttle: base.settings.throttle === true,
        timeoutMs: 30_000,
        mask: [],
        mode: base.mode,
        ...(repo ? { context: loadContext(repo) } : {}),
        onProgress: ctx.log,
      });
      if (servedDir) {
        run.target = `${displayPath(servedDir)} (served at ${server!.url})`;
        run.settings.servedDir = servedDir;
      }
      if (repo) {
        run.settings.repo = repo;
        locateFindings(run, repo);
      }
      run.settings.baseline = base.id;
      ctx.ws.saveRun(run);
      const cmp = compareRuns(base, run);
      const reports = writeReports(runDir, run, cmp, { history: ctx.ws.listRuns() });
      const failed = flag(ctx, 'fail-on-regression') && !cmp.regressionFree;
      return {
        data: {
          baseline: base.id,
          run: run.id,
          fixed: cmp.fixed.map((f) => ({ fingerprint: f.fingerprint, title: f.title })),
          introduced: cmp.introduced,
          persisting: cmp.persisting.length,
          metrics: cmp.metrics,
          regressionFree: cmp.regressionFree,
          report: reports.html,
        },
        text: [
          `Verified ${run.id} against ${base.id}`,
          `  fixed ${cmp.fixed.length} · new ${cmp.introduced.length} · still present ${cmp.persisting.length}`,
          ...cmp.fixed.map((f) => `  ✓ fixed  ${f.title} (${new URL(f.url).pathname})`),
          ...cmp.introduced.map((f) => `  ✗ new    ${f.severity} ${f.title} (${new URL(f.url).pathname})`),
          cmp.regressionFree
            ? '  No new serious/critical defects.'
            : '  ⚠ Regression: new serious/critical defects.',
          `  Report: ${reports.html}`,
        ].join('\n'),
        exitCode: failed ? 1 : 0,
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
    'Restore tracked files to a checkpoint (requires --yes). Untracked files created since are listed, not deleted.',
  usage: 'jourilo rollback <checkpoint-id|latest> --yes [--repo .]',
  options: { repo: { type: 'string' }, yes: { type: 'boolean' } },
  async run(ctx) {
    const repo = resolve(str(ctx, 'repo') ?? '.');
    const cp = loadCheckpoint(ctx.ws.root, ctx.positionals[0] ?? 'latest');
    const d = diffSince(repo, cp);
    if (!flag(ctx, 'yes'))
      return {
        data: { checkpoint: cp, wouldRestore: d.stat, newFiles: d.newFiles },
        text: `Would restore:\n${d.stat || '(nothing)'}\nRe-run with --yes to roll back.`,
        exitCode: 0,
      };
    const r = rollback(repo, cp, ctx.ws.root);
    return {
      data: r,
      text: `Restored ${r.restored.length} file(s) to checkpoint ${cp.id}.${r.leftUntracked.length ? `\nNot removed (created after the checkpoint): ${r.leftUntracked.join(', ')}` : ''}`,
    };
  },
};
