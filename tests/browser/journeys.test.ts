// Journeys end-to-end on the acme-saas fixture: suggestion derives the expected journeys from real pages, the
// runner reports real outcomes, and the safety policy blocks risky steps.
import { execFile, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  it('clicks a target inside an open shadow root, which its own host does not cover', () => {
    const j = clickJourney('shadow-target', 'shadow.html');
    const step = j.steps[1];
    expect(step.status, step.error).toBe('passed');
    expect(step.description).not.toContain('covered');
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
    // The session cookies the setup journey saved are not left in the run directory.
    expect(existsSync(join(out.runDir, 'setup-state.json'))).toBe(false);
    expect(readFileSync(join(out.runDir, 'manifest.json'), 'utf8')).not.toContain('setup-state');
  });

  it('a stopped audit with a setup journey and minimal evidence is partial and leaves no session state', () => {
    const r = jourilo(
      'audit',
      'fixtures/apps/journey-lab',
      '--pages',
      '10',
      '--viewports',
      'desktop,mobile',
      '--runs',
      '3',
      '--evidence',
      'minimal',
      '--max-duration',
      '2',
      '--setup-journey',
      'fixtures/apps/journey-lab/dark.json',
    );
    expect(r.status, r.stderr).toBe(6);
    const out = JSON.parse(r.stdout);
    const run = JSON.parse(readFileSync(join(out.runDir, 'run.json'), 'utf8'));
    expect(run.outcome).toBe('partial');
    expect(run.stoppedBy).toBe('max-duration');
    expect(existsSync(join(out.runDir, 'setup-state.json'))).toBe(false);
    expect(readFileSync(join(out.runDir, 'manifest.json'), 'utf8')).not.toContain('setup-state');
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

function writeFlakyLab(): void {
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
}

describe('journeys --repeat --evidence minimal', () => {
  it('keeps every screenshot the representative attempt refers to', () => {
    writeFlakyLab();
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

  it('repeat attempts keep their own step screenshots', () => {
    writeFlakyLab();
    const r = jourilo(
      'journeys',
      'run',
      'flaky-lab',
      '--base',
      'fixtures/apps/journey-lab',
      '--repeat',
      '2',
      '--timeout',
      '2',
    );
    const out = JSON.parse(r.stdout) as {
      runDir: string;
      journeys: { steps: { screenshot?: string }[] }[];
    };
    const shots = out.journeys[0]!.steps.map((s) => s.screenshot).filter((f): f is string => !!f);
    expect(shots.length).toBeGreaterThan(0);
    for (const f of shots) {
      expect(f).toMatch(/-a[12]-\d\d\.jpg$/);
      expect(existsSync(join(out.runDir, f)), f).toBe(true);
    }
    const files = readdirSync(join(out.runDir, 'screenshots')).filter((f) =>
      f.startsWith('journey-flaky-lab-'),
    );
    expect(files.some((f) => f.includes('-a1-'))).toBe(true);
    expect(files.some((f) => f.includes('-a2-'))).toBe(true);
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

describe('journeys across tabs and popups', () => {
  // The app on 127.0.0.1 and the test IdP on localhost: one local server, two origins. Every request is logged by
  // origin, so a blocked popup can be shown never to have reached the IdP.
  const lab = join(root, 'fixtures', 'apps', 'journey-lab');
  const requests: string[] = [];
  const servers: Server[] = [];
  let app = '';
  let idp = '';

  beforeAll(async () => {
    const handler: RequestListener = (req, res) => {
      requests.push(`${req.headers.host} ${req.url}`);
      // Like a real "/auth/provider" route: a 302 to the IdP on the other loopback name.
      if (req.url === '/oauth/start') {
        const [host, port] = (req.headers.host ?? '').split(':');
        const other = host === 'localhost' ? '127.0.0.1' : 'localhost';
        const back = encodeURIComponent(`http://${req.headers.host}`);
        res
          .writeHead(302, { location: `http://${other}:${port}/oauth/idp.html?return_origin=${back}` })
          .end();
        return;
      }
      const path = join(lab, new URL(req.url ?? '/', 'http://x').pathname);
      if (!path.startsWith(lab) || !existsSync(path)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(path));
    };
    const v4 = createServer(handler);
    await new Promise<void>((done) => v4.listen(0, '127.0.0.1', done));
    servers.push(v4);
    const { port } = v4.address() as AddressInfo;
    // Jourilo's network guard connects to the first address "localhost" resolves to, which may be ::1.
    const v6 = createServer(handler);
    await new Promise<void>((done) => {
      v6.once('error', () => done());
      v6.listen(port, '::1', () => {
        servers.push(v6);
        done();
      });
    });
    app = `http://127.0.0.1:${port}`;
    idp = `http://localhost:${port}`;
  });
  afterAll(() => Promise.all(servers.map((s) => new Promise<void>((done) => s.close(() => done())))));

  const runTabs = async (id: string, start: string, steps: unknown[], ...flags: string[]) => {
    const dir = join(ws, 'journeys');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        version: 1,
        id,
        name: id,
        start,
        steps,
        success: [{ description: 'No script errors', noPageErrors: true }],
      }),
    );
    // Asynchronous: the fixture server lives in this process and must keep answering while the run goes on.
    const r = await promisify(execFile)(
      process.execPath,
      [
        cli,
        'journeys',
        'run',
        id,
        '--base',
        app,
        '--timeout',
        '5',
        ...flags,
        '--workspace',
        ws,
        '--json',
        '-q',
      ],
      { encoding: 'utf8', cwd: root },
    ).catch((err: { stdout: string }) => err);
    return JSON.parse(r.stdout) as {
      journeys: {
        status: string;
        steps: { action: string; status: string; url: string; error?: string; screenshot?: string }[];
        blockedRequests?: { url: string }[];
      }[];
      findings: { ruleId: string; description: string }[];
      runDir: string;
    };
  };

  const oauthSteps = [
    { action: 'click', target: { role: 'button', name: 'Sign in with Test IdP' } },
    { action: 'waitForPopup', urlMatch: '/oauth/idp' },
    { action: 'fill', target: { label: 'Email' }, value: '{{email}}' },
    { action: 'click', target: { role: 'button', name: 'Sign in', exact: true } },
    { action: 'switchTab', index: 0 },
    { action: 'expect', visible: { text: 'Signed in' } },
  ];

  const idpHits = () => requests.filter((r) => r.startsWith('localhost:'));

  it('a journey signs in through an OAuth popup on a local test IdP', async () => {
    requests.length = 0;
    const out = await runTabs('oauth-popup', '/oauth/index.html', oauthSteps, '--allow-origin', idp);
    const j = out.journeys[0]!;
    expect(j.status, JSON.stringify(j.steps)).toBe('passed');
    expect(j.steps.map((s) => s.action)).toEqual([
      'goto',
      'click',
      'waitForPopup',
      'fill',
      'click',
      'switchTab',
      'expect',
    ]);
    // Each step's screenshot and URL come from the tab that was current after it: the IdP popup while it is open,
    // the app once the popup has closed itself.
    for (const s of j.steps) {
      expect(s.screenshot, s.action).toBeTruthy();
      expect(existsSync(join(out.runDir, s.screenshot!)), s.screenshot).toBe(true);
    }
    expect(j.steps[2]!.url).toContain(`${idp}/oauth/idp.html`);
    expect(j.steps[3]!.url).toContain(`${idp}/oauth/idp.html`);
    expect(j.steps[4]!.url).toContain(`${app}/oauth/index.html`);
    expect(j.steps[6]!.url).toContain(`${app}/oauth/index.html`);
    expect(j.blockedRequests).toBeUndefined();
    // Positive control for the hit counter the blocking tests rely on.
    expect(idpHits().length).toBeGreaterThan(0);
  }, 120_000);

  it('follows a redirect to an allowed IdP hop by hop', async () => {
    requests.length = 0;
    const out = await runTabs(
      'oauth-redirect',
      '/oauth/index.html',
      [
        { action: 'click', target: { role: 'button', name: 'Sign in through the app' } },
        ...oauthSteps.slice(1),
      ],
      '--allow-origin',
      idp,
    );
    const j = out.journeys[0]!;
    expect(j.status, JSON.stringify(j.steps)).toBe('passed');
    expect(j.steps[2]!.url).toContain(`${idp}/oauth/idp.html`);
    // Each hop was requested once: the guard's own fetch, not a second request by the browser.
    expect(requests.filter((r) => r.endsWith(' /oauth/start'))).toHaveLength(1);
    expect(idpHits().filter((r) => r.includes('/oauth/idp.html'))).toHaveLength(1);
  }, 120_000);

  it('a redirect to an origin not in allowOrigins is blocked, in a popup and in the main tab', async () => {
    requests.length = 0;
    const popup = await runTabs('redirect-popup-blocked', '/oauth/index.html', [
      { action: 'click', target: { role: 'button', name: 'Sign in through the app' } },
      { action: 'waitForPopup' },
    ]);
    const pj = popup.journeys[0]!;
    expect(pj.status, JSON.stringify(pj.steps)).toBe('blocked');
    const step = pj.steps.find((s) => s.status === 'blocked')!;
    // The redirect is judged once the popup's first hop has answered: during the click or the wait that follows.
    expect(['click', 'waitForPopup']).toContain(step.action);
    expect(step.error).toContain(`--allow-origin ${idp}`);
    expect(popup.findings.some((f) => f.ruleId === 'journey/blocked-by-policy')).toBe(true);
    // The first hop on the journey's origin was made; the redirect's target was never asked.
    expect(requests.some((r) => r.startsWith('127.0.0.1:') && r.endsWith(' /oauth/start'))).toBe(true);
    expect(idpHits()).toEqual([]);

    requests.length = 0;
    const main = await runTabs('redirect-main-blocked', '/oauth/start', [
      { action: 'expect', visible: { role: 'heading', name: 'Test IdP' } },
    ]);
    const mj = main.journeys[0]!;
    expect(mj.status).toBe('blocked');
    expect(mj.steps[0]!.status).toBe('blocked');
    expect(mj.steps[0]!.error).toContain(`--allow-origin ${idp}`);
    expect(requests.some((r) => r.endsWith(' /oauth/start'))).toBe(true);
    expect(idpHits()).toEqual([]);
  }, 120_000);

  it('a target=_blank link to an origin not in allowOrigins is blocked', async () => {
    requests.length = 0;
    const out = await runTabs('blank-link-blocked', '/oauth/index.html', [
      { action: 'click', target: { role: 'link', name: "Open the IdP's help in a new tab" } },
      { action: 'switchTab', index: 1 },
    ]);
    const j = out.journeys[0]!;
    expect(j.status).toBe('blocked');
    expect(j.steps.find((s) => s.status === 'blocked')!.error).toContain(`--allow-origin ${idp}`);
    expect(idpHits()).toEqual([]);
  }, 120_000);

  it('a popup to an origin not in allowOrigins is blocked', async () => {
    requests.length = 0;
    const out = await runTabs('oauth-popup-blocked', '/oauth/index.html', oauthSteps);
    const j = out.journeys[0]!;
    expect(j.status).toBe('blocked');
    const step = j.steps.find((s) => s.status === 'blocked')!;
    expect(step.action).toBe('click');
    expect(step.error).toContain(`--allow-origin ${idp}`);
    expect(out.findings.some((f) => f.ruleId === 'journey/blocked-by-policy')).toBe(true);
    // Stopped before the request left the browser: the IdP origin never saw it.
    expect(requests.some((r) => r.startsWith('127.0.0.1:'))).toBe(true);
    expect(idpHits()).toEqual([]);
  }, 120_000);

  it('a popup the page opens on its own is held to the same policy', async () => {
    requests.length = 0;
    const out = await runTabs('oauth-popup-unasked', '/oauth/index.html?auto=1', [
      { action: 'expect', visible: { role: 'heading', name: 'Test app' } },
    ]);
    const j = out.journeys[0]!;
    expect(j.status).toBe('blocked');
    expect(j.steps.find((s) => s.status === 'blocked')!.error).toContain(`--allow-origin ${idp}`);
    expect(idpHits()).toEqual([]);
  }, 120_000);

  it('a target=_blank link journey switches tabs and back', async () => {
    const out = await runTabs('new-tab', '/oauth/index.html', [
      { action: 'click', target: { role: 'link', name: 'Open help in a new tab' } },
      { action: 'switchTab', index: 1 },
      { action: 'expect', visible: { role: 'heading', name: 'Help' } },
      { action: 'switchTab', index: 0 },
      { action: 'expect', visible: { role: 'heading', name: 'Test app' } },
      { action: 'switchTab', urlMatch: '/oauth/help' },
      { action: 'closeTab' },
      { action: 'expect', visible: { role: 'heading', name: 'Test app' } },
    ]);
    const j = out.journeys[0]!;
    expect(j.status, JSON.stringify(j.steps)).toBe('passed');
    expect(j.steps.map((s) => new URL(s.url).pathname)).toEqual([
      '/oauth/index.html',
      '/oauth/index.html',
      '/oauth/help.html',
      '/oauth/help.html',
      '/oauth/index.html',
      '/oauth/index.html',
      '/oauth/help.html',
      // Closing the current tab makes its opener current again.
      '/oauth/index.html',
      '/oauth/index.html',
    ]);
    for (const s of j.steps) expect(s.screenshot, s.action).toBeTruthy();
  }, 120_000);
});
