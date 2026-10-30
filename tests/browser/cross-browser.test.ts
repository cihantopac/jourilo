// The seeded defects must be found in Firefox and WebKit too. Skipped (not failed) when a browser is not installed;
// CI installs all three.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const expected = JSON.parse(readFileSync(join(root, 'fixtures/sites/acme-saas/expected.json'), 'utf8')) as {
  mustFind: { rule: string; path: string }[];
};

describe.each(['firefox', 'webkit'])('%s', (browser) => {
  it('finds every seeded defect in acme-saas', (ctx) => {
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'audit',
        'fixtures/sites/acme-saas',
        '--browser',
        browser,
        '--workspace',
        join(root, 'tests/.tmp', `xb-${browser}`),
        '--json',
        '-q',
      ],
      { encoding: 'utf8', cwd: root },
    );
    if (r.status === 4) ctx.skip();
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as { findings: { ruleId: string; url: string }[] };
    const found = new Set(out.findings.map((f) => `${f.ruleId} ${new URL(f.url).pathname}`));
    expect(expected.mustFind.filter((e) => !found.has(`${e.rule} ${e.path}`))).toEqual([]);
  });
});
