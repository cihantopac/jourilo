// Checkpoints through git, without touching the user's branches, index or stash list. A checkpoint is a dangling
// commit object (`git stash create`) that captures the working tree; rolling back to it is a file transaction
// (repair/transaction.ts), so the files it overwrites are kept and the rollback can be undone. Untracked files
// created afterwards are listed, never deleted automatically.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JouriloError } from '../core/errors.js';
import { resolveInside } from '../core/fs-safety.js';
import { newRunId } from '../core/hash.js';
import { applyTransaction, isTransaction, type Transaction, type TxEdit } from './transaction.js';

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

/**
 * Loads a checkpoint or a fix transaction by id. `latest` is the newest record that still has effect: a checkpoint,
 * or a transaction that is applied, partially rolled back or interrupted (rollback transactions are skipped, so
 * repeating `rollback latest` does not undo the previous rollback).
 */
export function loadCheckpoint(wsRoot: string, id: string): Checkpoint | Transaction {
  const dir = join(wsRoot, 'checkpoints');
  const read = (name: string) =>
    JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Checkpoint | Transaction;
  let pick: string | undefined = id;
  if (id === 'latest') {
    const names = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace(/\.json$/, ''))
          .sort()
          .reverse()
      : [];
    pick = names.find((n) => {
      try {
        const rec = read(n);
        if (!isTransaction(rec)) return !(rec as Checkpoint & { rolledBack?: string }).rolledBack;
        return !rec.undoes && ['applied', 'pending', 'partially-rolled-back'].includes(rec.state);
      } catch {
        return false;
      }
    });
  }
  if (!pick || !/^[\w-]+$/.test(pick) || !existsSync(join(dir, `${pick}.json`)))
    throw new JouriloError('NOT_FOUND', `Checkpoint not found: ${id}`);
  return read(pick);
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

/**
 * Restores files to a checkpoint as a transaction: the current bytes of every file it overwrites are kept, so the
 * rollback itself can be undone (`jourilo rollback <id>` with the returned transaction id). Files created after the
 * checkpoint are listed, never deleted.
 */
export function rollbackCheckpoint(
  root: string,
  cp: Checkpoint,
  wsRoot: string,
  opts: { files?: string[] } = {},
): { transaction: Transaction | null; restored: string[]; leftUntracked: string[] } {
  const changed = git(root, ['diff', '--name-only', '--no-renames', cp.snapshot])
    .out.split('\n')
    .filter(Boolean)
    .filter((f) => !opts.files?.length || opts.files.includes(f));
  const edits: TxEdit[] = [];
  const notRestorable: string[] = [];
  for (const f of changed) {
    const target = resolveInside(root, f);
    const current = existsSync(target) ? readFileSync(target) : null;
    // 1. Exact bytes saved by `optimize --apply` in 0.1.0.
    const saved = resolveInside(backupDir(wsRoot, cp), f);
    let wanted: Buffer | null = existsSync(saved) ? readFileSync(saved) : null;
    // 2. The checkpoint snapshot, read without checkout filters; keep CRLF if the working copy uses it.
    if (!wanted) {
      const content = blob(root, cp.snapshot, f);
      if (!content) {
        notRestorable.push(f);
        continue;
      }
      wanted =
        current?.includes('\r\n') && !content.includes('\r\n')
          ? Buffer.from(content.toString('utf8').replace(/\n/g, '\r\n'), 'utf8')
          : content;
    }
    if (current?.equals(wanted)) continue;
    edits.push({ file: f, before: current, after: wanted });
  }
  const transaction = edits.length
    ? applyTransaction(root, wsRoot, edits, { note: `rollback to checkpoint ${cp.id}`, undoes: cp.id })
    : null;
  return {
    transaction,
    restored: edits.map((e) => e.file),
    // Files that did not exist at checkpoint time are listed, never deleted.
    leftUntracked: [
      ...notRestorable,
      ...untrackedFiles(root).filter((f) => !cp.untracked.includes(f) && !notRestorable.includes(f)),
    ],
  };
}

/** Marks a checkpoint as rolled back, so `rollback latest` moves on to older records. */
export function markRolledBack(wsRoot: string, cp: Checkpoint, transactionId: string): void {
  const file = join(wsRoot, 'checkpoints', `${cp.id}.json`);
  writeFileSync(file, `${JSON.stringify({ ...cp, rolledBack: transactionId }, null, 2)}\n`);
}

/** True when `file` would be committed by `git add -A` (inside a work tree and not ignored). */
export function wouldBeCommitted(file: string): boolean {
  let dir = dirname(file);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  if (!isGitRepo(dir)) return false;
  const r = spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: dir });
  return r.status === 1;
}
