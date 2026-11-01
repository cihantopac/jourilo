// File transactions for repairs and rollbacks. A transaction records, for every file it writes, the exact bytes
// before (as a backup) and a hash of the bytes after. That gives three guarantees without needing git:
//  - writes are atomic (temp file + rename) and an interrupted or failed apply can be undone;
//  - rollback restores a file only while it still holds exactly what the transaction wrote, so edits made later by a
//    person or another tool are never overwritten silently (they are reported as conflicts; --force keeps a copy);
//  - a rollback is itself a transaction, so it can be undone too.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { JouriloError } from '../core/errors.js';
import { resolveInside } from '../core/fs-safety.js';
import { newRunId } from '../core/hash.js';

export interface TxEdit {
  file: string;
  /** Exact bytes expected on disk now; null when the file must not exist. */
  before: Buffer | null;
  /** Bytes to write; null deletes the file. */
  after: Buffer | null;
}

export type TxFileState = 'pending' | 'written' | 'restored' | 'conflict';

export interface TxFile {
  file: string;
  beforeSha: string | null;
  afterSha: string | null;
  mode: number | null;
  state: TxFileState;
  /** Why a rollback did not restore this file. */
  conflict?: string;
}

export interface Transaction {
  kind: 'fix-transaction';
  id: string;
  createdAt: string;
  root: string;
  note: string;
  /** For a rollback: the record it undid. */
  undoes?: string;
  state: 'pending' | 'applied' | 'failed' | 'rolled-back' | 'partially-rolled-back';
  files: TxFile[];
}

export interface RollbackResult {
  restored: string[];
  alreadyRestored: string[];
  conflicts: { file: string; reason: string; savedCopy?: string }[];
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const recordsDir = (wsRoot: string) => join(wsRoot, 'checkpoints');
const txDir = (wsRoot: string, id: string) => join(recordsDir(wsRoot), id);

/** Writes bytes to a temporary file next to the target, flushes it and renames it over the target. */
export function atomicWrite(path: string, data: Buffer, mode?: number | null): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.jourilo-${randomBytes(4).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', mode ?? 0o644);
  try {
    let off = 0;
    while (off < data.length) off += writeSync(fd, data, off, data.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // Windows refuses to replace a file that another process holds open for a moment; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((err as NodeJS.ErrnoException).code ?? '')) {
        rmSync(tmp, { force: true });
        throw err;
      }
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until);
    }
  }
}

function saveRecord(wsRoot: string, tx: Transaction): void {
  mkdirSync(recordsDir(wsRoot), { recursive: true });
  atomicWrite(join(recordsDir(wsRoot), `${tx.id}.json`), Buffer.from(`${JSON.stringify(tx, null, 2)}\n`));
}

/** Resolves a repository path for writing: inside the root, and not a symbolic link. */
function writablePath(root: string, file: string): string {
  const abs = resolveInside(root, file);
  const lexical = join(root, file);
  if (existsSync(lexical) && lstatSync(lexical).isSymbolicLink())
    throw new JouriloError(
      'UNSAFE_PATH',
      `${file} is a symbolic link; Jourilo does not write through links. Make this change by hand.`,
    );
  return abs;
}

function readOrNull(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

export interface ApplyOptions {
  note?: string;
  undoes?: string;
  /** Test hook: called before each file is written; throwing simulates a crash or I/O error at that point. */
  beforeWrite?: (file: string, index: number) => void;
}

/**
 * Applies edits as one transaction. Every file must still hold exactly the bytes the plan was computed from;
 * otherwise nothing is written. On a failure part-way, files already written are restored before the error is
 * rethrown.
 */
export function applyTransaction(
  root: string,
  wsRoot: string,
  edits: TxEdit[],
  opts: ApplyOptions = {},
): Transaction {
  const pending = activeTransactions(wsRoot).filter((t) => t.state === 'pending');
  if (pending.length)
    throw new JouriloError(
      'INVALID_INPUT',
      `An earlier change (${pending[0]!.id}) was interrupted before it finished.`,
      `Run \`jourilo rollback ${pending[0]!.id} --yes\` to restore those files first.`,
    );
  const names = edits.map((e) => e.file);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new JouriloError('INTERNAL', `${dup} appears twice in one change; combine its edits first.`);
  // 1. Preflight: paths, symlinks, and that every file is unchanged since the plan.
  const prepared = edits.map((e) => {
    const abs = writablePath(root, e.file);
    const current = readOrNull(abs);
    const same = e.before === null ? current === null : current?.equals(e.before);
    if (!same)
      throw new JouriloError(
        'INVALID_INPUT',
        `${e.file} changed after the fix was planned; nothing was written.`,
        'Run the command again so the plan is computed from the current file.',
      );
    return { ...e, abs, mode: current ? statSync(abs).mode & 0o777 : null };
  });
  const tx: Transaction = {
    kind: 'fix-transaction',
    id: newRunId(),
    createdAt: new Date().toISOString(),
    root,
    note: opts.note ?? '',
    ...(opts.undoes ? { undoes: opts.undoes } : {}),
    state: 'pending',
    files: prepared.map((p) => ({
      file: p.file,
      beforeSha: p.before ? sha256(p.before) : null,
      afterSha: p.after ? sha256(p.after) : null,
      mode: p.mode,
      state: 'pending',
    })),
  };
  // 2. Backups first, then the record: an interruption from here on can always be rolled back.
  for (const p of prepared)
    if (p.before) atomicWrite(resolveInside(join(txDir(wsRoot, tx.id), 'before'), p.file), p.before);
  saveRecord(wsRoot, tx);
  // 3. Writes, recording progress after each file.
  try {
    prepared.forEach((p, i) => {
      opts.beforeWrite?.(p.file, i);
      if (p.after) atomicWrite(p.abs, p.after, p.mode);
      else if (existsSync(p.abs)) unlinkSync(p.abs);
      tx.files[i]!.state = 'written';
      saveRecord(wsRoot, tx);
    });
  } catch (err) {
    const undo = rollbackTransaction(wsRoot, tx, { force: false });
    tx.state = 'failed';
    saveRecord(wsRoot, tx);
    const msg = err instanceof Error ? err.message : String(err);
    throw new JouriloError(
      'INTERNAL',
      `Writing the changes failed (${msg}); ${undo.restored.length} file(s) already written were restored.${undo.conflicts.length ? ` Not restored: ${undo.conflicts.map((c) => c.file).join(', ')}.` : ''}`,
    );
  }
  tx.state = 'applied';
  saveRecord(wsRoot, tx);
  return tx;
}

/**
 * Undoes a transaction file by file. A file is restored only while it holds exactly the bytes the transaction
 * wrote. Anything else is a conflict and is left untouched, unless `force` is set, in which case the current bytes
 * are first saved under the record's `conflicts/` directory.
 */
export function rollbackTransaction(
  wsRoot: string,
  tx: Transaction,
  opts: { force?: boolean; files?: string[] } = {},
): RollbackResult {
  const result: RollbackResult = { restored: [], alreadyRestored: [], conflicts: [] };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const f of tx.files) {
    if (opts.files?.length && !opts.files.includes(f.file)) continue;
    if (f.state === 'restored') {
      result.alreadyRestored.push(f.file);
      continue;
    }
    const abs = writablePath(tx.root, f.file);
    const current = readOrNull(abs);
    const currentSha = current ? sha256(current) : null;
    if (currentSha === f.beforeSha) {
      // Never written, or already back to the original bytes.
      f.state = 'restored';
      delete f.conflict;
      result.alreadyRestored.push(f.file);
      continue;
    }
    if (currentSha !== f.afterSha) {
      const reason =
        current === null
          ? 'deleted after the change was applied'
          : 'modified after the change was applied (not by Jourilo)';
      if (!opts.force) {
        f.state = 'conflict';
        f.conflict = reason;
        result.conflicts.push({ file: f.file, reason });
        continue;
      }
      let savedCopy: string | undefined;
      if (current) {
        savedCopy = resolveInside(join(txDir(wsRoot, tx.id), 'conflicts', stamp), f.file);
        atomicWrite(savedCopy, current);
      }
      result.conflicts.push({ file: f.file, reason, ...(savedCopy ? { savedCopy } : {}) });
    }
    if (f.beforeSha === null) {
      if (existsSync(abs)) unlinkSync(abs);
    } else {
      const backup = resolveInside(join(txDir(wsRoot, tx.id), 'before'), f.file);
      if (!existsSync(backup)) {
        f.state = 'conflict';
        f.conflict = 'backup missing';
        result.conflicts.push({ file: f.file, reason: 'backup missing; cannot restore' });
        continue;
      }
      const bytes = readFileSync(backup);
      if (sha256(bytes) !== f.beforeSha) {
        result.conflicts.push({ file: f.file, reason: 'backup does not match its recorded hash' });
        continue;
      }
      atomicWrite(abs, bytes, f.mode);
    }
    f.state = 'restored';
    delete f.conflict;
    result.restored.push(f.file);
  }
  const allBack = tx.files.every((f) => f.state === 'restored');
  if (tx.state !== 'pending' || allBack) tx.state = allBack ? 'rolled-back' : 'partially-rolled-back';
  saveRecord(wsRoot, tx);
  return result;
}

export function isTransaction(x: unknown): x is Transaction {
  return !!x && typeof x === 'object' && (x as { kind?: string }).kind === 'fix-transaction';
}

/** Transactions that still have effect on disk: applied, partially rolled back, or interrupted. */
export function activeTransactions(wsRoot: string): Transaction[] {
  const dir = recordsDir(wsRoot);
  if (!existsSync(dir)) return [];
  const out: Transaction[] = [];
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
      if (isTransaction(rec) && ['pending', 'applied', 'partially-rolled-back'].includes(rec.state))
        out.push(rec);
    } catch {
      // A corrupt record is reported by `rollback` when addressed directly.
    }
  }
  return out;
}

/** Status of each file: what rollback would do right now, without changing anything. */
export function previewRollback(
  tx: Transaction,
): { file: string; action: 'restore' | 'unchanged' | 'conflict'; reason?: string }[] {
  return tx.files.map((f) => {
    if (f.state === 'restored') return { file: f.file, action: 'unchanged' as const };
    const abs = writablePath(tx.root, f.file);
    const current = readOrNull(abs);
    const sha = current ? sha256(current) : null;
    if (sha === f.beforeSha) return { file: f.file, action: 'unchanged' as const };
    if (sha === f.afterSha) return { file: f.file, action: 'restore' as const };
    return {
      file: f.file,
      action: 'conflict' as const,
      reason: current === null ? 'deleted after the change' : 'modified after the change',
    };
  });
}
