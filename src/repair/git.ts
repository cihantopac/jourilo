// Checkpoints and rollback through git, without touching the user's branches, index or stash list.
// A checkpoint is a dangling commit object (`git stash create`) that captures the working tree; rollback restores
// tracked files from it. Untracked files created afterwards are listed, never deleted automatically.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from '../core/errors.js';
import { newRunId } from '../core/hash.js';

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

export function isGitRepo(root: string): boolean {
  return git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true';
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  head: string;
  /** Commit object capturing the working tree at checkpoint time (HEAD when the tree was clean). */
  snapshot: string;
  untracked: string[];
  note: string;
}

function untrackedFiles(root: string): string[] {
  return git(root, ['ls-files', '--others', '--exclude-standard']).out.split('\n').filter(Boolean);
}

export function createCheckpoint(root: string, wsRoot: string, note = ''): Checkpoint {
  if (!isGitRepo(root))
    throw new JouriloError(
      'INVALID_INPUT',
      `${root} is not a git repository; checkpoints need git.`,
      'Run `git init` and commit, or keep your own backup before applying fixes.',
    );
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head.ok)
    throw new JouriloError(
      'INVALID_INPUT',
      'The repository has no commits yet; commit once before using checkpoints.',
    );
  const stash = git(root, ['stash', 'create', `jourilo checkpoint ${note}`.trim()]);
  const cp: Checkpoint = {
    id: newRunId(),
    createdAt: new Date().toISOString(),
    head: head.out,
    snapshot: stash.out || head.out,
    untracked: untrackedFiles(root),
    note,
  };
  // Keep the snapshot reachable from a private ref so `git gc` does not collect it.
  git(root, ['update-ref', `refs/jourilo/checkpoints/${cp.id}`, cp.snapshot]);
  const dir = join(wsRoot, 'checkpoints');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${cp.id}.json`), `${JSON.stringify(cp, null, 2)}\n`);
  return cp;
}

export function loadCheckpoint(wsRoot: string, id: string): Checkpoint {
  const dir = join(wsRoot, 'checkpoints');
  const pick =
    id === 'latest'
      ? existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .sort()
            .pop()
            ?.replace(/\.json$/, '')
        : undefined
      : id;
  if (!pick || !/^[\w-]+$/.test(pick) || !existsSync(join(dir, `${pick}.json`)))
    throw new JouriloError('NOT_FOUND', `Checkpoint not found: ${id}`);
  return JSON.parse(readFileSync(join(dir, `${pick}.json`), 'utf8')) as Checkpoint;
}

export function diffSince(root: string, cp: Checkpoint): { stat: string; patch: string; newFiles: string[] } {
  const stat = git(root, ['diff', '--stat', cp.snapshot]).out;
  const patch = git(root, ['diff', cp.snapshot]).out;
  const newFiles = untrackedFiles(root).filter((f) => !cp.untracked.includes(f));
  return { stat, patch, newFiles };
}

export function rollback(root: string, cp: Checkpoint): { restored: string[]; leftUntracked: string[] } {
  const changed = git(root, ['diff', '--name-only', cp.snapshot]).out.split('\n').filter(Boolean);
  if (changed.length) {
    const r = git(root, ['restore', `--source=${cp.snapshot}`, '--worktree', '--', ...changed]);
    if (!r.ok) {
      // Files that did not exist at checkpoint time cannot be restored from it; report them instead.
      const restorable = changed.filter((f) => git(root, ['cat-file', '-e', `${cp.snapshot}:${f}`]).ok);
      if (restorable.length) {
        const r2 = git(root, ['restore', `--source=${cp.snapshot}`, '--worktree', '--', ...restorable]);
        if (!r2.ok) throw new JouriloError('INTERNAL', `git restore failed: ${r2.err}`);
      }
      return {
        restored: restorable,
        leftUntracked: [
          ...changed.filter((f) => !restorable.includes(f)),
          ...untrackedFiles(root).filter((f) => !cp.untracked.includes(f)),
        ],
      };
    }
  }
  return { restored: changed, leftUntracked: untrackedFiles(root).filter((f) => !cp.untracked.includes(f)) };
}
