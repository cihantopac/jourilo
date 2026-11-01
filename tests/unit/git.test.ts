// Applying fixes and rolling them back must never lose a byte of the user's work: not their earlier uncommitted
// changes, not edits made after the fix, not files Jourilo never touched. Rollback is byte-exact (also under
// core.autocrlf=true, the Windows default), conflict-aware, and itself reversible.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/core/types.js';
import { composeEdits, planFixes } from '../../src/repair/fixes.js';
import {
  createCheckpoint,
  loadCheckpoint,
  markRolledBack,
  rollbackCheckpoint,
  wouldBeCommitted,
} from '../../src/repair/git.js';
import {
  activeTransactions,
  applyTransaction,
  isTransaction,
  previewRollback,
  rollbackTransaction,
  type Transaction,
} from '../../src/repair/transaction.js';

const b = (s: string) => Buffer.from(s, 'utf8');

function repo(files: Record<string, string>, opts: { git?: boolean; autocrlf?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jourilo-git-'));
  const git = (...a: string[]) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), c);
  }
  if (opts.git !== false) {
    git('init', '-q');
    git('config', 'core.autocrlf', opts.autocrlf ? 'true' : 'false');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init');
  }
  const read = (f: string) => readFileSync(join(root, f), 'utf8');
  return { root, git, read, ws: mkdtempSync(join(tmpdir(), 'jourilo-ws-')) };
}

function apply(
  root: string,
  ws: string,
  changes: Record<string, [string, string]>,
  beforeWrite?: () => void,
) {
  return applyTransaction(
    root,
    ws,
    Object.entries(changes).map(([file, [before, after]]) => ({ file, before: b(before), after: b(after) })),
    beforeWrite ? { beforeWrite } : {},
  );
}

describe('fix transactions', () => {
  it.each([false, true])('apply and roll back byte for byte (autocrlf=%s)', (autocrlf) => {
    const original = '<html>\n<body>hi</body>\n</html>\n';
    const { root, git, read, ws } = repo({ 'a.html': original }, { autocrlf });
    const tx = apply(root, ws, { 'a.html': [original, original.replace('<html>', '<html lang="en">')] });
    expect(tx.state).toBe('applied');
    expect(read('a.html')).toContain('lang="en"');
    const r = rollbackTransaction(ws, tx);
    expect(r.restored).toEqual(['a.html']);
    expect(read('a.html')).toBe(original);
    expect(git('status', '--short')).toBe('');
  });

  it('keeps CRLF and non-ASCII bytes exactly', () => {
    const original = 'ç\r\nş\r\n<html>\r\n';
    const { root, read, ws } = repo({ 'i.html': original });
    const tx = apply(root, ws, { 'i.html': [original, original.replace('<html>', '<html lang="tr">')] });
    rollbackTransaction(ws, tx);
    expect(readFileSync(join(root, 'i.html')).equals(b(original))).toBe(true);
    expect(read('i.html')).toBe(original);
  });

  it('never overwrites an edit made after the fix; --force keeps a copy first', () => {
    const { root, read, ws } = repo({ 'a.css': 'a{}\n' });
    const tx = apply(root, ws, { 'a.css': ['a{}\n', 'a{}\n:focus-visible{outline:2px solid}\n'] });
    writeFileSync(join(root, 'a.css'), `${read('a.css')}.mine{color:red}\n`);
    expect(previewRollback(tx)[0]!.action).toBe('conflict');
    const r = rollbackTransaction(ws, tx);
    expect(r.restored).toEqual([]);
    expect(r.conflicts[0]!.reason).toMatch(/modified after/);
    expect(read('a.css')).toContain('.mine{color:red}');
    expect(tx.state).toBe('partially-rolled-back');

    const forced = rollbackTransaction(ws, tx, { force: true });
    expect(forced.restored).toEqual(['a.css']);
    expect(read('a.css')).toBe('a{}\n');
    const saved = forced.conflicts[0]!.savedCopy!;
    expect(readFileSync(saved, 'utf8')).toContain('.mine{color:red}');
  });

  it('reports a file deleted after the fix as a conflict', () => {
    const { root, ws } = repo({ 'a.css': 'a{}\n' });
    const tx = apply(root, ws, { 'a.css': ['a{}\n', 'b{}\n'] });
    execFileSync('rm', [join(root, 'a.css')]);
    const r = rollbackTransaction(ws, tx);
    expect(r.conflicts[0]!.reason).toMatch(/deleted/);
    expect(existsSync(join(root, 'a.css'))).toBe(false);
  });

  it('touches only its own files: unrelated edits, staged changes and untracked files survive', () => {
    const { root, git, read, ws } = repo({ 'a.html': '<html>\n', 'b.ts': 'export const x = 1;\n' });
    // Pre-existing work: a staged change, an unstaged change on top of it, and an untracked file.
    writeFileSync(join(root, 'a.html'), '<html>\n<!-- staged -->\n');
    git('add', 'a.html');
    writeFileSync(join(root, 'a.html'), '<html>\n<!-- staged -->\n<!-- unstaged -->\n');
    writeFileSync(join(root, 'notes.txt'), 'mine\n');
    const before = read('a.html');
    const cached = git('diff', '--cached');
    const tx = apply(root, ws, { 'a.html': [before, before.replace('<html>', '<html lang="en">')] });
    // Later, the user edits an unrelated file.
    writeFileSync(join(root, 'b.ts'), 'export const x = 2;\n');
    rollbackTransaction(ws, tx);
    expect(read('a.html')).toBe(before);
    expect(git('diff', '--cached')).toBe(cached);
    expect(read('b.ts')).toBe('export const x = 2;\n');
    expect(read('notes.txt')).toBe('mine\n');
  });

  it('writes nothing when a file changed after the plan was made', () => {
    const { root, read, ws } = repo({ 'a.html': '<html>\n', 'b.html': '<html>\n' });
    writeFileSync(join(root, 'b.html'), '<html>\n<p>edited meanwhile</p>\n');
    expect(() =>
      apply(root, ws, {
        'a.html': ['<html>\n', '<html lang="en">\n'],
        'b.html': ['<html>\n', '<html lang="en">\n'],
      }),
    ).toThrow(/changed after the fix was planned/);
    expect(read('a.html')).toBe('<html>\n');
    expect(read('b.html')).toContain('edited meanwhile');
  });

  it('restores already written files when a write fails part-way', () => {
    const { root, read, ws } = repo({ 'a.css': 'a{}\n', 'b.css': 'b{}\n', 'c.css': 'c{}\n' });
    let n = 0;
    expect(() =>
      apply(
        root,
        ws,
        { 'a.css': ['a{}\n', 'A\n'], 'b.css': ['b{}\n', 'B\n'], 'c.css': ['c{}\n', 'C\n'] },
        () => {
          if (++n === 3) throw new Error('disk full');
        },
      ),
    ).toThrow(/disk full.*2 file\(s\) already written were restored/);
    expect([read('a.css'), read('b.css'), read('c.css')]).toEqual(['a{}\n', 'b{}\n', 'c{}\n']);
    expect(activeTransactions(ws)).toEqual([]);
    // No temporary files are left behind.
    expect(readdirSync(root).filter((f) => f.includes('jourilo'))).toEqual([]);
  });

  it('recovers from an apply that was interrupted (process killed) and blocks new applies until then', () => {
    const { root, read, ws } = repo({ 'a.css': 'a{}\n', 'b.css': 'b{}\n' });
    const tx = apply(root, ws, { 'a.css': ['a{}\n', 'A\n'], 'b.css': ['b{}\n', 'B\n'] });
    // Simulate the record a killed process leaves: first file written, second not yet.
    writeFileSync(join(root, 'b.css'), 'b{}\n');
    const crashed: Transaction = {
      ...tx,
      state: 'pending',
      files: [
        { ...tx.files[0]!, state: 'written' },
        { ...tx.files[1]!, state: 'pending' },
      ],
    };
    writeFileSync(join(ws, 'checkpoints', `${tx.id}.json`), JSON.stringify(crashed));
    expect(() => apply(root, ws, { 'b.css': ['b{}\n', 'X\n'] })).toThrow(/interrupted/);
    const rec = loadCheckpoint(ws, 'latest');
    expect(isTransaction(rec) && rec.id).toBe(tx.id);
    const r = rollbackTransaction(ws, rec as Transaction);
    expect(r.restored).toEqual(['a.css']);
    expect(r.alreadyRestored).toEqual(['b.css']);
    expect([read('a.css'), read('b.css')]).toEqual(['a{}\n', 'b{}\n']);
    expect(activeTransactions(ws)).toEqual([]);
  });

  it('works without git (backups, not git, make rollback possible)', () => {
    const { root, read, ws } = repo({ 'index.html': '<html>\n' }, { git: false });
    const tx = apply(root, ws, { 'index.html': ['<html>\n', '<html lang="en">\n'] });
    expect(read('index.html')).toBe('<html lang="en">\n');
    rollbackTransaction(ws, tx);
    expect(read('index.html')).toBe('<html>\n');
  });

  it('refuses to write through symlinks or symlinked directories', () => {
    const outside = mkdtempSync(join(tmpdir(), 'jourilo-outside-'));
    writeFileSync(join(outside, 'x.html'), '<html>\n');
    const { root, ws } = repo({ 'real.html': '<html>\n' });
    symlinkSync(join(root, 'real.html'), join(root, 'link.html'));
    symlinkSync(outside, join(root, 'vendor'));
    expect(() => apply(root, ws, { 'link.html': ['<html>\n', '<html lang="en">\n'] })).toThrow(
      /symbolic link/,
    );
    expect(() => apply(root, ws, { 'vendor/x.html': ['<html>\n', '<html lang="en">\n'] })).toThrow(/escapes/);
    expect(() =>
      applyTransaction(root, ws, [{ file: 'vendor/new.html', before: null, after: b('x') }]),
    ).toThrow(/escapes/);
    expect(readFileSync(join(outside, 'x.html'), 'utf8')).toBe('<html>\n');
    expect(existsSync(join(outside, 'new.html'))).toBe(false);
  });

  it('combines several fixes to one file into one edit from the original text', () => {
    const html =
      '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>x</title>\n</head>\n<body></body>\n</html>\n';
    const { root, read, ws } = repo({ 'index.html': html });
    const finding = (ruleId: string, reason: string): Finding =>
      ({
        fingerprint: ruleId,
        ruleId,
        url: 'http://127.0.0.1/',
        sources: [{ file: 'index.html', line: 2, reason, confidence: 'high' }],
        evidence: [],
      }) as unknown as Finding;
    const plans = planFixes(
      [
        finding('axe/html-has-lang', 'renders <html>'),
        finding('jourilo/missing-viewport-meta', 'document head, no viewport'),
      ],
      root,
    );
    expect(plans).toHaveLength(2);
    const edits = composeEdits(plans);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.before).toBe(html);
    const tx = applyTransaction(root, ws, [
      { file: 'index.html', before: b(html), after: b(edits[0]!.after) },
    ]);
    expect(read('index.html')).toMatch(/lang="en"[\s\S]*name="viewport"/);
    rollbackTransaction(ws, tx);
    expect(read('index.html')).toBe(html);
  });
});

describe('checkpoints', () => {
  it('rolls back everything since the checkpoint, keeps the overwritten versions and can be undone', () => {
    const { root, read, ws } = repo({ 'a.html': 'one\n', 'b.css': 'b{}\n' });
    const cp = createCheckpoint(root, ws, 'before agent edits');
    writeFileSync(join(root, 'a.html'), 'agent edit\n');
    writeFileSync(join(root, 'b.css'), 'my own edit\n');
    writeFileSync(join(root, 'new.css'), 'x{}');
    const r = rollbackCheckpoint(root, cp, ws);
    expect(r.restored.sort()).toEqual(['a.html', 'b.css']);
    expect(r.leftUntracked).toEqual(['new.css']);
    expect([read('a.html'), read('b.css')]).toEqual(['one\n', 'b{}\n']);
    markRolledBack(ws, cp, r.transaction!.id);
    // `rollback latest` does not pick the rollback itself (that would silently undo it) nor the used checkpoint.
    expect(() => loadCheckpoint(ws, 'latest')).toThrow(/not found/);
    // Undo the rollback explicitly: both edits come back.
    rollbackTransaction(ws, r.transaction!);
    expect([read('a.html'), read('b.css')]).toEqual(['agent edit\n', 'my own edit\n']);
  });

  it('can restore selected files only', () => {
    const { root, read, ws } = repo({ 'a.html': 'one\n', 'b.css': 'b{}\n' });
    const cp = createCheckpoint(root, ws);
    writeFileSync(join(root, 'a.html'), 'agent edit\n');
    writeFileSync(join(root, 'b.css'), 'my own edit\n');
    rollbackCheckpoint(root, cp, ws, { files: ['a.html'] });
    expect([read('a.html'), read('b.css')]).toEqual(['one\n', 'my own edit\n']);
  });

  it('keeps CRLF working copies CRLF', () => {
    const { root, ws } = repo({ 'b.txt': 'one\ntwo\n' });
    writeFileSync(join(root, 'b.txt'), 'one\r\ntwo\r\n');
    const cp = createCheckpoint(root, ws, 'crlf');
    writeFileSync(join(root, 'b.txt'), 'one\r\nTWO\r\n');
    rollbackCheckpoint(root, cp, ws);
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('one\r\ntwo\r\n');
  });

  it('restores a tracked file deleted since the checkpoint', () => {
    const { root, read, ws } = repo({ 'a.html': 'one\n' });
    const cp = createCheckpoint(root, ws);
    execFileSync('rm', [join(root, 'a.html')]);
    rollbackCheckpoint(root, cp, ws);
    expect(read('a.html')).toBe('one\n');
  });
});

describe('saved sessions', () => {
  it('detects a session file that git would commit', () => {
    const { root } = repo({ '.gitignore': '.jourilo/\n' });
    expect(wouldBeCommitted(join(root, 'auth.json'))).toBe(true);
    expect(wouldBeCommitted(join(root, 'secrets', 'auth.json'))).toBe(true);
    expect(wouldBeCommitted(join(root, '.jourilo', 'auth.json'))).toBe(false);
    expect(wouldBeCommitted(join(mkdtempSync(join(tmpdir(), 'nogit-')), 'auth.json'))).toBe(false);
  });
});
