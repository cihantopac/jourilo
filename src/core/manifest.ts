// manifest.json: every artifact of a run with its size and sha256, so a pipeline can verify what it archives, and
// what produced them (tool, browser and axe-core versions) on which scope (F35).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { redactUrl } from './redact.js';
import type { Run } from './types.js';

export interface Manifest {
  schemaVersion: 1;
  runId: string;
  tool: { name: 'jourilo'; version: string };
  browser: { name: string; version: string };
  /** The axe-core version the run's pages were checked with, or the bundled one when no page was checked. */
  axe: { version: string };
  /** The redacted target, the audited URLs and the viewports. */
  scope: { target: string; urls: string[]; viewports: string[] };
  files: { path: string; bytes: number; sha256: string }[];
}

type ManifestRun = Pick<Run, 'id' | 'tool' | 'target' | 'browser' | 'viewports' | 'settings' | 'pages'>;

const MANIFEST_FILE = 'manifest.json';
// The browser's process ids exist only while it runs (see browser/session.ts); never an artifact of the run.
const TRANSIENT_FILE = 'browser.pids';

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile() && rel !== MANIFEST_FILE && rel !== TRANSIENT_FILE) out.push(rel);
  }
  return out;
}

/**
 * The scope as `jourilo verify` would repeat it (`settings.scope`); runs without one (journeys, older runs) list their
 * captured pages. Every URL is redacted again: `settings.scope` keeps the URLs as requested.
 */
function scopeOf(run: ManifestRun): Manifest['scope'] {
  const recorded = run.settings.scope as { urls?: unknown; viewports?: unknown } | undefined;
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;
  const urls = strings(recorded?.urls) ?? run.pages.map((p) => p.url);
  const viewports = strings(recorded?.viewports) ?? run.viewports.map((v) => v.name);
  return { target: redactUrl(run.target), urls: [...new Set(urls.map(redactUrl))], viewports };
}

/** Hashes every file under `runDir` (except manifest.json itself) and writes manifest.json there. */
export function writeManifest(runDir: string, run: ManifestRun): Manifest {
  const files = listFiles(runDir)
    .sort()
    .map((path) => {
      const data = readFileSync(join(runDir, path));
      return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    });
  const axeVersion = run.settings.axe;
  const manifest: Manifest = {
    schemaVersion: 1,
    runId: run.id,
    tool: { name: 'jourilo', version: run.tool.version },
    browser: { name: run.browser.name, version: run.browser.version },
    axe: { version: typeof axeVersion === 'string' ? axeVersion : axe.version },
    scope: scopeOf(run),
    files,
  };
  writeFileSync(join(runDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
