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
  audit?: { allowSubmit?: boolean };
};

describe.each(['firefox', 'webkit'])('%s', (browser) => {
  it('finds every seeded defect in acme-saas', (ctx) => {
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'audit',
        'fixtures/sites/acme-saas',
        '--pages',
        '8',
        '--browser',
        browser,
        '--workspace',
        join(root, 'tests/.tmp', `xb-${browser}`),
        '--json',
        '-q',
        // Same settings as the benchmark: the static fixture may receive real empty submissions.
        ...(expected.audit?.allowSubmit ? ['--allow-submit'] : []),
      ],
      { encoding: 'utf8', cwd: root },
    );
    if (r.status === 4) ctx.skip();
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      findings: { ruleId: string; url: string }[];
      limitations: string[];
    };
    const found = new Set(out.findings.map((f) => `${f.ruleId} ${new URL(f.url).pathname}`));
    // CLS and TBT need Chromium-only performance APIs; the run must say so instead of reporting zeros.
    const chromiumOnly = (rule: string) =>
      rule === 'jourilo/unsized-images' || rule === 'perf/cls' || rule === 'perf/tbt';
    expect(
      expected.mustFind.filter((e) => !chromiumOnly(e.rule) && !found.has(`${e.rule} ${e.path}`)),
    ).toEqual([]);
    expect(out.limitations.some((l) => /does not expose CLS/.test(l))).toBe(true);
  });

  it('runs journeys, saves a session and audits signed-in pages and forms like Chromium', (ctx) => {
    const ws = join(root, 'tests/.tmp', `xb-journeys-${browser}`);
    const app = 'fixtures/apps/pulse-dashboard';
    const run = (...a: string[]) =>
      spawnSync(process.execPath, [cli, ...a, '--browser', browser, '--workspace', ws, '--json', '-q'], {
        encoding: 'utf8',
        cwd: root,
      });
    const signIn = run(
      'journeys',
      'run',
      `${app}/journeys/sign-in.json`,
      '--base',
      app,
      '--var',
      'email=demo@example.test',
      '--var',
      'password=demo-password',
      '--save-auth',
      join(ws, 'auth.json'),
    );
    if (signIn.status === 4) ctx.skip();
    expect(JSON.parse(signIn.stdout).journeys[0].status).toBe('passed');
    const audit = JSON.parse(
      run(
        'audit',
        app,
        '--auth',
        join(ws, 'auth.json'),
        '--url',
        '/analytics',
        '--url',
        '/settings',
        '--viewports',
        'desktop',
        '--no-forms',
      ).stdout,
    ) as { findings: { ruleId: string; url: string }[]; limitations: string[] };
    // WebKit on Windows has no key that focuses links: the link-only check is reported as not run, not as passed.
    const linksSkipped = audit.limitations.some((l) => l.includes('does not move keyboard focus to links'));
    expect(linksSkipped).toBe(browser === 'webkit' && process.platform === 'win32');
    expect(audit.findings.map((f) => `${f.ruleId} ${new URL(f.url).pathname}`).sort()).toEqual(
      linksSkipped
        ? ['jourilo/keyboard-trap /analytics']
        : ['jourilo/focus-obscured /analytics', 'jourilo/keyboard-trap /analytics'],
    );
    const forms = JSON.parse(
      run(
        'audit',
        'fixtures/sites/acme-saas',
        '--url',
        '/login',
        '--url',
        '/signup',
        '--viewports',
        'desktop',
        // The fixture is static and disposable, so the server round trip of /signup may really be sent.
        '--allow-submit',
      ).stdout,
    ) as { findings: { ruleId: string; url: string }[] };
    const formRules = forms.findings
      .filter((f) => /validation|errors-not/.test(f.ruleId))
      .map((f) => `${f.ruleId} ${new URL(f.url).pathname}`)
      .sort();
    expect(formRules).toEqual(['a11y/errors-not-associated /login', 'ux/no-validation-feedback /signup']);
  });
});
