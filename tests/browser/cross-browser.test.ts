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
    const found = new Set(
      out.findings.map((f) => `${f.ruleId} ${new URL(f.url).pathname.replace(/(.)\/$/, '$1')}`),
    );
    // CLS and TBT need Chromium-only performance APIs; the run must say so instead of reporting zeros.
    const chromiumOnly = (rule: string) =>
      rule === 'jourilo/unsized-images' || rule === 'perf/cls' || rule === 'perf/tbt';
    expect(
      expected.mustFind.filter(
        (e) => !chromiumOnly(e.rule) && !found.has(`${e.rule} ${e.path.replace(/(.)\/$/, '$1')}`),
      ),
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
    // Lab timings depend on the runner's speed, so performance findings are left out of the comparison.
    const behaviour = audit.findings.filter((f) => !f.ruleId.startsWith('perf/'));
    expect(
      behaviour.map((f) => `${f.ruleId} ${new URL(f.url).pathname.replace(/(.)\/$/, '$1')}`).sort(),
    ).toEqual(
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
      .map((f) => `${f.ruleId} ${new URL(f.url).pathname.replace(/(.)\/$/, '$1')}`)
      .sort();
    expect(formRules).toEqual(['a11y/errors-not-associated /login', 'ux/no-validation-feedback /signup']);
  });

  it("runs axe on a strict-CSP page and reports none of Jourilo's own injection as the site's error", (ctx) => {
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'audit',
        'fixtures/sites/csp-lab',
        '--url',
        '/downloads',
        '--url',
        '/team',
        '--viewports',
        'desktop',
        '--browser',
        browser,
        '--workspace',
        join(root, 'tests/.tmp', `xb-csp-${browser}`),
        '--json',
        '-q',
      ],
      { encoding: 'utf8', cwd: root },
    );
    if (r.status === 4) ctx.skip();
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout) as {
      findings: { ruleId: string; url: string; evidence: { snippet?: string }[] }[];
      limitations: string[];
    };
    const at = (rule: string, path: string) =>
      out.findings.filter((f) => f.ruleId === rule && new URL(f.url).pathname === path);
    // script-src and style-src allow only nonces: axe still runs, and neither its injection nor the screenshot
    // style Playwright adds in WebKit is reported against the page.
    expect(at('axe/button-name', '/downloads')).toHaveLength(1);
    expect(at('jourilo/console-errors', '/downloads')).toEqual([]);
    expect(out.limitations.filter((l) => /axe/i.test(l))).toEqual([]);
    // The site's own CSP refusal (its inline e-mail decoder) is still reported.
    const team = at('jourilo/console-errors', '/team')[0];
    expect(
      team?.evidence.some((e) => /inline script|Refused to execute a script/i.test(e.snippet ?? '')),
    ).toBe(true);
  });
});
