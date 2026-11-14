#!/usr/bin/env node
// CI guard: the committed plugin/dist bundle and generated docs must match a fresh build of src/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'jourilo-dist-'));
execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs'), tmp], { stdio: 'inherit' });
const norm = (s) => s.replace(/\r\n/g, '\n');
let ok = true;
// The CLI bundle, its TypeScript parser chunk and the bundled licenses.
for (const f of [
  'jourilo.mjs',
  'ts-parser.mjs',
  ...readdirSync(join(tmp, 'licenses')).map((l) => `licenses/${l}`),
]) {
  const committedFile = join(root, 'plugin', 'dist', f);
  const fresh = norm(readFileSync(join(tmp, f), 'utf8'));
  if (!existsSync(committedFile) || norm(readFileSync(committedFile, 'utf8')) !== fresh) {
    console.error(`plugin/dist/${f} is out of date. Run \`npm run build\` and commit the result.`);
    ok = false;
  }
}
const md = norm(
  execFileSync(process.execPath, [join(tmp, 'jourilo.mjs'), '__cli-markdown'], { encoding: 'utf8' }),
);
for (const f of ['docs/CLI.md', 'plugin/skills/jourilo/references/cli.md']) {
  if (norm(readFileSync(join(root, f), 'utf8')) !== md) {
    console.error(`${f} is out of date. Run \`npm run build\`.`);
    ok = false;
  }
}
if (!ok) process.exit(1);
console.log('dist and generated docs are up to date.');
