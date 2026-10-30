// Checkpoint/rollback must restore files byte for byte, including under core.autocrlf=true (the Windows default),
// where `git restore` would rewrite LF files with CRLF.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupFiles, createCheckpoint, rollback } from '../../src/repair/git.js';

function repo(autocrlf: boolean, files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'jourilo-git-'));
  const git = (...a: string[]) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'core.autocrlf', autocrlf ? 'true' : 'false');
  for (const [f, c] of Object.entries(files)) writeFileSync(join(root, f), c);
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'init');
  return { root, git, ws: mkdtempSync(join(tmpdir(), 'jourilo-ws-')) };
}

describe('rollback', () => {
  it.each([false, true])('restores LF files byte for byte (autocrlf=%s) using backups', (autocrlf) => {
    const original = '<html>\n<body>hi</body>\n</html>\n';
    const { root, git, ws } = repo(autocrlf, { 'a.html': original });
    const cp = createCheckpoint(root, ws, 'test');
    backupFiles(root, ws, cp, ['a.html']);
    writeFileSync(join(root, 'a.html'), original.replace('hi', 'changed'));
    writeFileSync(join(root, 'new.css'), 'x{}');
    const r = rollback(root, cp, ws);
    expect(r.restored).toEqual(['a.html']);
    expect(r.leftUntracked).toEqual(['new.css']);
    expect(readFileSync(join(root, 'a.html'), 'utf8')).toBe(original);
    expect(git('status', '--short', '--', 'a.html')).toBe('');
  });

  it('keeps CRLF working copies CRLF when no backup exists', () => {
    const { root, ws } = repo(false, { 'b.txt': 'one\ntwo\n' });
    writeFileSync(join(root, 'b.txt'), 'one\r\ntwo\r\n');
    const cp = createCheckpoint(root, ws, 'crlf');
    writeFileSync(join(root, 'b.txt'), 'one\r\nTWO\r\n');
    rollback(root, cp, ws);
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('one\r\ntwo\r\n');
  });
});
