// Path handling for anything derived from user input, page content or run data.
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { JouriloError } from './errors.js';

/** Resolves `child` inside `root` and refuses anything that escapes it (../, absolute paths, symlinks). */
export function resolveInside(root: string, child: string): string {
  if (child.includes('\0')) throw new JouriloError('UNSAFE_PATH', 'Path contains a NUL byte.');
  const base = existsSync(root) ? realpathSync(root) : resolve(root);
  const target = resolve(base, child);
  const real = existsSync(target) ? realpathSync(target) : target;
  const rel = relative(base, real);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return real;
  throw new JouriloError('UNSAFE_PATH', `Path escapes ${root}: ${child}`);
}

export function writeFileSafe(
  path: string,
  data: string | Uint8Array,
  opts: { private?: boolean } = {},
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, opts.private ? { mode: 0o600 } : undefined);
  if (opts.private) chmodSync(path, 0o600);
}

/** Converts a run-relative path into forward-slash form for reports and JSON. */
export function toPosix(p: string): string {
  return p.split(sep).join('/');
}

/** Path for display in reports: relative to the working directory when inside it, else with ~ for the home dir. */
export function displayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  if (rel === '') return '.';
  if (!rel.startsWith('..') && !isAbsolute(rel)) return toPosix(rel);
  const home = homedir();
  return toPosix(p.startsWith(home) ? `~${p.slice(home.length)}` : p);
}
