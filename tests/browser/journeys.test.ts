// Journeys end-to-end on the acme-saas fixture: suggestion derives the expected journeys from real pages, the
// runner reports real outcomes, and the safety policy blocks risky steps.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const cli = join(root, 'plugin', 'dist', 'jourilo.mjs');
const ws = join(root, 'tests', '.tmp', 'journeys-ws');

const jourilo = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args, '--workspace', ws, '--json', '-q'], {
    encoding: 'utf8',
    cwd: root,
  });

beforeAll(() => {
  rmSync(ws, { recursive: true, force: true });
  spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')]);
});

async function foldIsDark(runDir: string, run: { pages: { screenshot: string }[] }): Promise<boolean> {
  const jpg = readFileSync(join(runDir, run.pages[0]!.screenshot.replace('.jpg', '-fold.jpg')));
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<canvas id=c></canvas><img id=i src="data:image/jpeg;base64,${jpg.toString('base64')}">`,
    );
    const px = await page.evaluate(async () => {
      const img = document.getElementById('i') as HTMLImageElement;
      await img.decode();
      const c = document.getElementById('c') as HTMLCanvasElement;
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(img.width - 20, img.height - 20, 1, 1).data);
    });
    return px[0]! + px[1]! + px[2]! < 150;
  } finally {
    await browser.close();
  }
}

describe('journeys', () => {
  it('suggests journeys from the pages it found', () => {
    const r = jourilo('journeys', 'suggest', 'fixtures/sites/acme-saas');
    expect(r.status, r.stderr).toBe(0);
    const ids = JSON.parse(r.stdout).journeys.map((j: { id: string }) => j.id);
    expect(ids).toEqual(
      expect.arrayContaining(['landing-primary-cta', 'signup-signup', 'login-login', 'pricing-to-signup']),
    );
  });

  it('runs them and reports real outcomes with evidence', () => {
    const r = jourilo(
      'journeys',
      'run',
      'login-login',
      'pricing-to-signup',
      'signup-signup',
      '--base',
      'fixtures/sites/acme-saas',
    );
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const status = Object.fromEntries(
      out.journeys.map((j: { id: string; status: string }) => [j.id, j.status]),
    );
    expect(status).toEqual({
      'login-login': 'passed',
      'pricing-to-signup': 'passed',
      'signup-signup': 'failed',
    });
    const signup = out.journeys.find((j: { id: string }) => j.id === 'signup-signup');
    expect(signup.steps.every((s: { screenshot?: string }) => s.screenshot)).toBe(true);
    // Password values never appear in step descriptions.
    expect(JSON.stringify(signup.steps)).not.toMatch(/Jr-/);
    expect(out.findings.some((f: { ruleId: string }) => f.ruleId === 'journey/failed')).toBe(true);
  });

  it('blocks payment actions unless explicitly allowed on a local host', () => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'pay.json'),
      JSON.stringify({
        version: 1,
        id: 'pay',
        name: 'Pay for the Starter plan (sandbox)',
        start: '/checkout',
        steps: [
          { action: 'fill', target: { label: 'Card number' }, value: '{{testCard}}' },
          { action: 'click', target: { role: 'button', name: 'Pay $19' } },
        ],
        success: [{ description: 'Arrives at the dashboard', url: '/dashboard' }],
      }),
    );
    const blocked = JSON.parse(
      jourilo('journeys', 'run', 'pay', '--base', 'fixtures/sites/acme-saas').stdout,
    );
    expect(blocked.journeys[0].status).toBe('blocked');
    expect(blocked.journeys[0].steps[2].error).toMatch(/--allow-destructive/);
    expect(blocked.findings.some((f: { ruleId: string }) => f.ruleId === 'journey/blocked-by-policy')).toBe(
      true,
    );
    const allowed = JSON.parse(
      jourilo('journeys', 'run', 'pay', '--base', 'fixtures/sites/acme-saas', '--allow-destructive').stdout,
    );
    expect(allowed.journeys[0].status).toBe('passed');
  });

  it('blocks a Turkish payment action ("Ödemeyi tamamla") on a local host by default', () => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'odeme.json'),
      JSON.stringify({
        version: 1,
        id: 'odeme',
        name: 'Siparişi tamamla',
        start: '/odeme',
        steps: [{ action: 'click', target: { role: 'link', name: 'Ödemeyi tamamla' } }],
        success: [{ description: 'Teşekkürler sayfası', url: '/tesekkurler' }],
      }),
    );
    const out = JSON.parse(jourilo('journeys', 'run', 'odeme', '--base', 'fixtures/sites/tr-dukkan').stdout);
    expect(out.journeys[0].status).toBe('blocked');
  });

  const clickJourney = (id: string, page: string) => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        version: 1,
        id,
        name: 'Click a covered button',
        start: `/${page}`,
        steps: [{ action: 'click', target: { role: 'button', name: 'Continue' } }],
        success: [{ description: 'No script errors', noPageErrors: true }],
      }),
    );
    const out = JSON.parse(
      jourilo('journeys', 'run', id, '--base', 'fixtures/apps/journey-lab', '--timeout', '3').stdout,
    );
    return out.journeys[0];
  };

  it('clicks the visible part of a partly covered target and says so', () => {
    const j = clickJourney('covered-partly', 'covered.html');
    const step = j.steps[1];
    expect(step.status, step.error).toBe('passed');
    expect(step.description).toContain('center covered by #panel');
    expect(step.description).toContain('clicked the visible part');
  });

  it('fails with the covering element when no part is visible', () => {
    const j = clickJourney('covered-fully', 'covered-full.html');
    const step = j.steps[1];
    expect(step.status).toBe('failed');
    expect(step.error).toMatch(/covered by #panel/);
    expect(step.error).not.toMatch(/^Timeout \d+ms exceeded/);
  });

  it('applies the state a setup journey leaves before auditing', async () => {
    const r = jourilo(
      'audit',
      'fixtures/apps/journey-lab',
      '--url',
      '/theme.html',
      '--viewports',
      'desktop',
      '--no-keyboard',
      '--setup-journey',
      'fixtures/apps/journey-lab/dark.json',
    );
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
    expect(run.settings.setupJourney).toBe('dark');
    const setup = run.journeys.find((j: { role?: string }) => j.role === 'setup');
    expect(setup).toMatchObject({ id: 'dark', status: 'passed' });
    expect(await foldIsDark(out.runDir, run)).toBe(true);
  });

  it('verify replays the setup journey of its baseline', async () => {
    mkdirSync(join(ws, 'journeys'), { recursive: true });
    copyFileSync(join(root, 'fixtures/apps/journey-lab/dark.json'), join(ws, 'journeys', 'dark.json'));
    const a = JSON.parse(
      jourilo(
        'audit',
        'fixtures/apps/journey-lab',
        '--url',
        '/theme.html',
        '--viewports',
        'desktop',
        '--no-keyboard',
        '--setup-journey',
        'dark',
      ).stdout,
    );
    const v = jourilo('verify', a.runId);
    expect(v.status, v.stderr).toBe(0);
    const vr = JSON.parse(v.stdout);
    const dir = join(ws, 'runs', vr.run);
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    expect(run.settings.setupJourney).toBe('dark');
    expect(await foldIsDark(dir, run)).toBe(true);
    // A baseline whose setup journey is gone is not silently audited in the default state.
    rmSync(join(ws, 'journeys', 'dark.json'));
    const gone = jourilo('verify', a.runId);
    expect(gone.status).toBe(2);
    expect(JSON.parse(gone.stderr).error.message).toMatch(/dark/);
  });

  it('stops the audit when the setup journey fails', () => {
    const r = jourilo(
      'audit',
      'fixtures/apps/journey-lab',
      '--url',
      '/theme.html',
      '--viewports',
      'desktop',
      '--timeout',
      '3',
      '--setup-journey',
      'fixtures/apps/journey-lab/dark-broken.json',
    );
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr).error;
    expect(err.code).toBe('JOURNEY_FAILED');
    expect(err.message).toMatch(/sepia theme/);
  });

  it('rejects invalid journey files with clear messages', () => {
    const invalid = join(ws, 'invalid.json');
    writeFileSync(
      invalid,
      JSON.stringify({ version: 1, id: 'Bad Id', name: 'x', start: '/', steps: [], success: [] }),
    );
    const v = jourilo('journeys', 'validate', invalid);
    expect(v.status).toBe(2);
    const msg = JSON.parse(v.stderr).error.message;
    expect(msg).toMatch(/id must be/);
    expect(msg).toMatch(/success must/);
  });
});

describe('journeys --repeat --evidence minimal', () => {
  it('keeps every screenshot the representative attempt refers to', () => {
    mkdirSync(join(ws, 'journeys'), { recursive: true });
    writeFileSync(
      join(ws, 'journeys', 'flaky-lab.json'),
      JSON.stringify({
        version: 1,
        id: 'flaky-lab',
        name: 'Flaky by test data',
        start: '/flaky.html',
        steps: [
          { action: 'fill', target: { label: 'Email' }, value: '{{email}}' },
          { action: 'click', target: { role: 'button', name: 'Continue' } },
          { action: 'screenshot' },
          { action: 'screenshot' },
        ],
        success: [{ description: 'No script errors', noPageErrors: true }],
      }),
    );
    const r = jourilo(
      'journeys',
      'run',
      'flaky-lab',
      '--base',
      'fixtures/apps/journey-lab',
      '--repeat',
      '2',
      '--evidence',
      'minimal',
      '--timeout',
      '2',
    );
    const out = JSON.parse(r.stdout) as {
      runDir: string;
      journeys: { stability?: string; steps: { screenshot?: string }[] }[];
      findings: { evidence: { file?: string }[] }[];
    };
    expect(out.journeys[0]!.stability).toBe('flaky');
    const files = [
      ...out.journeys.flatMap((j) => j.steps.map((s) => s.screenshot)),
      ...out.findings.flatMap((f) => f.evidence.map((e) => e.file)),
    ].filter((f): f is string => !!f);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(existsSync(join(out.runDir, f)), f).toBe(true);
  }, 120_000);

  it('inventories only toggles that can make a journey, before applying the cap', () => {
    const r = jourilo(
      'audit',
      'fixtures/apps/journey-lab',
      '--url',
      '/toggles.html',
      '--viewports',
      'desktop',
      '--no-keyboard',
    );
    expect(r.status, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
    expect(run.pages[0].inventory.toggles).toEqual([
      { selector: '#faq-btn', name: 'Shipping details', state: 'expanded', controls: 'faq-panel' },
      { selector: '#bold', name: 'Bold', state: 'pressed', controls: null },
    ]);
  });
});
