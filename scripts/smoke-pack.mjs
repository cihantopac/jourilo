#!/usr/bin/env node
// Clean-install smoke test of the package exactly as it would be published: `npm pack`, install the tarball into an
// empty project, and run every advertised command from that installation (never from this repository) against
// copies of the fixtures. Fails on the first command that does not behave as documented.
//
// Usage: node scripts/smoke-pack.mjs [--keep]   (needs network access for npm install; browsers may be cached)
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const work = mkdtempSync(join(tmpdir(), 'jourilo-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];

function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, detail: err.message });
    console.error(`✗ ${name}\n${err.message}`);
    finish(1);
  }
}

function finish(code) {
  writeFileSync(join(work, 'smoke-results.json'), JSON.stringify(results, null, 2));
  if (!keep && code === 0) rmSync(work, { recursive: true, force: true });
  else console.log(`Work directory kept: ${work}`);
  process.exit(code);
}

// 1. Pack and install into an empty project.
let tarball;
step('npm pack', () => {
  const out = execFileSync(npm, ['pack', '--json', '--pack-destination', work], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const info = JSON.parse(out)[0];
  tarball = join(work, info.filename);
  const files = info.files.map((f) => f.path);
  for (const bad of files.filter((f) =>
    /(^|\/)(\.jourilo|tests|fixtures|src|branding|node_modules)\//.test(f),
  ))
    throw new Error(`unexpected file in package: ${bad}`);
  if (!files.includes('plugin/dist/jourilo.mjs')) throw new Error('bundled CLI missing from the package');
  if (!files.includes('plugin/dist/ts-parser.mjs'))
    throw new Error('TypeScript parser chunk missing from the package');
  return `${info.filename}, ${files.length} files, ${(info.size / 1024).toFixed(0)} kB`;
});

const app = join(work, 'app');
mkdirSync(app);
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
step('npm install <tarball>', () => {
  execFileSync(npm, ['install', '--no-audit', '--no-fund', tarball], {
    cwd: app,
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  return 'installed';
});

const bin = join(app, 'node_modules', 'jourilo', 'plugin', 'dist', 'jourilo.mjs');
const ws = join(work, 'ws');
function jourilo(args, { expect = [0], json = true } = {}) {
  const r = spawnSync(
    process.execPath,
    [bin, ...args, '--workspace', ws, ...(json ? ['--json'] : []), '-q'],
    {
      cwd: app,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  if (!expect.includes(r.status))
    throw new Error(`jourilo ${args.join(' ')} exited ${r.status}\n${(r.stderr || r.stdout).slice(0, 3000)}`);
  return json && r.stdout.trim() ? JSON.parse(r.stdout) : r.stdout;
}

const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
step('jourilo --version', () => {
  const out = jourilo(['--version'], { json: false }).trim();
  if (!out.includes(pkgVersion)) throw new Error(`version ${out} != ${pkgVersion}`);
  return out;
});
step('jourilo --help lists every command', () => {
  const out = jourilo(['--help'], { json: false });
  for (const c of [
    'discover',
    'audit',
    'journeys',
    'optimize',
    'verify',
    'rollback',
    'report',
    'setup',
    'doctor',
  ])
    if (!out.includes(`  ${c} `)) throw new Error(`help does not list ${c}`);
});
step('jourilo setup (chromium)', () => {
  jourilo(['setup', '--browser', 'chromium'], { json: false });
});
step('jourilo doctor', () => {
  const d = jourilo(['doctor']);
  return JSON.stringify(d).slice(0, 120);
});
step('invalid input fails cleanly', () => {
  const r = spawnSync(process.execPath, [bin, 'audit', 'file:///etc/passwd', '--json'], {
    encoding: 'utf8',
    cwd: app,
  });
  if (r.status === 0 || !/http/.test(r.stderr + r.stdout))
    throw new Error(`unexpected: ${r.status} ${r.stderr}`);
  return `exit ${r.status}`;
});

// 2. Fixtures copied out of the repository.
const site = join(work, 'acme');
cpSync(join(root, 'fixtures', 'sites', 'acme-saas'), site, { recursive: true });
const repo = join(work, 'next-saas');
cpSync(join(root, 'fixtures', 'repos', 'next-saas'), repo, { recursive: true });

step('jourilo discover <repo>', () => {
  const d = jourilo(['discover', repo]);
  const routes = d.profile.apps.flatMap((a) => a.routes).length;
  if (!routes) throw new Error('no routes found');
  return `${routes} routes`;
});
let runId;
step('jourilo audit <dir> --repo', () => {
  const a = jourilo(['audit', site, '--pages', '4', '--repo', site, '--allow-submit'], { expect: [0, 1] });
  runId = a.runId;
  if (!a.findings.length) throw new Error('no findings on a fixture with seeded defects');
  return `${a.findings.length} findings`;
});
step('jourilo report (html, markdown, sarif)', () => {
  for (const f of ['html', 'md', 'sarif', 'json']) jourilo(['report', runId, '--format', f], { json: false });
});
step('jourilo journeys suggest + run', () => {
  jourilo(['journeys', 'suggest', runId]);
  const r = jourilo(['journeys', 'run', '--base', site], { expect: [0, 1] });
  return `${r.journeys.length} journeys: ${r.journeys.map((j) => j.status).join(', ')}`;
});
step('jourilo experiment size', () => {
  const s = jourilo(['experiment', 'size', '--baseline', '5%', '--mde', '20%']);
  return JSON.stringify(s).slice(0, 100);
});

// 3. Repair loop on a disposable git copy.
const git = (...a) => execFileSync('git', a, { cwd: site, stdio: 'pipe' });
git('init', '-q');
git('add', '-A');
git('-c', 'user.name=smoke', '-c', 'user.email=smoke@example.test', 'commit', '-qm', 'init');
let change;
step('jourilo optimize (dry run, then --apply)', () => {
  const plan = jourilo(['optimize', runId, '--repo', site]);
  if (!plan.fixes.length) throw new Error('no deterministic fixes planned');
  if (execFileSync('git', ['status', '--short'], { cwd: site, encoding: 'utf8' }).trim())
    throw new Error('dry run wrote files');
  const applied = jourilo(['optimize', runId, '--repo', site, '--apply']);
  change = applied.checkpoint;
  return `${applied.fixes.length} fixes, change ${change}`;
});
step('jourilo verify', () => {
  const v = jourilo(['verify', runId], { expect: [0, 1] });
  if (!v.fixed.length) throw new Error('verify found nothing fixed');
  if (!v.regressionFree) throw new Error(`regressions: ${JSON.stringify(v.introduced).slice(0, 500)}`);
  return `${v.fixed.length} fixed, ${v.introduced.length} new`;
});
step('jourilo rollback', () => {
  const r = jourilo(['rollback', change, '--yes']);
  const dirty = execFileSync('git', ['status', '--short'], { cwd: site, encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`files left modified after rollback:\n${dirty}`);
  return `${r.restored.length} restored`;
});
step('jourilo runs / compare', () => {
  const runs = jourilo(['runs']);
  if (runs.length < 2) throw new Error('expected at least two runs');
  const ids = runs.map((r) => r.id).sort();
  jourilo(['compare', ids[0], ids[ids.length - 1]], { json: false, expect: [0, 1] });
});
step('jourilo agent (adapters into a temp project)', () => {
  jourilo(['agent', 'install', 'codex', '--project', repo, '--write'], { json: false });
  if (!existsSync(join(repo, 'AGENTS.md'))) throw new Error('AGENTS.md not written');
});
finish(0);
