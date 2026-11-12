// manifest.json: every artifact of a run with its size and sha256, so a pipeline can verify what it archives.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Manifest {
  schemaVersion: 1;
  runId: string;
  files: { path: string; bytes: number; sha256: string }[];
}

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

/** Hashes every file under `runDir` (except manifest.json itself) and writes manifest.json there. */
export function writeManifest(runDir: string, runId: string): Manifest {
  const files = listFiles(runDir)
    .sort()
    .map((path) => {
      const data = readFileSync(join(runDir, path));
      return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    });
  const manifest: Manifest = { schemaVersion: 1, runId, files };
  writeFileSync(join(runDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
