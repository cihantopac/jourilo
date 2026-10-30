// Page capture: one real visit to one URL in one viewport, producing raw, redacted observations that the audit
// rules turn into findings. Nothing here judges; it only records what the browser saw and measured.
import { join } from 'node:path';
import axe from 'axe-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { toPosix } from '../core/fs-safety.js';
import { shortHash, slug } from '../core/hash.js';
import { excerpt, redactText, redactUrl } from '../core/redact.js';
import type { PageInventory, Rect, Viewport } from '../core/types.js';
import PROBE_SOURCE from './inpage/probe.js?raw';
import { type KeyboardWalk, keyboardWalk } from './keyboard.js';
import { type RawVitals, READ_VITALS_SCRIPT, VITALS_INIT_SCRIPT } from './vitals.js';
import { checkWidgets, type WidgetCheck } from './widgets.js';

export const DEFAULT_MASK = [
  'input[type="password"]',
  'input[autocomplete^="cc-"]',
  'input[name*="card" i]',
  'input[name*="cvc" i]',
  'input[name*="ssn" i]',
  '[data-jourilo-redact]',
  '[data-private]',
];

// esbuild's keepNames helper can leak into serialized functions; make it a no-op in every page.
const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((f) => f);';

export interface ConsoleEntry {
  type: 'error' | 'warning' | 'pageerror';
  text: string;
  location?: string;
}

export interface NetworkFailure {
  url: string;
  status: number | null;
  resourceType: string;
  failure?: string;
  /** Request to the page's own origin (first party) vs a third party. */
  firstParty: boolean;
}

export interface AxeNode {
  target: string;
  html: string;
  summary: string;
  rect?: Rect;
  data?: Record<string, unknown>;
}

export interface AxeIssue {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  description: string;
  tags: string[];
  nodes: AxeNode[];
}

export interface ProbeResult {
  inventory: PageInventory;
  tech?: string[];
  scriptHosts?: string[];
  styles?: {
    body: { color: string; background: { r: number; g: number; b: number; a: number }; font: string };
    headings: { selector: string; color: string; font: string }[];
    ctas: { selector: string; text: string; background: string; color: string; rect: Rect }[];
  };
  hreflang?: string[];
  undersized: {
    selector: string;
    rect: Rect;
    width: number;
    height: number;
    name: string;
    near: string;
    uaControl: boolean;
  }[];
  overflow: {
    docWidth: number;
    viewportWidth: number;
    offenders: { selector: string; rect: Rect; right: number; width: number; tag: string }[];
  };
  smallText: {
    checked: number;
    samples: { selector: string; rect: Rect; fontSize: number; sample: string }[];
  };
  clickable: { selector: string; rect: Rect; name: string; tag: string }[];
  pasteBlocked?: { selector: string; rect: Rect; type: string }[];
  scroll: { height: number; width: number };
}

export interface PageObservation {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  viewport: Viewport;
  loadMs: number;
  screenshot?: string;
  foldScreenshot?: string;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  vitals: RawVitals | null;
  probe: ProbeResult | null;
  axe: { violations: AxeIssue[]; incomplete: AxeIssue[]; version: string } | null;
  keyboard: KeyboardWalk | null;
  widgets?: WidgetCheck | null;
  /** Steps that could not run, with the reason; becomes run limitations. */
  errors: string[];
}

export interface CaptureOptions {
  runDir: string;
  timeoutMs?: number;
  mask?: string[];
  keyboard?: boolean;
  axe?: boolean;
  screenshots?: boolean;
  locale?: string;
  storageState?: string;
  /** Simulated mobile network + CPU (Chromium only). */
  throttle?: boolean;
}

export async function newContext(
  browser: Browser,
  vp: Viewport,
  opts: CaptureOptions,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.deviceScaleFactor,
    // isMobile is not supported in Firefox; Playwright throws if it is set there.
    ...(browser.browserType().name() === 'firefox' ? {} : { isMobile: vp.isMobile }),
    hasTouch: vp.hasTouch,
    locale: opts.locale ?? 'en-US',
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  await ctx.addInitScript({ content: NAME_SHIM });
  await ctx.addInitScript({ content: VITALS_INIT_SCRIPT });
  return ctx;
}

/** Attaches console/network listeners; returns live arrays filled while the page runs. */
export function observe(page: Page, origin: string): { console: ConsoleEntry[]; network: NetworkFailure[] } {
  const consoleEntries: ConsoleEntry[] = [];
  const network: NetworkFailure[] = [];
  page.on('console', (msg) => {
    const t = msg.type();
    if (t !== 'error' && t !== 'warning') return;
    if (consoleEntries.length >= 100) return;
    // Chromium logs every failed resource to the console; those are reported once, as network evidence.
    if (/^Failed to load resource/i.test(msg.text())) return;
    const loc = msg.location();
    const entry: ConsoleEntry = { type: t, text: excerpt(msg.text(), 400) };
    if (loc.url) entry.location = `${redactUrl(loc.url)}:${loc.lineNumber}`;
    consoleEntries.push(entry);
  });
  page.on('pageerror', (err) => {
    if (consoleEntries.length >= 100) return;
    consoleEntries.push({ type: 'pageerror', text: excerpt(`${err.name}: ${err.message}`, 400) });
  });
  const firstParty = (u: string) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText ?? 'failed';
    // Aborted requests are usually navigations away or cancelled prefetches, not defects.
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return;
    if (network.length >= 100) return;
    network.push({
      url: redactUrl(req.url()),
      status: null,
      resourceType: req.resourceType(),
      failure,
      firstParty: firstParty(req.url()),
    });
  });
  page.on('response', (res) => {
    if (res.status() < 400 || network.length >= 100) return;
    // The page's own document status is reported by the http-error rule, not as a failed subresource.
    if (res.request().isNavigationRequest() && res.request().frame() === page.mainFrame()) return;
    network.push({
      url: redactUrl(res.url()),
      status: res.status(),
      resourceType: res.request().resourceType(),
      firstParty: firstParty(res.url()),
    });
  });
  return { console: consoleEntries, network };
}

async function settle(page: Page, timeoutMs: number): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) }).catch(() => undefined);
  // Fonts and late layout: give the page a short, fixed moment so repeat runs see the same state.
  await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
  await page.waitForTimeout(300);
}

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

async function runAxe(page: Page): Promise<PageObservation['axe']> {
  await page.addScriptTag({ content: axe.source });
  const raw = (await page.evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations', 'incomplete'], elementRef: false, rules: { 'target-size': { enabled: true } } })`,
  )) as {
    violations: RawAxe[];
    incomplete: RawAxe[];
    testEngine: { version: string };
  };
  const map = (r: RawAxe): AxeIssue => ({
    id: r.id,
    impact: r.impact ?? null,
    help: r.help,
    helpUrl: r.helpUrl,
    description: r.description,
    tags: r.tags,
    nodes: r.nodes.slice(0, 25).map((n) => {
      const data = n.any?.[0]?.data ?? n.all?.[0]?.data ?? n.none?.[0]?.data;
      return {
        target: n.target.map((t) => (Array.isArray(t) ? t.join(' >>> ') : t)).join(' >>> '),
        html: excerpt(n.html, 300),
        summary: redactText(n.failureSummary ?? ''),
        ...(data && typeof data === 'object' ? { data: data as Record<string, unknown> } : {}),
      };
    }),
  });
  const result = {
    violations: raw.violations.map(map),
    incomplete: raw.incomplete.map(map),
    version: raw.testEngine.version,
  };
  // Element boxes so the report can draw each node on the screenshot.
  const targets = [...result.violations, ...result.incomplete].flatMap((i) => i.nodes.map((n) => n.target));
  const rects = (await page.evaluate(
    `(${String((sels: string[]) =>
      sels.map((s) => {
        if (s.includes('>>>')) return null;
        try {
          const el = document.querySelector(s);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            x: Math.round(r.left + scrollX),
            y: Math.round(r.top + scrollY),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        } catch {
          return null;
        }
      }),
    )})(${JSON.stringify(targets)})`,
  )) as (Rect | null)[];
  let k = 0;
  for (const issue of [...result.violations, ...result.incomplete]) {
    for (const n of issue.nodes) {
      const r = rects[k++];
      if (r) n.rect = r;
    }
  }
  return result;
}

interface RawAxe {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  description: string;
  tags: string[];
  nodes: {
    target: (string | string[])[];
    html: string;
    failureSummary?: string;
    any?: { data?: unknown }[];
    all?: { data?: unknown }[];
    none?: { data?: unknown }[];
  }[];
}

async function applyThrottle(page: Page): Promise<boolean> {
  try {
    const cdp = await page.context().newCDPSession(page);
    // Lighthouse's default mobile profile: 150 ms RTT, ~1.6 Mbps down, 750 Kbps up, 4x CPU slowdown.
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    return true;
  } catch {
    return false;
  }
}

export async function capturePage(
  ctx: BrowserContext,
  url: string,
  vp: Viewport,
  opts: CaptureOptions,
): Promise<PageObservation> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const page = await ctx.newPage();
  const origin = new URL(url).origin;
  const live = observe(page, origin);
  const obs: PageObservation = {
    url: redactUrl(url),
    finalUrl: redactUrl(url),
    status: null,
    title: '',
    viewport: vp,
    loadMs: 0,
    console: live.console,
    network: live.network,
    vitals: null,
    probe: null,
    axe: null,
    keyboard: null,
    errors: [],
  };
  try {
    if (opts.throttle && !(await applyThrottle(page)))
      obs.errors.push('Throttling is only available in Chromium.');
    const t0 = Date.now();
    let response: Awaited<ReturnType<Page['goto']>>;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      obs.errors.push(`navigation: ${(err as Error).message.split('\n')[0]}`);
      return obs;
    }
    obs.loadMs = Date.now() - t0;
    obs.status = response?.status() ?? null;
    obs.finalUrl = redactUrl(page.url());
    await settle(page, timeoutMs);
    obs.title = excerpt(await page.title(), 160);

    obs.vitals = (await page.evaluate(READ_VITALS_SCRIPT).catch((e: Error) => {
      obs.errors.push(`vitals: ${e.message.split('\n')[0]}`);
      return null;
    })) as RawVitals | null;

    obs.probe = (await page
      .evaluate(
        `(${PROBE_SOURCE.trim().replace(/;$/, '')})(${JSON.stringify({ maxItems: 40, viewportWidth: vp.width, viewportHeight: vp.height })})`,
      )
      .catch((e: Error) => {
        obs.errors.push(`probe: ${e.message.split('\n')[0]}`);
        return null;
      })) as ProbeResult | null;
    if (obs.probe) sanitizeInventory(obs.probe.inventory);

    if (opts.axe !== false) {
      obs.axe = await runAxe(page).catch((e: Error) => {
        obs.errors.push(`axe: ${e.message.split('\n')[0]}`);
        return null;
      });
    }

    if (opts.screenshots !== false) {
      const base = `${slug(new URL(url).pathname.replace(/^\/$/, 'home'), 40)}-${shortHash(url).slice(0, 6)}-${vp.name}`;
      const mask = [...DEFAULT_MASK, ...(opts.mask ?? [])].map((s) => page.locator(s));
      const full = join('screenshots', `${base}.jpg`);
      const fold = join('screenshots', `${base}-fold.jpg`);
      try {
        const height = Math.min(obs.probe?.scroll.height ?? vp.height, 12_000);
        await page.screenshot({
          path: join(opts.runDir, full),
          type: 'jpeg',
          quality: 80,
          fullPage: true,
          clip: { x: 0, y: 0, width: vp.width, height },
          animations: 'disabled',
          caret: 'hide',
          mask,
          maskColor: '#FF00FF',
        });
        obs.screenshot = toPosix(full);
        await page.screenshot({
          path: join(opts.runDir, fold),
          type: 'jpeg',
          quality: 80,
          animations: 'disabled',
          caret: 'hide',
          mask,
          maskColor: '#FF00FF',
        });
        obs.foldScreenshot = toPosix(fold);
      } catch (e) {
        obs.errors.push(`screenshot: ${(e as Error).message.split('\n')[0]}`);
      }
    }

    if (opts.keyboard !== false) {
      obs.keyboard = await keyboardWalk(page).catch((e: Error) => {
        obs.errors.push(`keyboard: ${e.message.split('\n')[0]}`);
        return null;
      });
      // Widgets change page state (open/close), so they run last.
      obs.widgets = await checkWidgets(page).catch((e: Error) => {
        obs.errors.push(`widgets: ${e.message.split('\n')[0]}`);
        return null;
      });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return obs;
}

/** Page text is untrusted input: redact and bound it before it is stored or shown to an agent. */
function sanitizeInventory(inv: PageInventory): void {
  inv.h1 = inv.h1.map((t) => excerpt(t, 160));
  inv.headings = inv.headings.map((h) => ({ level: h.level, text: excerpt(h.text, 160) }));
  inv.ctas = inv.ctas.map((c) => ({
    ...c,
    text: excerpt(c.text, 80),
    href: c.href ? redactUrl(c.href) : null,
  }));
  inv.links = inv.links.map((l) => ({ ...l, href: redactUrl(l.href), text: excerpt(l.text, 80) }));
  inv.metaDescription = inv.metaDescription ? excerpt(inv.metaDescription, 300) : null;
  for (const f of inv.forms) {
    f.submitText = f.submitText ? excerpt(f.submitText, 80) : null;
    f.action = f.action ? redactUrl(f.action) : null;
    f.fields = f.fields.map((x) => ({ ...x, label: x.label ? excerpt(x.label, 120) : null }));
  }
}
