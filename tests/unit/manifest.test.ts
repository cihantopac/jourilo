import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/audit/engine.js';
import { writeManifest } from '../../src/core/manifest.js';
import { Workspace } from '../../src/core/workspace.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('manifest', () => {
  it('manifest lists every artifact with its size and sha256', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-manifest-'));
    mkdirSync(join(dir, 'screenshots'));
    writeFileSync(join(dir, 'run.json'), '{"a":1}\n');
    writeFileSync(join(dir, 'report.md'), '# Report\n');
    writeFileSync(join(dir, 'screenshots', 'home.png'), 'png-bytes');
    writeFileSync(join(dir, 'manifest.json'), 'stale');

    const m = writeManifest(dir, 'r1');
    expect(m).toEqual({
      schemaVersion: 1,
      runId: 'r1',
      files: [
        { path: 'report.md', bytes: 9, sha256: sha('# Report\n') },
        { path: 'run.json', bytes: 8, sha256: sha('{"a":1}\n') },
        { path: 'screenshots/home.png', bytes: 9, sha256: sha('png-bytes') },
      ],
    });
    expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toEqual(m);
    // Rewriting regenerates it: the stale manifest itself is never listed.
    expect(writeManifest(dir, 'r1').files.map((f) => f.path)).not.toContain('manifest.json');
  });
});

describe('--run-id', () => {
  const opts = (runId: string) =>
    ({ target: 'http://localhost:1', runId, viewports: [], browser: 'chromium' }) as never;

  it('--run-id is validated and never overwrites a run', async () => {
    const ws = new Workspace(mkdtempSync(join(tmpdir(), 'jourilo-ws-')));
    for (const bad of ['', '-x', '../x', 'a/b', 'a b', 'x'.repeat(65)]) {
      await expect(runAudit(ws, opts(bad))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    const dir = ws.createRunDir('nightly-1');
    writeFileSync(join(dir, 'run.json'), 'keep me');
    await expect(runAudit(ws, opts('nightly-1'))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Run nightly-1 already exists.',
    });
    expect(readFileSync(join(dir, 'run.json'), 'utf8')).toBe('keep me');
  });
});
