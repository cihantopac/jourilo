// Checkpoints and rollback through git, without touching the user's branches, index or stash list.
// A checkpoint is a dangling commit object (`git stash create`) that captures the working tree; rollback restores
// tracked files from it (byte-exact from backups taken by `optimize --apply`). Untracked files created afterwards are
// listed, never deleted automatically.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JouriloError } from '../core/errors.js';
import { resolveInside } from '../core/fs-safety.js';
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

function backupDir(wsRoot: string, cp: Checkpoint): string {
  return join(wsRoot, 'checkpoints', cp.id);
}

/**
 * Saves the exact bytes of files about to be written, so rollback restores them byte for byte (git checkout
 * filters such as core.autocrlf would otherwise change line endings).
 */
export function backupFiles(root: string, wsRoot: string, cp: Checkpoint, files: string[]): void {
  for (const f of files) {
    const src = resolveInside(root, f);
    if (!existsSync(src)) continue;
    const dest = resolveInside(backupDir(wsRoot, cp), f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(src));
  }
}

function blob(root: string, rev: string, file: string): Buffer | null {
  const r = spawnSync('git', ['cat-file', 'blob', `${rev}:${file}`], {
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : null;
}

export function rollback(
  root: string,
  cp: Checkpoint,
  wsRoot?: string,
): { restored: string[]; leftUntracked: string[] } {
  const changed = git(root, ['diff', '--name-only', cp.snapshot]).out.split('\n').filter(Boolean);
  const restored: string[] = [];
  const notRestorable: string[] = [];
  for (const f of changed) {
    const target = resolveInside(root, f);
    // 1. Exact bytes saved by `optimize --apply`.
    const saved = wsRoot ? resolveInside(backupDir(wsRoot, cp), f) : null;
    if (saved && existsSync(saved)) {
      writeFileSync(target, readFileSync(saved));
      restored.push(f);
      continue;
    }
    // 2. The checkpoint snapshot, written without checkout filters; keep CRLF if the working copy uses it.
    const content = blob(root, cp.snapshot, f);
    if (!content) {
      notRestorable.push(f);
      continue;
    }
    let out = content;
    const current = existsSync(target) ? readFileSync(target) : null;
    if (current?.includes('\r\n') && !content.includes('\r\n'))
      out = Buffer.from(content.toString('utf8').replace(/\n/g, '\r\n'), 'utf8');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, out);
    restored.push(f);
  }
  return {
    restored,
    // Files that did not exist at checkpoint time are listed, never deleted.
    leftUntracked: [
      ...notRestorable,
      ...untrackedFiles(root).filter((f) => !cp.untracked.includes(f) && !notRestorable.includes(f)),
    ],
  };
}
