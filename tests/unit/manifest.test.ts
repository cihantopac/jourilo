import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { runAudit } from '../../src/audit/engine.js';
import { writeManifest } from '../../src/core/manifest.js';
import { Workspace } from '../../src/core/workspace.js';
import { run } from '../helpers.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('manifest', () => {
  it('manifest lists every artifact with its size and sha256', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-manifest-'));
    mkdirSync(join(dir, 'screenshots'));
    writeFileSync(join(dir, 'run.json'), '{"a":1}\n');
    writeFileSync(join(dir, 'report.md'), '# Report\n');
    writeFileSync(join(dir, 'screenshots', 'home.png'), 'png-bytes');
    writeFileSync(join(dir, 'manifest.json'), 'stale');
    writeFileSync(join(dir, 'browser.pids'), '123\n');

    const m = writeManifest(dir, run([], { id: 'r1' }));
    expect(m).toMatchObject({
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
    expect(m.files).toHaveLength(3);
    expect(writeManifest(dir, run([], { id: 'r1' })).files.map((f) => f.path)).not.toContain('manifest.json');
  });

  it('manifest carries tool, browser, axe versions and scope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-manifest-'));
    writeFileSync(join(dir, 'run.json'), '{}\n');
    // As a real audit records them: the target redacted (redactUrl), settings.axe from the page, settings.scope as requested.
    const audited = run([], {
      id: 'nightly-7',
      tool: { name: 'jourilo', version: '1.3.0' },
      target: 'http://127.0.0.1:4173/?token=[redacted]',
      browser: { name: 'chromium', version: '147.0.7727.15' },
      settings: {
        axe: '4.14.0',
        hostClass: 'local',
        scope: {
          urls: ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/pricing?token=s3cret'],
          viewports: ['desktop', 'mobile'],
        },
      },
    });
    const m = writeManifest(dir, audited);
    expect(m.tool).toEqual({ name: 'jourilo', version: '1.3.0' });
    expect(m.browser).toEqual({ name: 'chromium', version: '147.0.7727.15' });
    expect(m.axe).toEqual({ version: '4.14.0' });
    expect(m.scope).toEqual({
      target: 'http://127.0.0.1:4173/?token=[redacted]',
      urls: ['http://127.0.0.1:4173/', 'http://127.0.0.1:4173/pricing?token=[redacted]'],
      viewports: ['desktop', 'mobile'],
    });
    const written = readFileSync(join(dir, 'manifest.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(m);
    expect(written).not.toContain('s3cret');
    // The versions come first, then the files.
    expect(Object.keys(m)).toEqual(['schemaVersion', 'runId', 'tool', 'browser', 'axe', 'scope', 'files']);
  });

  it('a run without settings.axe or settings.scope (discover, journeys) still gets versions and a scope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-manifest-'));
    writeFileSync(join(dir, 'run.json'), '{}\n');
    const journeyRun = run([], {
      target: 'https://user:pw@staging.example.test/?session=abc',
      settings: { journeys: ['signup'], axe: null },
      pages: [
        { url: 'https://staging.example.test/', viewport: 'desktop' },
        { url: 'https://staging.example.test/', viewport: 'mobile' },
      ] as never,
    });
    const m = writeManifest(dir, journeyRun);
    // No page was checked by axe: the version is the bundled axe-core's.
    expect(m.axe).toEqual({ version: (axe as unknown as { version: string }).version });
    expect(m.scope).toEqual({
      target: 'https://[redacted:email]/?session=redacted',
      urls: ['https://staging.example.test/'],
      viewports: ['desktop', 'mobile'],
    });
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
