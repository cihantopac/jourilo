import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeBrowsing, emptyInventory } from '../../src/audit/engine.js';
import {
  firstScreenLimitation,
  journeyStepsToKeep,
  pruneFullPageScreenshots,
} from '../../src/audit/evidence.js';
import { makeFinding } from '../../src/audit/finding.js';
import type { Finding, PageCapture } from '../../src/core/types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function runDirWith(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'jourilo-evidence-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'screenshots'));
  for (const f of files) writeFileSync(join(dir, f), 'x');
  return dir;
}

const page = (path: string, viewport = 'desktop'): PageCapture => ({
  url: `https://example.test${path}`,
  finalUrl: `https://example.test${path}`,
  status: 200,
  title: path,
  viewport,
  screenshot: `screenshots/${path.slice(1)}-${viewport}.jpg`,
  loadMs: 1,
  metrics: [],
  consoleErrors: 0,
  failedRequests: 0,
  inventory: emptyInventory(),
});

const finding = (path: string, file: string): Finding =>
  makeFinding({
    ruleId: 'x/y',
    title: 't',
    category: 'usability',
    kind: 'defect',
    severity: 'moderate',
    confidence: 'high',
    provenance: 'measured',
    url: `https://example.test${path}`,
    viewport: 'desktop',
    description: 'd',
    impact: 'i',
    recommendation: 'r',
    standards: [],
    evidence: [{ type: 'element', file, rect: { x: 1, y: 2, width: 3, height: 4 } }],
  });

describe('pruneFullPageScreenshots', () => {
  it('deletes full-page shots no finding points at and keeps the rest', () => {
    const pages = [page('/a'), page('/b'), page('/c'), page('/d')];
    const dir = runDirWith([
      ...pages.map((p) => p.screenshot!),
      ...pages.map((p) => p.screenshot!.replace('.jpg', '-fold.jpg')),
    ]);
    const kept = finding('/a', 'screenshots/a-desktop.jpg');
    const dismissed = finding('/b', 'screenshots/b-desktop.jpg');
    const out = pruneFullPageScreenshots(dir, pages, [kept, dismissed]);
    expect(out.pruned.map((p) => p.url)).toEqual(['https://example.test/c', 'https://example.test/d']);
    expect(existsSync(join(dir, 'screenshots/a-desktop.jpg'))).toBe(true);
    expect(existsSync(join(dir, 'screenshots/b-desktop.jpg'))).toBe(true);
    expect(existsSync(join(dir, 'screenshots/c-desktop.jpg'))).toBe(false);
    expect(existsSync(join(dir, 'screenshots/d-desktop.jpg'))).toBe(false);
    for (const n of 'abcd') expect(existsSync(join(dir, `screenshots/${n}-desktop-fold.jpg`))).toBe(true);
    expect(pages[0]!.screenshot).toBe('screenshots/a-desktop.jpg');
    expect(pages[2]!.screenshot).toBeUndefined();
  });

  it('keeps a shot that is referenced from a page and viewport it does not belong to', () => {
    const pages = [page('/a', 'desktop'), page('/a', 'mobile')];
    const dir = runDirWith(pages.map((p) => p.screenshot!));
    const out = pruneFullPageScreenshots(dir, pages, [finding('/a', 'screenshots/a-mobile.jpg')]);
    expect(out.pruned.map((p) => p.viewport)).toEqual(['desktop']);
  });
});

describe('pruneFullPageScreenshots single-screen pages', () => {
  it('never deletes a file the fold still uses', () => {
    const pages = [page('/a'), page('/b')];
    const dir = runDirWith(pages.map((p) => p.screenshot!));
    const out = pruneFullPageScreenshots(dir, pages, [], [pages[0]!.screenshot]);
    expect(out.pruned.map((p) => p.url)).toEqual(['https://example.test/b']);
    expect(existsSync(join(dir, 'screenshots/a-desktop.jpg'))).toBe(true);
  });
});

describe('firstScreenLimitation', () => {
  it('names the pages that only have the first screen', () => {
    const msg = firstScreenLimitation([page('/pricing', 'mobile'), page('/about')]);
    expect(msg).toContain('--evidence minimal');
    expect(msg).toContain('/pricing (mobile)');
    expect(msg).toContain('/about (desktop)');
    expect(msg).toMatch(/first screen/);
  });
  it('shortens a long list', () => {
    const many = Array.from({ length: 14 }, (_, i) => page(`/p${i}`));
    expect(firstScreenLimitation(many)).toContain('and 4 more');
  });
});

describe('journeyStepsToKeep', () => {
  const s = (status: string) => ({ status, screenshot: 'x.jpg' }) as never;
  it('keeps the failed step, the one before it and the final step', () => {
    const keep = journeyStepsToKeep([s('passed'), s('passed'), s('passed'), s('failed')]);
    expect([...keep].sort()).toEqual([2, 3]);
  });
  it('keeps the first step and the final one when the first step fails', () => {
    expect([...journeyStepsToKeep([s('failed'), s('skipped'), s('skipped')])]).toEqual([0]);
  });
  it('keeps only the last executed step of a passing journey', () => {
    expect([...journeyStepsToKeep([s('passed'), s('passed'), s('passed')])]).toEqual([2]);
  });
});

describe('closeBrowsing', () => {
  it('setup-state.json is removed when closing the session fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jourilo-close-'));
    const state = join(dir, 'setup-state.json');
    writeFileSync(state, '{}');
    try {
      await expect(
        closeBrowsing(
          {
            close: async () => {
              throw new Error('browser crashed');
            },
          },
          state,
        ),
      ).rejects.toThrow('browser crashed');
      expect(existsSync(state)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
