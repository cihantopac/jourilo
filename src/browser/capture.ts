// Page capture: one real visit to one URL in one viewport, producing raw, redacted observations that the audit
// rules turn into findings. Nothing here judges; it only records what the browser saw and measured.
import { join } from 'node:path';
import axe from 'axe-core';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { EVIDENCE_QUALITY, type EvidenceMode, FULL_PAGE_MAX_HEIGHT } from '../audit/evidence.js';
import { toPosix } from '../core/fs-safety.js';
import { shortHash, slug } from '../core/hash.js';
import { lexiconSources } from '../core/lexicon.js';
import { GUARD_UPSTREAM_ERROR_HEADER } from '../core/net-guard.js';
import { excerpt, redactText, redactUrl } from '../core/redact.js';
import type { PageInventory, Rect, Viewport } from '../core/types.js';
import { type BlockedRequest, installRequestGuard } from '../journeys/request-guard.js';
import {
  CONTRAST_SAMPLE_CAP,
  type ContrastSample,
  SAMPLED_REASONS,
  sampleContrast,
} from './contrast-sample.js';
import PROBE_SOURCE from './inpage/probe.js?raw';
import { type KeyboardWalk, keyboardWalk } from './keyboard.js';
import { watchContext } from './session.js';
import { sendTargetHeaders, type TargetHeaders } from './target-headers.js';
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
  /** Contrast measured from the rendered pixels, for incomplete color-contrast nodes over images (F8). */
  contrast?: ContrastSample;
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
  unsizedImages?: {
    selector: string;
    rect: Rect;
    src: string;
    naturalWidth: number;
    naturalHeight: number;
  }[];
  structure?: {
    fieldsets: { selector: string; rect: Rect; issue: string }[];
    radioGroups: { name: string; selector: string; rect: Rect; count: number }[];
    tables: { selector: string; rect: Rect; rows: number; cols: number }[];
    altTitle: { selector: string; rect: Rect; title: string }[];
  };
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
  /** Min/max per vital when vitals are medians of several runs. */
  vitalsSpread?: Record<string, [number, number]>;
  vitalsRuns?: number;
  probe: ProbeResult | null;
  axe: { violations: AxeIssue[]; incomplete: AxeIssue[]; version: string } | null;
  keyboard: KeyboardWalk | null;
  widgets?: WidgetCheck | null;
  /** Requests the read-only guard aborted while keys were pressed and widgets operated. */
  blockedActions?: BlockedRequest[];
  /** How the page was captured: whether the network went idle, and the `--wait-for` element if one was given. */
  load?: { networkIdle: boolean; waitedFor?: string; found?: boolean };
  /** Main-frame redirect hops of the navigation to the page, whether it loaded or failed (at most 10; internal). */
  redirects?: { status: number; from: string; to: string }[];
  /** Steps that could not run, with the reason; becomes run limitations. */
  errors: string[];
}

export interface CaptureOptions {
  runDir: string;
  /** Origin of the run's first page; pages on another origin get an origin tag in their screenshot names. */
  primaryOrigin?: string;
  /** Token of the network guard in front of the browser; only its own upstream-error signal is trusted. */
  guardToken?: string;
  timeoutMs?: number;
  mask?: string[];
  keyboard?: boolean;
  axe?: boolean;
  screenshots?: boolean;
  locale?: string;
  storageState?: string;
  /** IANA time zone for the page (e.g. Europe/Istanbul). */
  timezoneId?: string;
  /** ISO 8601 date-time the page's Date is frozen at; timers keep running. */
  clock?: string;
  /** Simulated mobile network + CPU (Chromium only). */
  throttle?: boolean;
  /** `minimal`: JPEG quality 55 and full-page height capped at 6000 px (default `full`). */
  evidence?: EvidenceMode;
  /** `--user-agent`: the User-Agent header and navigator.userAgent. */
  userAgent?: string;
  /** `--extra-header`: headers sent only with requests to the target's origin (see target-headers.ts). */
  extraHeaders?: TargetHeaders;
  /** `--ignore-https-errors`: the browser accepts invalid certificates; the network guard still checks destinations. */
  ignoreHttpsErrors?: boolean;
  /** `--wait-for`: capture only once this selector's first match is visible (or `timeoutMs` has passed). */
  waitFor?: string;
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
    // Certificate checking only: the network guard sees every CONNECT and still checks its destination.
    ignoreHTTPSErrors: opts.ignoreHttpsErrors === true,
    serviceWorkers: 'block',
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  watchContext(browser, ctx);
  // First route of the context, so later ones (the request guard) run before it. None without extra headers.
  if (opts.extraHeaders && Object.keys(opts.extraHeaders.headers).length)
    await sendTargetHeaders(ctx, opts.extraHeaders, opts.timeoutMs ?? 30_000);
  // Freezes Date only; timers and animations keep running.
  if (opts.clock) await ctx.clock.setFixedTime(new Date(opts.clock));
  await ctx.addInitScript({ content: NAME_SHIM });
  await ctx.addInitScript({ content: VITALS_INIT_SCRIPT });
  return ctx;
}

/** Attaches console/network listeners; returns live arrays filled while the page runs. */
export function observe(
  page: Page,
  origin: string,
): { console: ConsoleEntry[]; network: NetworkFailure[]; ignore(fn: (url: string) => boolean): void } {
  const consoleEntries: ConsoleEntry[] = [];
  const network: NetworkFailure[] = [];
  // Requests Jourilo itself aborted (safety guard) are not failures of the site.
  let ignored: (url: string) => boolean = () => false;
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
    if (ignored(req.url())) return;
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
  return {
    console: consoleEntries,
    network,
    ignore: (fn) => {
      ignored = fn;
    },
  };
}

/** Returns whether the network went idle within the settle window. */
async function settle(page: Page, timeoutMs: number): Promise<boolean> {
  const networkIdle = await page
    .waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5000) })
    .then(() => true)
    .catch(() => false);
  // Fonts and late layout: give the page a short, fixed moment so repeat runs see the same state.
  await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
  await page.waitForTimeout(300);
  return networkIdle;
}

/** `--wait-for`: true when the selector's first match became visible within `timeoutMs`. */
export async function waitForElement(page: Page, selector: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

const HIDDEN_SKIP_RULES = new Set(['color-contrast', 'color-contrast-enhanced']);

async function runAxe(page: Page): Promise<PageObservation['axe']> {
  await page.addScriptTag({ content: axe.source });
  const raw = (await page.evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations', 'incomplete'], elementRef: false, rules: { 'target-size': { enabled: true } } })`,
  )) as {
    violations: RawAxe[];
    incomplete: RawAxe[];
    testEngine: { version: string };
  };
  // Manual-review contrast listings skip content assistive technology never presents (F25). Decide in the page,
  // where the elements still exist; a target that cannot be resolved (closed shadow root, cross-origin frame) stays.
  const hiddenFlags = (await page
    .evaluate(
      `(${String((groups: (string | string[])[][]) =>
        groups.map((target) => {
          try {
            let root: Document | ShadowRoot = document;
            let el: Element | null = null;
            const chain: Element[] = [];
            for (let i = 0; i < target.length; i++) {
              const part = target[i] as string | string[];
              const hops = Array.isArray(part) ? part : [part];
              for (let h = 0; h < hops.length; h++) {
                el = root.querySelector(hops[h] as string);
                if (!el) return false;
                chain.push(el);
                if (h < hops.length - 1) {
                  if (!el.shadowRoot) return false;
                  root = el.shadowRoot;
                }
              }
              if (i < target.length - 1) {
                const doc: Document | null | undefined = (el as HTMLIFrameElement | null)?.contentDocument;
                if (!doc) return false;
                root = doc;
              }
            }
            return chain.some((c) => c.closest('[aria-hidden="true"]') !== null);
          } catch {
            return false;
          }
        }),
      )})(${JSON.stringify(
        raw.incomplete.flatMap((r) => (HIDDEN_SKIP_RULES.has(r.id) ? r.nodes.map((n) => n.target) : [])),
      )})`,
    )
    .catch(() => [])) as boolean[];
  {
    let q = 0;
    for (const r of raw.incomplete) {
      if (!HIDDEN_SKIP_RULES.has(r.id)) continue;
      r.nodes = r.nodes.filter(() => !hiddenFlags[q++]);
    }
    raw.incomplete = raw.incomplete.filter((r) => !HIDDEN_SKIP_RULES.has(r.id) || r.nodes.length > 0);
  }
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
  // Contrast axe could not decide because of a background image, gradient or overlapping element: measure it from
  // the rendered pixels (F8). A node that cannot be measured stays a manual-review item.
  let sampled = 0;
  for (const issue of result.incomplete) {
    if (issue.id !== 'color-contrast') continue;
    for (const n of issue.nodes) {
      if (sampled >= CONTRAST_SAMPLE_CAP) break;
      if (!SAMPLED_REASONS.has(String(n.data?.messageKey))) continue;
      sampled++;
      const s = await sampleContrast(page, n.target);
      if (s) n.contrast = s;
    }
  }
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

/**
 * The name part that identifies a location without its origin: the same site served on another host or port keeps its
 * file names. A URL on a different origin than `primaryOrigin` (the run's first page) adds a short origin tag, so two
 * origins that serve the same path in one run never share a file.
 */
export function originFreeName(url: string, primaryOrigin?: string): string {
  const u = new URL(url);
  const tag = primaryOrigin && u.origin !== primaryOrigin ? `\u0000${u.origin}` : '';
  return shortHash(`${u.pathname}${u.search}${tag}`);
}

/** The screenshots a capture of `url` in `vp` writes, relative to the run directory. */
export function captureScreenshotFiles(
  url: string,
  vp: Viewport,
  primaryOrigin?: string,
): { full: string; fold: string } {
  const base = `${slug(new URL(url).pathname.replace(/^\/$/, 'home'), 40)}-${originFreeName(url, primaryOrigin).slice(0, 6)}-${vp.name}`;
  return { full: join('screenshots', `${base}.jpg`), fold: join('screenshots', `${base}-fold.jpg`) };
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
  const redirects: NonNullable<PageObservation['redirects']> = [];
  page.on('response', (res) => {
    const status = res.status();
    if (status < 300 || status >= 400 || redirects.length >= 10) return;
    if (!res.request().isNavigationRequest() || res.request().frame() !== page.mainFrame()) return;
    const location = res.headers().location;
    if (!location) return;
    let to = location;
    try {
      to = new URL(location, res.url()).href;
    } catch {
      // keep the raw header value
    }
    redirects.push({ status, from: redactUrl(res.url()), to: redactUrl(to) });
  });
  try {
    if (opts.throttle && !(await applyThrottle(page)))
      obs.errors.push('Throttling is only available in Chromium.');
    const t0 = Date.now();
    let response: Awaited<ReturnType<Page['goto']>>;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    } catch (err) {
      obs.errors.push(`navigation: ${(err as Error).message.split('\n')[0]}`);
      if (redirects.length) obs.redirects = redirects;
      return obs;
    }
    // The network guard answers 502 itself when DNS or the connection fails: nothing was loaded.
    const signal = response?.headers()[GUARD_UPSTREAM_ERROR_HEADER];
    if (opts.guardToken && signal?.startsWith(`${opts.guardToken} `) && new URL(url).protocol === 'http:') {
      obs.errors.push(`navigation: could not connect: ${signal.slice(opts.guardToken.length + 1)}`);
      return obs;
    }
    // A copy: the listener keeps recording navigations that happen later (keys pressed, widgets operated).
    if (redirects.length) obs.redirects = [...redirects];
    obs.loadMs = Date.now() - t0;
    obs.status = response?.status() ?? null;
    obs.finalUrl = redactUrl(page.url());
    const networkIdle = await settle(page, timeoutMs);
    obs.load = { networkIdle };
    if (opts.waitFor) {
      const found = await waitForElement(page, opts.waitFor, timeoutMs);
      obs.load = { networkIdle, waitedFor: opts.waitFor, found };
      // Late content may bring late layout: let it settle the same way before anything is measured.
      if (found) await settle(page, timeoutMs);
    }
    obs.title = excerpt(await page.title(), 160);

    obs.vitals = (await page.evaluate(READ_VITALS_SCRIPT).catch((e: Error) => {
      obs.errors.push(`vitals: ${e.message.split('\n')[0]}`);
      return null;
    })) as RawVitals | null;

    obs.probe = (await page
      .evaluate(
        `(${PROBE_SOURCE.trim().replace(/;$/, '')})(${JSON.stringify({ maxItems: 40, viewportWidth: vp.width, viewportHeight: vp.height, lex: lexiconSources() })})`,
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
      const mask = [...DEFAULT_MASK, ...(opts.mask ?? [])].map((s) => page.locator(s));
      const mode = opts.evidence ?? 'full';
      const { full, fold } = captureScreenshotFiles(url, vp, opts.primaryOrigin);
      try {
        const height = Math.min(obs.probe?.scroll.height ?? vp.height, FULL_PAGE_MAX_HEIGHT[mode]);
        if (mode === 'minimal' && height <= vp.height) {
          // The document fits in the first screen: one file serves as fold and full page (same pixels, same coordinates).
          await page.screenshot({
            path: join(opts.runDir, full),
            type: 'jpeg',
            quality: EVIDENCE_QUALITY[mode],
            animations: 'disabled',
            caret: 'hide',
            mask,
            maskColor: '#FF00FF',
          });
          obs.screenshot = toPosix(full);
          obs.foldScreenshot = obs.screenshot;
        } else {
          await page.screenshot({
            path: join(opts.runDir, full),
            type: 'jpeg',
            quality: EVIDENCE_QUALITY[mode],
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
            quality: EVIDENCE_QUALITY[mode],
            animations: 'disabled',
            caret: 'hide',
            mask,
            maskColor: '#FF00FF',
          });
          obs.foldScreenshot = toPosix(fold);
        }
      } catch (e) {
        obs.errors.push(`screenshot: ${(e as Error).message.split('\n')[0]}`);
      }
    }

    if (opts.keyboard !== false) {
      // Keys and widget operation must not change data or leave the site: from here on the page is read-only.
      const guard = await installRequestGuard(page, {
        origin,
        hostClass: 'public',
        allowSubmit: false,
        allowDestructive: false,
        mode: 'read-only',
      });
      live.ignore(guard.isBlocked);
      obs.blockedActions = guard.blocked;
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

/**
 * Extra cold-cache visits that only read lab vitals, for medians over several runs. Each visit uses a fresh
 * context so caches and service workers do not carry over.
 */
export async function measureVitals(
  browser: Browser,
  url: string,
  vp: Viewport,
  opts: CaptureOptions,
): Promise<RawVitals | null> {
  const ctx = await newContext(browser, vp, opts);
  const page = await ctx.newPage();
  try {
    if (opts.throttle) await applyThrottle(page);
    await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs ?? 30_000 });
    await settle(page, opts.timeoutMs ?? 30_000);
    if (opts.waitFor) await waitForElement(page, opts.waitFor, opts.timeoutMs ?? 30_000);
    return (await page.evaluate(READ_VITALS_SCRIPT)) as RawVitals;
  } catch {
    return null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/** Median of each numeric vital across runs; the spread is kept for reports. */
export function medianVitals(samples: RawVitals[]): {
  vitals: RawVitals;
  spread: Record<string, [number, number]>;
} {
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };
  const base = { ...samples[0]! };
  const spread: Record<string, [number, number]> = {};
  for (const key of [
    'lcp',
    'cls',
    'fcp',
    'ttfb',
    'tbt',
    'load',
    'transferBytes',
    'domContentLoaded',
  ] as const) {
    const xs = samples.map((v) => v[key]).filter((x): x is number => typeof x === 'number');
    if (!xs.length) continue;
    (base as Record<string, unknown>)[key] = med(xs);
    spread[key] = [Math.min(...xs), Math.max(...xs)];
  }
  return { vitals: base, spread };
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
