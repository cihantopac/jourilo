// The audit pipeline: validate target → discover pages → capture each page per viewport → apply rules →
// merge → store a Run. Pure orchestration; measurement lives in browser/, judgment rules in audit/rules and
// conversion/.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import {
  type CaptureOptions,
  capturePage,
  captureScreenshotFiles,
  measureVitals,
  medianVitals,
  newContext,
  type PageObservation,
} from '../browser/capture.js';
import type { BrowserName } from '../browser/runtime.js';
import {
  type GuardedSession,
  type NetworkReport,
  networkLimitations,
  openGuardedBrowser,
  proxyLimitation,
} from '../browser/session.js';
import { requestLimitations, type TargetHeaders, targetHeaders } from '../browser/target-headers.js';
import { toMetrics } from '../browser/vitals.js';
import { conversionFindings } from '../conversion/rules.js';
import { applyDismissals, loadDismissals } from '../core/dismissals.js';
import { JouriloError } from '../core/errors.js';
import { newRunId } from '../core/hash.js';
import type { ProgressEvent } from '../core/progress.js';
import { redactUrl } from '../core/redact.js';
import type {
  Category,
  Finding,
  FindingKind,
  JourneyResult,
  PageCapture,
  Run,
  RunSummary,
  Severity,
  Viewport,
} from '../core/types.js';
import { RUN_SCHEMA_VERSION } from '../core/types.js';
import {
  checkTargetDetailed,
  type HostClass,
  hostListsFor,
  parseTargetUrl,
  type Upstream,
  upstreamLabel,
} from '../core/url-safety.js';
import { VERSION } from '../core/version.js';
import type { Workspace } from '../core/workspace.js';
import { crawl, explicitRobotsOverrides, robotsOverrideLimitation } from '../discovery/crawl.js';
import type { ExperienceContext } from '../integrations/context.js';
import { designFindings, respectLockedBrand } from '../integrations/design-rules.js';
import { formScreenshotFile, probeFormValidation } from '../journeys/forms.js';
import { runJourney } from '../journeys/runner.js';
import { testData } from '../journeys/safety.js';
import type { JourneySpec } from '../journeys/schema.js';
import { type EvidenceMode, firstScreenLimitation, pruneFullPageScreenshots } from './evidence.js';
import { mergeFindings } from './finding.js';
import {
  axeFindings,
  keyboardFindings,
  measuredA11yFindings,
  structureFindings,
  widgetFindings,
} from './rules/accessibility.js';
import { performanceFindings, reliabilityFindings, responsiveFindings } from './rules/experience.js';

export type Rule = (obs: PageObservation) => Finding[];

export const PAGE_RULES: Record<string, Rule> = {
  axe: axeFindings,
  keyboard: keyboardFindings,
  widgets: widgetFindings,
  structure: structureFindings,
  measuredA11y: measuredA11yFindings,
  responsive: responsiveFindings,
  reliability: reliabilityFindings,
  performance: performanceFindings,
  conversion: conversionFindings,
};

export interface AuditOptions {
  target: string;
  viewports: Viewport[];
  maxPages: number;
  maxDepth: number;
  browser: BrowserName;
  headed: boolean;
  respectRobots: boolean;
  allowPrivate: boolean;
  /** Refuse local targets (see `--deny-local`), also when reached by redirect. */
  denyLocal?: boolean;
  /** With denyLocal and a served directory: the static server's port, the only loopback port that stays reachable. */
  servedPort?: number;
  /** Chain to this upstream proxy behind the network guard (`--proxy`, HTTPS_PROXY). */
  upstream?: Upstream;
  /** `--allow-hosts`: only these hosts and the target's own host may be reached. */
  allowHosts?: string[];
  /** `--block-hosts`: these hosts are refused. */
  blockHosts?: string[];
  /** `--user-agent`: replaces the browser's User-Agent; recorded in the run. */
  userAgent?: string;
  /** `--extra-header`: sent only to the target's origin; only the names are recorded. */
  extraHeaders?: Record<string, string>;
  /** `--ignore-https-errors`: the browser accepts invalid certificates; the guard still checks destinations. */
  ignoreHttpsErrors?: boolean;
  /** `--wait-for`: capture each page once this selector is visible; checked for syntax before any page loads. */
  waitFor?: string;
  /** `--chromium-sandbox`: keep Chromium's process sandbox (Playwright disables it by default). */
  chromiumSandbox?: boolean;
  keyboard: boolean;
  throttle: boolean;
  timeoutMs: number;
  mask: string[];
  /** Only these URLs (no crawling). */
  urls?: string[];
  include?: string[];
  storageState?: string;
  locale?: string;
  timezoneId?: string;
  clock?: string;
  /** `minimal` keeps first screens and only the full-page screenshots findings point at (default `full`). */
  evidence?: EvidenceMode;
  /**
   * A journey run first, on the first viewport and under the journeys safety policy; the state it leaves (cookies,
   * localStorage) is what every capture context starts from.
   */
  setupJourney?: JourneySpec;
  /** Restrict findings to these categories. */
  categories?: Category[];
  mode: Run['mode'];
  /** Use this id instead of a generated one (idempotent runs); an id that already holds a run is refused. */
  runId?: string;
  /** Submit forms empty to test validation feedback (local hosts by default; public hosts need allowSubmit). */
  forms?: boolean;
  allowSubmit?: boolean;
  /** Discovery only: capture inventory, skip axe, keyboard walk, forms and rules. */
  inventoryOnly?: boolean;
  /** Visits per page × viewport for lab metrics (median reported). Default 1. */
  runs?: number;
  /** Optional brand/search context (jourilo.context/v1). */
  context?: ExperienceContext;
  /** Progress with its phase and counts (F35); `message` is the plain progress line. */
  onProgress?: (event: ProgressEvent) => void;
  /**
   * Stops the run early: the page in progress gets STOP_GRACE_MS to finish (then it is abandoned and left out),
   * nothing new starts, and the run is built from what was collected (`stoppedBy` set). Abort with the reason
   * `'max-duration'` when a time budget ran out; any other reason counts as a signal. The caller then owns SIGINT/SIGTERM: Playwright's own handlers, which would close
   * the browser at once, are turned off.
   */
  signal?: AbortSignal;
}

export interface AuditOutput {
  run: Run;
  runDir: string;
  observations: PageObservation[];
}

/** Thrown at a stop point once `AuditOptions.signal` is aborted; ends the browsing phase, not the run. */
class AuditStopped extends Error {}
/** A local name that does not resolve: no capture can succeed, so none is started. */
class NameUnresolved extends Error {}

/**
 * Settles with `p`, or rejects with AuditStopped as soon as `signal` aborts. Used for steps worth abandoning
 * midway (setup journey, discovery): the browser is closed afterwards, which ends the abandoned work.
 */
function untilStopped<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  p.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AuditStopped());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** How long the page (or form probe, or metrics visit) in progress may still take once a stop is requested. */
export const STOP_GRACE_MS = 3000;
const ABANDONED = Symbol('abandoned');

/**
 * Settles with `work` when it finishes, also after a stop, but waits no longer than STOP_GRACE_MS once `signal`
 * aborts: then `abandon` runs (it closes the context the work runs in) and AuditStopped is thrown, so the
 * unfinished work is left out of the run. Keeps a stop within a few seconds of the --max-duration limit even
 * while a slow page loads (F32).
 */
async function withinGrace<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  abandon: () => Promise<unknown>,
): Promise<T> {
  if (!signal) return work;
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  let onAbort: () => void = () => undefined;
  const expired = new Promise<typeof ABANDONED>((resolve) => {
    onAbort = () => {
      timer = setTimeout(() => resolve(ABANDONED), STOP_GRACE_MS);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const first = await Promise.race([work, expired]);
    if (first !== ABANDONED) return first as T;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
  await abandon().catch(() => undefined);
  throw new AuditStopped();
}

/** Waits (at most `ms`) for abandoned work to settle, so it writes nothing after its files are removed. */
async function settled(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    new Promise((r) => {
      timer = setTimeout(r, ms);
    }),
  ]);
  clearTimeout(timer);
}

function stopLimitation(
  stoppedBy: NonNullable<Run['stoppedBy']>,
  urls: { url: string }[] | undefined,
  viewports: number,
  captured: number,
): string {
  const by = stoppedBy === 'signal' ? 'by a stop signal' : 'when the --max-duration budget ran out';
  if (!urls) return `The run was stopped early ${by}, before pages were discovered, so no page was audited.`;
  const planned = urls.length * viewports;
  return `The run was stopped early ${by}: ${planned - captured} of ${planned} planned page captures (${urls.length} page(s) × ${viewports} viewport(s)) were not audited, and steps after the stop (repeat metrics runs, form probes) were skipped. Findings cover only what was captured.`;
}

/** Browser state options every context of the run shares. */
function stateOptions(opts: AuditOptions): { timezoneId?: string; clock?: string } {
  return {
    ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
  };
}

/** What every browser context of the run starts with: page state, and the request options of F16. */
function contextOptions(
  opts: AuditOptions,
  headers: TargetHeaders | undefined,
): Pick<CaptureOptions, 'timezoneId' | 'clock' | 'userAgent' | 'extraHeaders' | 'ignoreHttpsErrors'> {
  return {
    ...stateOptions(opts),
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(headers ? { extraHeaders: headers } : {}),
    ...(opts.ignoreHttpsErrors ? { ignoreHttpsErrors: true } : {}),
  };
}

/** A selector Playwright cannot parse is a usage error, found on a blank page before any target page loads. */
async function checkSelector(browser: Browser, selector: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.locator(selector).count();
  } catch (err) {
    throw new JouriloError(
      'USAGE',
      `--wait-for is not a valid selector: ${(err as Error).message.split('\n')[0]}`,
      'Example: --wait-for "main h1" or --wait-for "[data-ready]"',
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * Checked before any browser work. A run that exists is never overwritten, and neither is a directory without
 * run.json (left by a crashed run): its leftovers would enter the new run's manifest (F33).
 */
function resolveRunId(ws: Workspace, requested: string | undefined): string {
  if (requested === undefined) return newRunId();
  if (!RUN_ID_PATTERN.test(requested))
    throw new JouriloError(
      'INVALID_INPUT',
      `Invalid run id "${requested}".`,
      'Use 1-64 letters, digits, "_" or "-", starting with a letter or digit.',
    );
  const dir = ws.runDir(requested);
  if (existsSync(join(dir, 'run.json')))
    throw new JouriloError('INVALID_INPUT', `Run ${requested} already exists.`, 'Pick another --run-id.');
  if (existsSync(dir))
    throw new JouriloError(
      'INVALID_INPUT',
      `The directory of run ${requested} already exists (${dir}) without a finished run, probably left by a run that did not finish.`,
      'Pick another --run-id, or remove that directory first.',
    );
  return requested;
}

export async function runAudit(ws: Workspace, opts: AuditOptions): Promise<AuditOutput> {
  const id = resolveRunId(ws, opts.runId);
  // Read before any browser work, so a corrupt dismissed.json fails fast instead of losing a finished audit.
  const dismissals = loadDismissals(ws);
  const target = parseTargetUrl(opts.target);
  const check = await checkTargetDetailed(target, {
    allowPrivate: opts.allowPrivate,
    // The target of a served directory is Jourilo's own server; the guard still confines the page.
    ...(opts.denyLocal && opts.servedPort === undefined ? { denyLocal: true } : {}),
  });
  const hostClass: HostClass = check.hostClass;
  const hostLists = hostListsFor(target, opts.allowHosts ?? [], opts.blockHosts ?? []);
  const headers = opts.extraHeaders ? targetHeaders(target.origin, opts.extraHeaders) : undefined;
  const browsing = contextOptions(opts, headers);
  const progress = opts.onProgress ?? (() => undefined);
  const runDir = ws.createRunDir(id);
  const startedAt = new Date().toISOString();
  const limitations: string[] = [];
  const signal = opts.signal;
  const halt = () => {
    if (signal?.aborted) throw new AuditStopped();
  };

  // Pages known up front (--url, or only the target) need no discovery.
  let urls: { url: string; role?: string }[] | undefined;
  let sample: Run['sample'];
  if (opts.urls?.length) {
    urls = [...new Set(opts.urls.map((u) => new URL(u, target).toString()))].map((url) => ({ url }));
    for (const u of urls) {
      if (new URL(u.url).origin !== target.origin)
        throw new JouriloError('UNSAFE_URL', `--url ${u.url} is not on the target origin ${target.origin}.`);
    }
  } else if (opts.maxPages <= 1) {
    urls = [{ url: target.toString() }];
  }

  let session: GuardedSession | undefined;
  let browserVersion = 'unknown';
  let storageState = opts.storageState;
  const journeys: JourneyResult[] = [];
  const observations: PageObservation[] = [];
  const formFindings: Finding[] = [];
  const simulated: string[] = [];
  const runs = Math.max(1, Math.min(9, Math.round(opts.runs ?? 1)));
  let stoppedBy: Run['stoppedBy'];
  // The session cookies a setup journey saves; never left in the run directory once browsing is over.
  const setupState = join(runDir, 'setup-state.json');
  let network: NetworkReport = { blocked: [], escaped: [] };
  // Closes the browser first, so a setup journey abandoned by a stop cannot write its state after the removal.
  const endBrowsing = async () => {
    if (session) network = session.report();
    const closing = session;
    session = undefined;
    await closeBrowsing(closing, setupState);
  };
  try {
    try {
      if (check.unresolved) throw new NameUnresolved();
      progress({ phase: 'launch', message: `Starting ${opts.browser} …` });
      halt();
      // Not abandoned midway: a browser still launching would be left running.
      session = await openGuardedBrowser(
        opts.browser,
        opts.headed,
        {
          target: hostClass,
          allowPrivate: opts.allowPrivate,
          ...(opts.denyLocal
            ? {
                denyLocal: true,
                ...(opts.servedPort === undefined ? {} : { allowLoopbackPorts: [opts.servedPort] }),
              }
            : {}),
          ...hostLists,
          ...(opts.upstream ? { upstream: opts.upstream } : {}),
        },
        signal !== undefined,
        { ...(opts.chromiumSandbox ? { sandbox: true } : {}), runDir },
      );
      const browser: Browser = session.browser;
      browserVersion = browser.version();
      if (opts.waitFor) {
        try {
          await checkSelector(browser, opts.waitFor);
        } catch (err) {
          // Nothing was captured: do not leave an empty run directory that would block a retry with this --run-id.
          if (!existsSync(join(runDir, 'run.json'))) rmSync(runDir, { recursive: true, force: true });
          throw err;
        }
      }
      // The header route tells the guard's own CONNECT failures from pages by this token.
      if (headers) headers.guardToken = session.guard.token;
      halt();

      // 0. Setup journey: bring the site into the state to audit. It goes through the same safety policy as
      // `journeys run`, starts from --auth, and its resulting storage state replaces --auth for every capture.
      if (opts.setupJourney) {
        const spec = opts.setupJourney;
        progress({ phase: 'setup', message: `Running setup journey ${spec.id} …` });
        const { result } = await untilStopped(
          runJourney(browser, spec, {
            base: target,
            runDir,
            hostClass,
            policy: { hostClass, allowSubmit: opts.allowSubmit ?? false, allowDestructive: false },
            data: testData(id, {}),
            trace: false,
            stepTimeoutMs: Math.min(opts.timeoutMs, 10_000),
            viewportOverride: opts.viewports[0]!.name,
            saveAuth: setupState,
            ...(opts.evidence ? { evidence: opts.evidence } : {}),
            ...(opts.storageState ? { storageState: opts.storageState } : {}),
            ...browsing,
            log: (message) => progress({ phase: 'setup', message }),
          }),
          signal,
        );
        journeys.push({ ...result, role: 'setup' });
        if (result.status !== 'passed') {
          const bad = result.steps.find((x) => x.status === 'failed' || x.status === 'blocked');
          const unmet = result.successCriteria.filter((c) => !c.met).map((c) => c.description);
          throw new JouriloError(
            'JOURNEY_FAILED',
            `Setup journey "${spec.id}" ${result.status}${
              bad ? ` at step ${bad.index + 1} (${bad.description}): ${bad.error ?? bad.status}` : ''
            }${unmet.length && !bad ? `; unmet: ${unmet.join('; ')}` : ''}. The audit was not run.`,
            'Fix the journey with `jourilo journeys run` first.',
          );
        }
        storageState = setupState;
        limitations.push(
          'State the setup journey left outside cookies and localStorage (for example, in-memory state) does not carry over to audited pages.',
        );
      }

      // 1. Discover pages.
      if (!urls) {
        halt();
        progress({
          phase: 'discover',
          message: `Discovering pages on ${target.origin} …`,
          url: target.origin,
        });
        const ctx = await newContext(browser, opts.viewports[0]!, {
          runDir,
          timeoutMs: opts.timeoutMs,
          ...(storageState ? { storageState } : {}),
          ...browsing,
        });
        const found = await untilStopped(
          crawl(ctx, target.toString(), {
            maxPages: opts.maxPages,
            maxDepth: opts.maxDepth,
            respectRobots: opts.respectRobots,
            timeoutMs: opts.timeoutMs,
            policy: session.guard.policy,
            ...(opts.include ? { include: opts.include } : {}),
          }),
          signal,
        ).finally(() => ctx.close().catch(() => undefined));
        const discovered = found.pages.map((p) => ({ url: p.url, role: p.role }));
        const robotsSkips = found.skipped.filter((s) => s.reason === 'robots.txt').length;
        if (robotsSkips)
          limitations.push(`${robotsSkips} URL(s) were skipped because robots.txt disallows them.`);
        for (const u of found.robotsOverridden) limitations.push(robotsOverrideLimitation(u));
        if (found.sitemapRebasedFrom)
          limitations.push(
            `The sitemap lists ${found.sitemapRebasedFrom} URLs; their paths were audited on the local server instead.`,
          );
        if (!found.robots && opts.respectRobots && hostClass === 'public')
          limitations.push('No robots.txt was found; crawling stayed on the target origin.');
        urls = discovered.length ? discovered : [{ url: target.toString() }];
        if (found.leftOut.length) {
          sample = {
            discovered: found.discovered,
            audited: found.pages.length,
            leftOut: found.leftOut.slice(0, 20),
          };
          limitations.push(sampleLimitation(sample)!);
        }
      } else if (opts.respectRobots) {
        // Pages known up front skip discovery, but robots.txt is still read: a disallowed page is audited because
        // it was requested, and the run says so.
        halt();
        for (const u of await untilStopped(
          explicitRobotsOverrides(
            urls.map((x) => x.url),
            session.guard.policy,
          ),
          signal,
        ))
          limitations.push(robotsOverrideLimitation(u));
      }
      // Captures, metrics visits and form probes are counted in advance; `done` is how many finished before a line.
      const captures = urls.length * opts.viewports.length;
      progress({
        phase: 'capture',
        message: `Auditing ${urls.length} page(s) × ${opts.viewports.length} viewport(s) in ${opts.browser} ${browserVersion}`,
        done: 0,
        total: captures,
      });

      // 2. Capture every page in every viewport. A stop gives the page in progress STOP_GRACE_MS to finish.
      const primaryOrigin = new URL(urls?.[0]?.url ?? target).origin;
      for (const vp of opts.viewports) {
        halt();
        const ctx = await newContext(browser, vp, {
          runDir,
          timeoutMs: opts.timeoutMs,
          ...(storageState ? { storageState } : {}),
          ...browsing,
          ...(opts.locale ? { locale: opts.locale } : {}),
        });
        try {
          for (const { url } of urls) {
            halt();
            progress({
              phase: 'capture',
              message: `  ${vp.name.padEnd(8)} ${redactUrl(url)}`,
              done: observations.length,
              total: captures,
              url: redactUrl(url),
              viewport: vp.name,
            });
            const capture = capturePage(ctx, url, vp, {
              runDir,
              primaryOrigin,
              guardToken: session.guard.token,
              timeoutMs: opts.timeoutMs,
              mask: opts.mask,
              // Keyboard walks are for keyboard devices; skip them on touch viewports unless only touch was requested.
              keyboard:
                !opts.inventoryOnly &&
                opts.keyboard &&
                (!vp.hasTouch || opts.viewports.every((v) => v.hasTouch)),
              axe: !opts.inventoryOnly,
              throttle: opts.throttle,
              ...(opts.evidence ? { evidence: opts.evidence } : {}),
              ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
            });
            const obs = await withinGrace(capture, signal, async () => {
              await ctx.close();
              await settled(capture, 1000);
              const { full, fold } = captureScreenshotFiles(url, vp, primaryOrigin);
              for (const f of [full, fold]) rmSync(join(runDir, f), { force: true });
            });
            observations.push(obs);
          }
        } finally {
          await ctx.close().catch(() => undefined);
        }
      }

      // 2b. Repeated cold-cache visits for lab metrics: report medians, not a single noisy sample.
      if (runs > 1) {
        const measured = observations.filter((o) => o.vitals && (o.status ?? 200) < 400);
        const visits = measured.length * (runs - 1);
        let visited = 0;
        for (const obs of measured) {
          const samples = [obs.vitals!];
          for (let k = 1; k < runs; k++) {
            halt();
            progress({
              phase: 'metrics',
              message: `  metrics  ${obs.viewport.name.padEnd(8)} ${obs.url} (run ${k + 1}/${runs})`,
              done: visited++,
              total: visits,
              url: obs.url,
              viewport: obs.viewport.name,
            });
            // An abandoned visit ends when the browser closes; the first sample stands.
            const v = await withinGrace(
              measureVitals(browser, obs.finalUrl, obs.viewport, {
                runDir,
                timeoutMs: opts.timeoutMs,
                throttle: opts.throttle,
                ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
                ...(storageState ? { storageState } : {}),
                ...browsing,
              }),
              signal,
              async () => undefined,
            );
            if (v) samples.push(v);
          }
          const m = medianVitals(samples);
          obs.vitals = m.vitals;
          obs.vitalsSpread = m.spread;
          obs.vitalsRuns = samples.length;
        }
      }

      // 3. Form validation probes (interactive, so gated by the safety policy).
      const formsAllowed = hostClass === 'local' || opts.allowSubmit === true;
      if (opts.forms !== false && !opts.inventoryOnly && formsAllowed) {
        const vp = opts.viewports.find((v) => !v.hasTouch) ?? opts.viewports[0]!;
        const ctx = await newContext(browser, vp, {
          runDir,
          timeoutMs: opts.timeoutMs,
          ...(storageState ? { storageState } : {}),
          ...browsing,
        });
        // Only forms whose input is clearly needed: a known purpose, or fields marked required. A generic form with
        // optional fields may legitimately accept an empty submission. At most three per page.
        const probes = observations
          .filter((x) => x.viewport.name === vp.name && (x.status ?? 200) < 400)
          .flatMap((o) =>
            (o.probe?.inventory.forms ?? [])
              .filter(
                (f) => f.purpose !== 'search' && (f.purpose !== 'other' || f.fields.some((x) => x.required)),
              )
              .slice(0, 3)
              .map((form) => ({ o, form })),
          );
        try {
          for (const [i, { o, form }] of probes.entries()) {
            halt();
            progress({
              phase: 'forms',
              message: `  form     ${o.url} ${form.selector}`,
              done: i,
              total: probes.length,
              url: o.url,
              viewport: vp.name,
            });
            const probe = probeFormValidation(
              ctx,
              o.finalUrl,
              form,
              vp,
              { hostClass, allowSubmit: opts.allowSubmit ?? false, allowDestructive: false },
              runDir,
              // Wait as the capture did; a capture that never found the element took its forms from the page
              // as it was, which a plain fresh load reproduces.
              {
                ...(opts.waitFor && o.load?.found !== false ? { waitFor: opts.waitFor } : {}),
                timeoutMs: opts.timeoutMs,
                primaryOrigin,
              },
            );
            const r = await withinGrace(probe, signal, async () => {
              await ctx.close();
              await settled(probe, 1000);
              rmSync(join(runDir, formScreenshotFile(o.finalUrl, form.selector, vp, primaryOrigin)), {
                force: true,
              });
            });
            formFindings.push(...r.findings);
            if (r.result.outcome === 'blocked')
              limitations.push(`Form ${form.selector} on ${o.url} was not submitted: ${r.result.detail}`);
            if (r.result.outcome === 'simulated') simulated.push(`${form.selector} on ${o.url}`);
            if (r.result.outcome === 'skipped')
              limitations.push(`Form ${form.selector} on ${o.url} was not probed: ${r.result.detail}`);
          }
        } finally {
          await ctx.close().catch(() => undefined);
        }
        if (simulated.length)
          limitations.push(
            `Form validation was simulated: empty submissions were intercepted before reaching the server, so nothing was written. ${simulated.length} form(s) rely on the server for validation feedback (${simulated.slice(0, 3).join('; ')}${simulated.length > 3 ? '; …' : ''}); that feedback was not tested. Rerun with --allow-submit on a disposable environment to test it.`,
          );
      } else if (opts.forms !== false && observations.some((o) => o.probe?.inventory.forms.length)) {
        limitations.push(
          'Form validation was not tested: submitting forms on a public host requires --allow-submit (authorized test environments only).',
        );
      }
    } catch (err) {
      if (err instanceof NameUnresolved) {
        const msg = `No page was loaded: the host name ${target.hostname} could not be resolved (no hosts entry or local DNS answer).`;
        progress({ phase: 'launch', message: msg });
        limitations.push(msg);
      } else if (err instanceof AuditStopped) {
        stoppedBy = signal?.reason === 'max-duration' ? 'max-duration' : 'signal';
        progress({ phase: 'report', message: `Stopped early (${stoppedBy}); writing a partial run …` });
      } else throw err;
    }
    await endBrowsing();
    if (stoppedBy)
      limitations.push(stopLimitation(stoppedBy, urls, opts.viewports.length, observations.length));

    // A local build often has no page at "/" (the production server redirects it, e.g. to /en/). When other pages
    // were found, that is stated rather than reported as a broken page of the site.
    if (hostClass === 'local' && !opts.urls?.length) {
      const startPath = target.pathname;
      const missing = observations.filter((o) => o.status === 404 && new URL(o.url).pathname === startPath);
      if (missing.length && observations.some((o) => (o.status ?? 200) < 400)) {
        for (const m of missing) observations.splice(observations.indexOf(m), 1);
        limitations.push(
          `${startPath} returned 404 on this local server (no start page in the build); it was not audited. The other pages were found through the sitemap and links.`,
        );
      }
    }

    // 4. Findings.
    let findings: Finding[] = [...formFindings];
    for (const obs of opts.inventoryOnly ? [] : observations) {
      // An error page (4xx/5xx) is one finding — the broken link — not a list of its template's defects.
      const rules =
        obs.status !== null && obs.status >= 400 ? [PAGE_RULES.reliability!] : Object.values(PAGE_RULES);
      for (const rule of rules) findings.push(...rule(obs));
      if (opts.context?.brand && rules.length > 1) findings.push(...designFindings(obs, opts.context.brand));
      for (const e of obs.errors)
        if (!e.startsWith('navigation:')) limitations.push(`${obs.url} (${obs.viewport.name}): ${e}`);
    }
    findings = mergeFindings(findings);
    respectLockedBrand(findings, opts.context?.brand ?? null);
    if (opts.categories?.length) findings = findings.filter((f) => opts.categories!.includes(f.category));
    // Findings a person already dismissed stay out of the run (and the summary), listed apart with their reason.
    const { kept, dismissed } = applyDismissals(findings, dismissals);
    findings = kept;

    limitations.push(
      'Automated accessibility checks cover only part of WCAG 2.2; criteria such as 1.3.3, 2.5.7, 3.2.6, 3.3.7 and 3.3.8 and most content quality questions need manual review.',
      runs > 1
        ? `Performance numbers are medians of ${runs} cold-cache lab visits, not field (real-user) data.`
        : 'Performance numbers are lab measurements from one scripted visit, not field (real-user) data; use --runs 5 for medians.',
    );
    const unsupported = [...new Set(observations.flatMap((o) => o.vitals?.unsupported ?? []))];
    if (unsupported.length) {
      const names: Record<string, string> = {
        'largest-contentful-paint': 'LCP',
        'layout-shift': 'CLS',
        longtask: 'TBT',
        event: 'INP',
      };
      limitations.push(
        `${opts.browser} does not expose ${unsupported.map((t) => names[t] ?? t).join(', ')}: those metrics (and checks that depend on them, such as layout shift from unsized images) were not measured. Use Chromium for performance.`,
      );
    }
    if (observations.some((o) => o.keyboard?.skipsLinks))
      limitations.push(
        `${opts.browser} on this platform does not move keyboard focus to links with Tab or Alt+Tab: the keyboard walk covered buttons and form controls only, so focus checks on links (visibility, obscuring, order) were not run. Use Chromium or Firefox for the full keyboard walk.`,
      );
    if (opts.throttle)
      limitations.push(
        'Throttling simulated a mid-range mobile network and 4× CPU slowdown (Chromium only).',
      );
    else limitations.push('Measured without network/CPU throttling: real mobile devices are usually slower.');

    limitations.push(
      ...proxyLimitation(opts.upstream),
      ...networkLimitations(network),
      ...requestLimitations({
        ...(opts.ignoreHttpsErrors ? { ignoreHttpsErrors: true } : {}),
        ...(headers ? { headers } : {}),
      }),
    );
    if (opts.waitFor) {
      const missed = observations.filter((o) => o.load?.found === false);
      if (missed.length)
        limitations.push(
          `--wait-for ${JSON.stringify(opts.waitFor)}: the element was not visible within ${Math.round(opts.timeoutMs / 1000)} s on ${missed.length} of ${observations.length} capture(s); those pages were audited in the state they were in then.`,
        );
    }
    const stopped = observations.flatMap((o) => o.blockedActions ?? []);
    if (stopped.length)
      limitations.push(
        `While keys were pressed and widgets operated, ${stopped.length} request(s) that would have changed data or left the site were stopped (e.g. ${stopped[0]!.method} ${stopped[0]!.url}); audits only observe.`,
      );

    // Pruned only now: findings are built and dismissals applied, and dismissed findings keep their evidence.
    const pages: PageCapture[] = observations.map((o) => ({
      url: o.url,
      finalUrl: o.finalUrl,
      status: o.status,
      title: o.title,
      viewport: o.viewport.name,
      ...(o.screenshot ? { screenshot: o.screenshot } : {}),
      ...(o.foldScreenshot ? { foldScreenshot: o.foldScreenshot } : {}),
      loadMs: o.loadMs,
      metrics: o.vitals ? toMetrics(o.vitals, o.vitalsSpread, o.vitalsRuns) : [],
      consoleErrors: o.console.filter((c) => c.type !== 'warning').length,
      failedRequests: o.network.length,
      inventory: o.probe?.inventory ?? emptyInventory(),
      ...(o.load ? { load: o.load } : {}),
    }));
    if (opts.evidence === 'minimal') {
      const { pruned } = pruneFullPageScreenshots(
        runDir,
        pages,
        [...findings, ...dismissed],
        observations.map((o) => o.foldScreenshot),
      );
      if (pruned.length) limitations.push(firstScreenLimitation(pruned));
    }

    const run: Run = {
      schemaVersion: RUN_SCHEMA_VERSION,
      id,
      tool: { name: 'jourilo', version: VERSION },
      mode: opts.mode,
      target: redactUrl(target.toString()),
      startedAt,
      finishedAt: new Date().toISOString(),
      browser: { name: opts.browser, version: browserVersion },
      viewports: opts.viewports,
      settings: {
        maxPages: opts.maxPages,
        maxDepth: opts.maxDepth,
        respectRobots: opts.respectRobots,
        keyboard: opts.keyboard,
        throttle: opts.throttle,
        runs,
        ...(opts.evidence === 'minimal' ? { evidence: 'minimal' } : {}),
        ...(opts.setupJourney ? { setupJourney: opts.setupJourney.id } : {}),
        ...(opts.timezoneId ? { timezoneId: opts.timezoneId } : {}),
        ...(opts.clock ? { clock: opts.clock } : {}),
        // The proxy without its credentials, and the host lists as given.
        ...(opts.upstream ? { proxy: upstreamLabel(opts.upstream) } : {}),
        ...(opts.allowHosts?.length ? { allowHosts: opts.allowHosts } : {}),
        ...(opts.blockHosts?.length ? { blockHosts: opts.blockHosts } : {}),
        // The user agent as given; of the extra headers only the names, never their values.
        ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
        ...(opts.extraHeaders ? { extraHeaders: Object.keys(opts.extraHeaders) } : {}),
        ...(opts.ignoreHttpsErrors ? { ignoreHttpsErrors: true } : {}),
        ...(opts.waitFor ? { waitFor: opts.waitFor } : {}),
        ...(opts.chromiumSandbox ? { chromiumSandbox: true } : {}),
        axe: observations.find((o) => o.axe)?.axe?.version ?? null,
        hostClass,
        // The exact scope, so `jourilo verify` can repeat this run after a change.
        scope: {
          urls: [...new Set((urls ?? []).map((u) => redactUrl(u.url)))],
          viewports: opts.viewports.map((v) => v.name),
        },
      },
      pages,
      journeys,
      findings,
      ...(dismissed.length ? { dismissed } : {}),
      ...(stoppedBy ? { stoppedBy } : {}),
      summary: summarize(findings, pages.length, journeys.length, new Set(pages.map((p) => p.url)).size),
      ...(sample ? { sample } : {}),
      limitations: [...new Set(limitations)],
      ...(opts.context && (opts.context.brand || opts.context.search) ? { context: opts.context } : {}),
      ...(network.blocked.length || network.escaped.length ? { network } : {}),
    };
    ws.saveRun(run);
    return { run, runDir, observations };
  } finally {
    await endBrowsing();
  }
}

/** Closes the browser, then removes the setup journey's session state even when closing throws (the error is reported). */
export async function closeBrowsing(
  session: { close(): Promise<unknown> } | undefined,
  setupState: string,
): Promise<void> {
  try {
    await session?.close();
  } finally {
    rmSync(setupState, { force: true });
  }
}

/** Says how much of the discovered site a sampled run covered; undefined when nothing was left out. */
export function sampleLimitation(sample: NonNullable<Run['sample']>): string | undefined {
  if (sample.discovered <= sample.audited) return undefined;
  return `${sample.audited} of ${sample.discovered} discovered pages were audited; ${sample.discovered - sample.audited} were left out (raise --pages to include more). Findings describe the audited pages only.`;
}

/** `urls` is the number of distinct audited URLs; `pages` counts captures (URL × viewport). */
export function summarize(findings: Finding[], pages: number, journeys: number, urls?: number): RunSummary {
  const sev: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
  const kind: Record<FindingKind, number> = { defect: 0, hypothesis: 0, 'needs-review': 0 };
  const cat: Partial<Record<Category, number>> = {};
  for (const f of findings) {
    // Severity counts are for defects only; hypotheses and review items are counted by kind.
    if (f.kind === 'defect') sev[f.severity]++;
    kind[f.kind]++;
    cat[f.category] = (cat[f.category] ?? 0) + 1;
  }
  return {
    pages,
    ...(urls === undefined ? {} : { urls, captures: pages }),
    journeys,
    findings: sev,
    byCategory: cat,
    byKind: kind,
  };
}

export function emptyInventory(): PageCapture['inventory'] {
  return {
    lang: null,
    h1: [],
    headings: [],
    landmarks: [],
    ctas: [],
    forms: [],
    links: [],
    images: { total: 0, withoutAlt: 0, withoutDimensions: 0 },
    trustSignals: [],
    pricingSignals: [],
    wordCount: 0,
    metaDescription: null,
    hasViewportMeta: false,
  };
}
