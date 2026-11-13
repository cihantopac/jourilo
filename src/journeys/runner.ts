// Executes journeys in a real browser with evidence for every step: screenshot, URL, timing, console and network
// failures, optional Playwright trace. Deterministic: fixed viewport, generated test data, no randomness in
// selectors, one controlled retry for transient element states.
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Browser, ElementHandle, Locator, Page } from 'playwright-core';
import { EVIDENCE_QUALITY, type EvidenceMode } from '../audit/evidence.js';
import { makeFinding } from '../audit/finding.js';
import { CWV, nielsen } from '../audit/standards.js';
import { DEFAULT_MASK, newContext, observe } from '../browser/capture.js';
import type { TargetHeaders } from '../browser/target-headers.js';
import { parseViewports } from '../browser/viewports.js';
import { type RawVitals, READ_VITALS_SCRIPT, rate } from '../browser/vitals.js';
import { toPosix, writeFileSafe } from '../core/fs-safety.js';
import { excerpt, redactUrl } from '../core/redact.js';
import type { Finding, JourneyResult, JourneyStepResult } from '../core/types.js';
import { type HostClass, isLocalHostname } from '../core/url-safety.js';
import { coverAt } from './cover.js';
import { type BlockedRequest, installRequestGuard } from './request-guard.js';
import { checkAction, interpolate, isSecretValue, type SafetyPolicy } from './safety.js';
import { describeStep, describeTarget, type JourneySpec, type Step, type Target } from './schema.js';

export interface JourneyRunOptions {
  base: URL;
  runDir: string;
  hostClass: HostClass;
  policy: SafetyPolicy;
  data: Record<string, string>;
  trace: boolean;
  storageState?: string;
  timezoneId?: string;
  clock?: string;
  /** `--user-agent`, `--extra-header` (target origin only) and `--ignore-https-errors` (F16). */
  userAgent?: string;
  extraHeaders?: TargetHeaders;
  ignoreHttpsErrors?: boolean;
  stepTimeoutMs: number;
  viewportOverride?: string;
  /** Save the browser's storage state (cookies, localStorage) after the journey, for signed-in audits. */
  saveAuth?: string;
  /** Other origins main-frame navigations may reach (e.g. a test identity provider). */
  allowOrigins?: string[];
  /** `minimal`: JPEG quality 55. The caller prunes step screenshots (`pruneJourneyScreenshots`) once it has picked the attempt it reports. */
  evidence?: EvidenceMode;
  /** 1-based attempt number under `--repeat`; step files carry it so attempts never overwrite each other. */
  attempt?: number;
  log?: (msg: string) => void;
}

export function locatorFor(page: Page, t: Target): Locator {
  if ('role' in t)
    return page.getByRole(t.role as Parameters<Page['getByRole']>[0], {
      ...(t.name ? { name: t.name } : {}),
      ...(t.exact ? { exact: true } : {}),
    });
  if ('label' in t) return page.getByLabel(t.label, { exact: t.exact ?? false });
  if ('text' in t) return page.getByText(t.text, { exact: t.exact ?? false });
  if ('placeholder' in t) return page.getByPlaceholder(t.placeholder);
  if ('testId' in t) return page.getByTestId(t.testId);
  return page.locator(t.css);
}

/**
 * Facts about the element about to be activated, for the safety policy. The element that receives the activation is
 * the nearest interactive ancestor (clicking the icon inside a button activates the button). Besides its name, the
 * policy sees its link target, form action/formaction and identifiers, so icon-only and mislabelled controls are
 * judged by what they do.
 */
const ELEMENT_FACTS = `(el) => {
  if (!el || el === document.body || el === document.documentElement) return null;
  const act = el.closest('a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch]') || el;
  const form = act.form || act.closest('form');
  const tag = act.tagName;
  const type = (act.getAttribute('type') || '').toLowerCase();
  const role = (act.getAttribute('role') || '').toLowerCase();
  const submits = !!form && ((tag === 'BUTTON' && (type === '' || type === 'submit')) || (tag === 'INPUT' && (type === 'submit' || type === 'image')));
  const inField = !!form && ((tag === 'INPUT' && !['button','submit','reset','checkbox','radio','image','file','range','color'].includes(type)) || tag === 'SELECT');
  const textarea = tag === 'TEXTAREA' || act.isContentEditable;
  const buttonLike = tag === 'BUTTON' || tag === 'SUMMARY' || (tag === 'INPUT' && ['button','submit','reset','image'].includes(type)) || ['button','menuitem','tab','option','switch','checkbox'].includes(role);
  const linkLike = (tag === 'A' && act.hasAttribute('href')) || role === 'link';
  const payment = !!form && !!form.querySelector('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i], input[name*="cvv" i], input[data-stripe], iframe[src*="stripe"], iframe[name*="card" i], iframe[title*="card" i]');
  const byIds = (attr) => (act.getAttribute(attr) || '').split(/\\s+/).map((id) => id && document.getElementById(id)).filter(Boolean).map((n) => n.innerText || n.textContent || '').join(' ');
  const inner = Array.from(act.querySelectorAll('img[alt], [aria-label], svg title')).map((n) => n.getAttribute('alt') || n.getAttribute('aria-label') || n.textContent || '').join(' ');
  const name = (act.getAttribute('aria-label') || byIds('aria-labelledby') || act.innerText || act.value || act.getAttribute('title') || act.getAttribute('alt') || inner || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  const attrs = [];
  for (const n of [act, ...Array.from(act.querySelectorAll('*')).slice(0, 20)])
    for (const a of Array.from(n.attributes))
      if (/^(id|class|name|title|data-[\\w-]+)$/.test(a.name) || ((a.name === 'href' || a.name === 'xlink:href') && n.tagName.toLowerCase() === 'use'))
        attrs.push(a.value);
  const targets = [];
  if (linkLike && act.getAttribute('href')) targets.push(act.href || act.getAttribute('href'));
  if (act.getAttribute('formaction')) targets.push(act.formAction || act.getAttribute('formaction'));
  if (form && (submits || inField)) targets.push(form.getAttribute('action') || '');
  return { submits, inField, textarea, buttonLike, linkLike, payment, name, signals: attrs.join(' ').slice(0, 1500), targets: targets.join(' ') };
}`;

interface ElementFacts {
  submits: boolean;
  inField: boolean;
  textarea: boolean;
  buttonLike: boolean;
  linkLike: boolean;
  payment: boolean;
  name: string;
  signals: string;
  targets: string;
}

/** What a key press does to the focused element: nothing risky, an activation (like a click), or a submission. */
export function keyEffect(key: string, f: ElementFacts | null): 'none' | 'activate' | 'submit' {
  if (!f) return 'none';
  const k = key.split('+').pop()!;
  const mods = key.includes('+');
  const enter = k === 'Enter' || k === 'NumpadEnter';
  const space = k === ' ' || k === 'Space';
  if (enter) {
    if (f.textarea) return mods ? 'submit' : 'none';
    if (f.inField) return 'submit';
    if (f.buttonLike || f.linkLike) return f.submits ? 'submit' : 'activate';
    return 'activate';
  }
  if (space && f.buttonLike) return f.submits ? 'submit' : 'activate';
  return 'none';
}

/** Applies the safety policy to activating an element (click, or a key that activates or submits). */
function verdictFor(
  f: ElementFacts,
  effect: 'activate' | 'submit',
  action: 'click' | 'press',
  policy: SafetyPolicy,
) {
  const submitsForm = effect === 'submit' || f.submits;
  return checkAction(
    {
      action,
      name: f.name,
      signals: f.signals,
      targets: f.targets,
      submitsForm,
      paymentForm: f.payment && submitsForm,
    },
    policy,
  );
}

const facts = (src: string) => new Function(`return (${src})(arguments[0])`) as (el: unknown) => unknown;

/**
 * "/path" compares the path exactly (trailing slash ignored), "re:<regex>" tests the full URL, anything else is
 * a substring of the full URL.
 */
export function matchesUrl(actual: string, expected: string): boolean {
  if (expected.startsWith('re:')) {
    try {
      return new RegExp(expected.slice(3)).test(actual);
    } catch {
      return false;
    }
  }
  if (expected.startsWith('/')) {
    try {
      const norm = (p: string) => p.replace(/\/+$/, '').replace(/\.html?$/, '') || '/';
      const u = new URL(actual);
      const [path, query] = expected.split('?');
      return norm(u.pathname) === norm(path!) && (!query || u.search.includes(query));
    } catch {
      return false;
    }
  }
  return actual.includes(expected);
}

/**
 * The policy for activating elements in a tab. A tab on another origin the journey may reach (`allowOrigins`) is
 * judged by its own host: a popup on a non-local test identity provider gets the non-local rules (no submission
 * without --allow-submit, never a payment or deletion) even when the journey's target is a local host.
 */
export function tabPolicy(url: string, base: URL, policy: SafetyPolicy): SafetyPolicy {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return policy;
  }
  if (
    (u.protocol !== 'http:' && u.protocol !== 'https:') ||
    u.origin === base.origin ||
    isLocalHostname(u.hostname)
  )
    return policy;
  return { ...policy, hostClass: 'public' };
}

/** The journey's open tabs, in the order they were opened, and the current one the steps act on. */
interface Tabs {
  current(): Page | undefined;
  all(): Page[];
  /** Tabs and popups the pages opened that no `waitForPopup` or `switchTab` has taken yet, oldest first. */
  fresh(): Page[];
  select(page: Page): Promise<void>;
}

/** Polls for a tab until the step timeout: a popup's page and its first URL arrive a moment after the click. */
async function waitForTab(find: () => Page | undefined, timeoutMs: number): Promise<Page | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const p = find();
    if (p || Date.now() >= deadline) return p;
    await sleep(100);
  }
}

class Blocked extends Error {}

/** Runs one step. A returned note is appended to the step's description (what was done differently, and why). */
async function act(tabs: Tabs, step: Step, opts: JourneyRunOptions): Promise<string | void> {
  const t = opts.stepTimeoutMs;
  const value = (v: string) => interpolate(v, opts.data);
  const page = tabs.current();
  if (!page) throw new Error('No open tab: every tab of the journey has been closed.');
  switch (step.action) {
    case 'goto': {
      const url = new URL(value(step.url), opts.base);
      if (url.origin !== opts.base.origin && !(opts.allowOrigins ?? []).includes(url.origin))
        throw new Blocked(`goto ${url.origin} leaves the target origin ${opts.base.origin}`);
      await page.goto(url.toString(), { waitUntil: 'load', timeout: t * 3 });
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      return;
    }
    case 'click':
    case 'press': {
      // One element handle for the check and the action, so a re-render cannot swap the element in between.
      const loc = step.target ? locatorFor(page, step.target).first() : null;
      let handle: ElementHandle | null = null;
      if (loc) {
        await loc.waitFor({ state: 'visible', timeout: t });
        handle = await loc.elementHandle({ timeout: t });
      } else {
        // A key press without a target goes to whatever has focus: judge that element.
        handle = (await page.evaluateHandle('document.activeElement')).asElement();
      }
      const f = handle ? ((await handle.evaluate(facts(ELEMENT_FACTS))) as ElementFacts | null) : null;
      const effect = step.action === 'click' ? (f?.submits ? 'submit' : 'activate') : keyEffect(step.key, f);
      if (f && effect !== 'none') {
        const verdict = verdictFor(f, effect, step.action, tabPolicy(page.url(), opts.base, opts.policy));
        if (!verdict.allowed) throw new Blocked(verdict.reason);
      }
      let note: string | undefined;
      try {
        if (step.action === 'click') {
          // A covered center would make Playwright wait for the cover to go away until the step times out: say
          // what is on top, and click a clear part of the target when there is one.
          const c = await coverAt(handle!);
          if (c.covered && c.visiblePoint) {
            note = `center covered by ${c.cover ?? 'another element'}; clicked the visible part`;
            await handle!.click({ timeout: t, position: c.visiblePoint });
          } else if (c.covered) {
            throw new Error(
              `${describeTarget(step.target)} is covered by ${c.cover ?? 'another element'}; nothing of it is visible to click.`,
            );
          } else await handle!.click({ timeout: t });
        } else if (loc && handle) await handle.press(step.key, { timeout: t });
        else await page.keyboard.press(step.key);
      } catch (err) {
        // A popup that closes itself on the click (an identity provider handing back to its opener) did its job.
        if (!page.isClosed()) throw err;
      }
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      return note;
    }
    case 'fill':
      await locatorFor(page, step.target).first().fill(value(step.value), { timeout: t });
      return;
    case 'select':
      await locatorFor(page, step.target).first().selectOption(value(step.value), { timeout: t });
      return;
    case 'check':
      await locatorFor(page, step.target).first().check({ timeout: t });
      return;
    case 'hover':
      await locatorFor(page, step.target).first().hover({ timeout: t });
      return;
    case 'wait':
      if (step.target)
        await locatorFor(page, step.target)
          .first()
          .waitFor({ state: 'visible', timeout: step.ms ?? t });
      else await page.waitForTimeout(Math.min(step.ms ?? 500, 10_000));
      return;
    case 'back':
      await page.goBack({ timeout: t });
      return;
    case 'expect': {
      if (step.url) {
        const deadline = Date.now() + t;
        while (!matchesUrl(page.url(), step.url) && Date.now() < deadline) await page.waitForTimeout(100);
        if (!matchesUrl(page.url(), step.url))
          throw new Error(`URL is ${redactUrl(page.url())}, expected ~ ${step.url}`);
      }
      if (step.visible)
        await locatorFor(page, step.visible).first().waitFor({ state: 'visible', timeout: t });
      if (step.hidden) await locatorFor(page, step.hidden).first().waitFor({ state: 'hidden', timeout: t });
      if (step.title) {
        const title = await page.title();
        if (!title.includes(step.title))
          throw new Error(`Title is "${excerpt(title, 80)}", expected ~ "${step.title}"`);
      }
      return;
    }
    case 'screenshot':
      return;
    case 'waitForPopup': {
      const popup = await waitForTab(
        () => tabs.fresh().find((p) => !step.urlMatch || matchesUrl(p.url(), step.urlMatch)),
        t,
      );
      if (!popup)
        throw new Error(
          `No popup or new tab${step.urlMatch ? ` at ~ ${step.urlMatch}` : ''} opened within ${Math.round(t / 1000)} s.`,
        );
      await tabs.select(popup);
      await popup.waitForLoadState('load', { timeout: t }).catch(() => undefined);
      await popup.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      return;
    }
    case 'switchTab': {
      const find = () =>
        step.index !== undefined
          ? tabs.all()[step.index]
          : tabs.all().find((p) => matchesUrl(p.url(), step.urlMatch ?? ''));
      const tab = await waitForTab(find, t);
      if (!tab)
        throw new Error(
          `${step.index !== undefined ? `There is no tab ${step.index}` : `No tab at ~ ${step.urlMatch}`}; open tabs: ${tabs
            .all()
            .map((p, i) => `${i} ${redactUrl(p.url())}`)
            .join(', ')}.`,
        );
      await tabs.select(tab);
      return;
    }
    case 'closeTab':
      if (tabs.all().length < 2) throw new Error("closeTab would close the journey's last tab.");
      await page.close();
      return;
  }
}

/**
 * Hands out what the request guard stopped, one step at a time. Each `take()` returns the stops since the previous
 * one, so a stop between two steps (during a screenshot, or a popup the page opens a moment later) is charged to the
 * next step, and one after the last step's check to the last step, instead of going unreported. Only navigations and
 * destructive or financial requests count: a stopped background form post is reported with the journey, not a step.
 */
export function stopLedger(blocked: readonly BlockedRequest[]): { take(): BlockedRequest[] } {
  let seen = 0;
  return {
    take() {
      const fresh = blocked.slice(seen).filter((b) => b.navigation || b.kind !== 'submit');
      seen = blocked.length;
      return fresh;
    },
  };
}

/** Marks a step blocked by the stops charged to it (a step already blocked keeps its own reason). */
export function chargeStops(
  step: Pick<JourneyStepResult, 'status' | 'error'>,
  stopped: BlockedRequest[],
): boolean {
  if (!stopped.length) return false;
  if (step.status !== 'blocked') {
    step.status = 'blocked';
    step.error = excerpt(
      `${stopped[0]!.reason}${stopped.length > 1 ? ` (+${stopped.length - 1} more)` : ''}`,
      300,
    );
  }
  return true;
}

const TRANSIENT = /detached|not stable|intercepts pointer events|Execution context was destroyed|navigation/i;

export async function runJourney(
  browser: Browser,
  spec: JourneySpec,
  opts: JourneyRunOptions,
): Promise<{ result: JourneyResult; findings: Finding[] }> {
  const vp = parseViewports(opts.viewportOverride ?? spec.viewport ?? 'desktop')[0]!;
  const ctx = await newContext(browser, vp, {
    runDir: opts.runDir,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(opts.extraHeaders ? { extraHeaders: opts.extraHeaders } : {}),
    ...(opts.ignoreHttpsErrors ? { ignoreHttpsErrors: true } : {}),
  });
  const tracePath = opts.trace ? join('traces', `${spec.id}-${vp.name}.zip`) : undefined;
  if (tracePath) await ctx.tracing.start({ screenshots: true, snapshots: true, title: spec.name });
  // Network backstop: whatever a step triggers, requests that the policy forbids never leave the browser.
  // Every hop of a redirect chain is judged before it is sent (Playwright routes only a chain's first URL).
  const guard = await installRequestGuard(
    ctx,
    {
      ...opts.policy,
      origin: opts.base.origin,
      ...(opts.allowOrigins ? { allowOrigins: opts.allowOrigins } : {}),
      mode: 'journey',
    },
    { checkRedirects: true, ...(opts.extraHeaders ? { targetHeaders: opts.extraHeaders } : {}) },
  );
  // Every tab and popup of the context is tracked: the request guard above is context-wide, so the policy holds for
  // all of them, including a popup the page opens on its own (its off-origin navigation is aborted before the
  // request leaves the browser). Only waitForPopup and switchTab make another tab current.
  const open: Page[] = [];
  const fresh: Page[] = [];
  const openers = new Map<Page, Page | null>();
  const observers: ReturnType<typeof observe>[] = [];
  let current: Page | undefined;
  const track = (p: Page) => {
    open.push(p);
    const live = observe(p, opts.base.origin);
    live.ignore(guard.isBlocked);
    observers.push(live);
    // Recorded synchronously when the popup appears, before it can close itself.
    p.on('popup', (child) => openers.set(child, p));
    p.on('close', () => {
      for (const list of [open, fresh]) if (list.includes(p)) list.splice(list.indexOf(p), 1);
      if (current !== p) return;
      // The current tab closed (a popup that closed itself, or closeTab): its opener, or the nearest still-open
      // ancestor, becomes current; failing that, the most recently opened tab.
      let o = openers.get(p) ?? null;
      while (o?.isClosed()) o = openers.get(o) ?? null;
      current = o ?? open[open.length - 1];
    });
  };
  current = await ctx.newPage();
  track(current);
  ctx.on('page', (p) => {
    if (open.includes(p) || p.isClosed()) return;
    track(p);
    fresh.push(p);
  });
  const tabs: Tabs = {
    current: () => current,
    all: () => open.filter((p) => !p.isClosed()),
    fresh: () => fresh.filter((p) => !p.isClosed()),
    select: async (p) => {
      current = p;
      if (fresh.includes(p)) fresh.splice(fresh.indexOf(p), 1);
      await p.bringToFront().catch(() => undefined);
    },
  };
  const steps: JourneyStepResult[] = [];
  const findings: Finding[] = [];
  const t0 = Date.now();
  let status: JourneyResult['status'] = 'passed';
  const startUrl = new URL(interpolate(spec.start, opts.data), opts.base);
  const allSteps: Step[] = [{ action: 'goto', url: startUrl.toString() }, ...spec.steps];
  const shot = async (i: number) => {
    const file = join(
      'screenshots',
      `journey-${spec.id}-${vp.name}${opts.attempt === undefined ? '' : `-a${opts.attempt}`}-${String(i).padStart(2, '0')}.jpg`,
    );
    // From the current tab. A tab that is closing itself as the step ends hands over to its opener: take that.
    for (let attempt = 0; attempt < 2; attempt++) {
      const page = tabs.current();
      if (!page) return undefined;
      try {
        await page.screenshot({
          path: join(opts.runDir, file),
          type: 'jpeg',
          quality: opts.evidence === 'minimal' ? EVIDENCE_QUALITY.minimal : 70,
          animations: 'disabled',
          caret: 'hide',
          mask: DEFAULT_MASK.map((s) => page.locator(s)),
          maskColor: '#FF00FF',
        });
        return toPosix(file);
      } catch {
        if (!page.isClosed()) await sleep(300);
        if (!page.isClosed() || tabs.current() === page) return undefined;
      }
    }
    return undefined;
  };

  const stops = stopLedger(guard.blocked);

  try {
    for (let i = 0; i < allSteps.length; i++) {
      const step = allSteps[i]!;
      const secret =
        'value' in step &&
        (isSecretValue(step.value) || /password|card|cvc/i.test(JSON.stringify(step.target ?? '')));
      const s0 = Date.now();
      const res: JourneyStepResult = {
        index: i,
        action: step.action,
        description: describeStep(step, secret),
        status: 'passed',
        durationMs: 0,
        url: '',
      };
      opts.log?.(`    ${i + 1}. ${res.description}`);
      let note: string | void;
      try {
        try {
          note = await act(tabs, step, opts);
        } catch (err) {
          if (err instanceof Blocked || !TRANSIENT.test((err as Error).message)) throw err;
          await sleep(500);
          note = await act(tabs, step, opts);
        }
        if (note) res.description = `${res.description} (${note})`;
      } catch (err) {
        res.status = err instanceof Blocked ? 'blocked' : 'failed';
        res.error = excerpt((err as Error).message.split('\n')[0], 300);
      }
      // A navigation or an irreversible/payment request the step caused was stopped: the step did not do what it
      // would have done. (Background data requests that were stopped are reported with the journey, not here.)
      chargeStops(res, stops.take());
      res.durationMs = Date.now() - s0;
      res.url = redactUrl(tabs.current()?.url() ?? '');
      const s = await shot(i);
      if (s) res.screenshot = s;
      steps.push(res);
      if (res.status !== 'passed') {
        status = res.status === 'blocked' ? 'blocked' : 'failed';
        for (let k = i + 1; k < allSteps.length; k++)
          steps.push({
            index: k,
            action: allSteps[k]!.action,
            description: describeStep(allSteps[k]!),
            status: 'skipped',
            durationMs: 0,
            url: '',
          });
        break;
      }
    }
    // A navigation stopped after the last step's check (a popup that opened late) still stops the journey.
    if (status === 'passed' && steps.length && chargeStops(steps[steps.length - 1]!, stops.take()))
      status = 'blocked';

    // Success criteria are evaluated even after a failure so the report shows which goals were missed.
    const page = tabs.current();
    const finalUrl = page?.url() ?? '';
    const pageErrors = observers.flatMap((o) => o.console).filter((c) => c.type === 'pageerror');
    const failedFirstParty = observers.flatMap((o) => o.network).filter((n) => n.firstParty);
    const criteria: JourneyResult['successCriteria'] = [];
    for (const c of spec.success) {
      let met = true;
      const details: string[] = [];
      if (c.url && !matchesUrl(finalUrl, c.url)) {
        met = false;
        details.push(`ended at ${redactUrl(finalUrl)}`);
      }
      if (c.urlNot && matchesUrl(finalUrl, c.urlNot)) {
        met = false;
        details.push(`still at ${redactUrl(finalUrl)}`);
      }
      if (c.visible) {
        const vis = page
          ? await locatorFor(page, c.visible)
              .first()
              .isVisible()
              .catch(() => false)
          : false;
        if (!vis) {
          met = false;
          details.push(`${describeTarget(c.visible)} not visible`);
        }
      }
      if (c.noPageErrors && pageErrors.length) {
        met = false;
        details.push(`${pageErrors.length} uncaught exception(s)`);
      }
      if (c.noFailedRequests && failedFirstParty.length) {
        met = false;
        details.push(`${failedFirstParty.length} failed request(s)`);
      }
      criteria.push({
        description: c.description,
        met,
        ...(details.length ? { detail: details.join('; ') } : {}),
      });
    }
    if (status === 'passed' && criteria.some((c) => !c.met)) status = 'failed';

    const vitals = (await page?.evaluate(READ_VITALS_SCRIPT).catch(() => null)) as RawVitals | null;
    const durationMs = Date.now() - t0;
    if (tracePath) {
      await ctx.tracing.stop({ path: join(opts.runDir, tracePath) });
    }
    if (opts.saveAuth && status === 'passed') {
      // Session state is a credential: owner-only permissions, and only after the journey actually succeeded.
      writeFileSafe(opts.saveAuth, JSON.stringify(await ctx.storageState(), null, 2), { private: true });
    }
    const result: JourneyResult = {
      id: spec.id,
      name: spec.name,
      viewport: vp.name,
      status,
      steps,
      successCriteria: criteria,
      durationMs,
      ...(tracePath ? { trace: toPosix(tracePath) } : {}),
      ...(guard.blocked.length
        ? { blockedRequests: guard.blocked.map(({ method, url, reason }) => ({ method, url, reason })) }
        : {}),
    };
    const blockedNote = guard.blocked.length
      ? ` The safety policy stopped ${guard.blocked.length} request(s) during this journey (e.g. ${guard.blocked[0]!.method} ${guard.blocked[0]!.url}), which may be why.`
      : '';

    const reproduction = steps.filter((s) => s.status !== 'skipped').map((s) => s.description);
    const failedStep = steps.find((s) => s.status === 'failed');
    const blockedStep = steps.find((s) => s.status === 'blocked');
    const url = redactUrl(finalUrl);
    if (failedStep || criteria.some((c) => !c.met)) {
      const unmet = criteria.filter((c) => !c.met);
      findings.push(
        makeFinding({
          ruleId: 'journey/failed',
          key: spec.id,
          journey: spec.id,
          title: `Journey "${spec.name}" does not reach its goal`,
          category: 'usability',
          kind: 'defect',
          severity: 'serious',
          confidence: spec.source === 'suggested' ? 'medium' : 'high',
          provenance: 'observed',
          url,
          viewport: vp.name,
          description: `${
            failedStep
              ? `Step ${failedStep.index + 1} (${failedStep.description}) failed: ${failedStep.error}`
              : `All steps ran, but ${unmet.length} success criterion/criteria were not met: ${unmet.map((c) => `${c.description}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}.`
          }${blockedNote}`,
          // A goal missed because Jourilo itself stopped a request is not evidence that the site is broken.
          ...(blockedNote ? { confidence: 'low' as const } : {}),
          impact: spec.goal
            ? `People trying to ${spec.goal} cannot complete it.`
            : 'People cannot complete this task.',
          recommendation:
            spec.source === 'suggested'
              ? 'Check whether the journey definition matches the intended flow (it was generated); if it does, fix the step that failed.'
              : 'Fix the step that failed, then rerun the journey.',
          standards: [nielsen(9)],
          evidence: [
            ...(failedStep?.screenshot
              ? [
                  {
                    type: 'screenshot' as const,
                    file: failedStep.screenshot,
                    note: `After step ${failedStep.index + 1}`,
                  },
                ]
              : []),
            { type: 'step', snippet: failedStep?.error ?? unmet.map((c) => c.detail).join('; ') },
          ],
          reproduction,
        }),
      );
    }
    if (blockedStep) {
      findings.push(
        makeFinding({
          ruleId: 'journey/blocked-by-policy',
          key: spec.id,
          journey: spec.id,
          title: `Journey "${spec.name}" stopped by the safety policy`,
          category: 'usability',
          kind: 'needs-review',
          severity: 'info',
          confidence: 'high',
          provenance: 'observed',
          url,
          viewport: vp.name,
          description: blockedStep.error ?? 'Blocked.',
          impact: 'The rest of this journey was not tested.',
          recommendation:
            'Run it against a local or sandbox environment with test accounts if it needs to be covered.',
          standards: [],
          evidence: [{ type: 'step', snippet: blockedStep.description }],
          reproduction,
        }),
      );
    }
    if (pageErrors.length) {
      findings.push(
        makeFinding({
          ruleId: 'journey/page-errors',
          key: spec.id,
          journey: spec.id,
          title: `Uncaught exceptions during "${spec.name}"`,
          category: 'reliability',
          kind: 'defect',
          severity: 'serious',
          confidence: 'high',
          provenance: 'observed',
          url,
          viewport: vp.name,
          description: `${pageErrors.length} uncaught exception(s) while performing the journey.`,
          impact: 'Interactive features may silently fail for real users.',
          recommendation: 'Reproduce the steps and fix the exceptions listed in the evidence.',
          standards: [],
          evidence: pageErrors.slice(0, 8).map((e) => ({ type: 'console' as const, snippet: e.text })),
          reproduction,
        }),
      );
    }
    if (vitals?.inp != null && vitals.interactions > 0) {
      const r = rate('INP', vitals.inp);
      if (r && r !== 'good') {
        findings.push(
          makeFinding({
            ruleId: 'perf/inp',
            key: spec.id,
            journey: spec.id,
            title: `Slow response to interaction during "${spec.name}" (${Math.round(vitals.inp)} ms, lab)`,
            category: 'performance',
            kind: 'defect',
            severity: r === 'poor' ? 'serious' : 'minor',
            confidence: 'medium',
            provenance: 'measured',
            url,
            viewport: vp.name,
            description: `The slowest of ${vitals.interactions} scripted interaction(s) took ${Math.round(vitals.inp)} ms to paint the next frame. This is a lab approximation of INP, not field data.`,
            impact: 'The interface feels unresponsive; people click again or give up.',
            recommendation:
              'Profile the interaction in DevTools Performance; break up long tasks in the event handlers and defer non-urgent work.',
            standards: [CWV.INP],
            evidence: [
              { type: 'metric', data: { inp: Math.round(vitals.inp), interactions: vitals.interactions } },
            ],
            reproduction,
          }),
        );
      }
    }
    return { result, findings };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
