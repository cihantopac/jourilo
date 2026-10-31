// The audit pipeline: validate target → discover pages → capture each page per viewport → apply rules →
// merge → store a Run. Pure orchestration; measurement lives in browser/, judgment rules in audit/rules and
// conversion/.
import type { Browser } from 'playwright-core';
import {
  capturePage,
  measureVitals,
  medianVitals,
  newContext,
  type PageObservation,
} from '../browser/capture.js';
import type { BrowserName } from '../browser/runtime.js';
import { type GuardedSession, networkLimitations, openGuardedBrowser } from '../browser/session.js';
import { toMetrics } from '../browser/vitals.js';
import { conversionFindings } from '../conversion/rules.js';
import { JouriloError } from '../core/errors.js';
import { newRunId } from '../core/hash.js';
import { redactUrl } from '../core/redact.js';
import type {
  Category,
  Finding,
  FindingKind,
  PageCapture,
  Run,
  RunSummary,
  Severity,
  Viewport,
} from '../core/types.js';
import { RUN_SCHEMA_VERSION } from '../core/types.js';
import { checkTarget, type HostClass, parseTargetUrl } from '../core/url-safety.js';
import { VERSION } from '../core/version.js';
import type { Workspace } from '../core/workspace.js';
import { crawl } from '../discovery/crawl.js';
import type { ExperienceContext } from '../integrations/context.js';
import { designFindings, respectLockedBrand } from '../integrations/design-rules.js';
import { probeFormValidation } from '../journeys/forms.js';
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
  keyboard: boolean;
  throttle: boolean;
  timeoutMs: number;
  mask: string[];
  /** Only these URLs (no crawling). */
  urls?: string[];
  include?: string[];
  storageState?: string;
  locale?: string;
  /** Restrict findings to these categories. */
  categories?: Category[];
  mode: Run['mode'];
  /** Submit forms empty to test validation feedback (local hosts by default; public hosts need allowSubmit). */
  forms?: boolean;
  allowSubmit?: boolean;
  /** Discovery only: capture inventory, skip axe, keyboard walk, forms and rules. */
  inventoryOnly?: boolean;
  /** Visits per page × viewport for lab metrics (median reported). Default 1. */
  runs?: number;
  /** Optional brand/search context (jourilo.context/v1). */
  context?: ExperienceContext;
  onProgress?: (msg: string) => void;
}

export interface AuditOutput {
  run: Run;
  runDir: string;
  observations: PageObservation[];
}

export async function runAudit(ws: Workspace, opts: AuditOptions): Promise<AuditOutput> {
  const target = parseTargetUrl(opts.target);
  const hostClass: HostClass = await checkTarget(target, { allowPrivate: opts.allowPrivate });
  const log = opts.onProgress ?? (() => undefined);
  const id = newRunId();
  const runDir = ws.createRunDir(id);
  const startedAt = new Date().toISOString();
  const limitations: string[] = [];

  let session: GuardedSession | undefined;
  try {
    session = await openGuardedBrowser(opts.browser, opts.headed, {
      target: hostClass,
      allowPrivate: opts.allowPrivate,
    });
    const browser: Browser = session.browser;
    const browserVersion = browser.version();

    // 1. Discover pages.
    let urls: { url: string; role?: string }[];
    if (opts.urls?.length) {
      urls = opts.urls.map((u) => ({ url: new URL(u, target).toString() }));
      for (const u of urls) {
        if (new URL(u.url).origin !== target.origin)
          throw new JouriloError(
            'UNSAFE_URL',
            `--url ${u.url} is not on the target origin ${target.origin}.`,
          );
      }
    } else if (opts.maxPages <= 1) {
      urls = [{ url: target.toString() }];
    } else {
      log(`Discovering pages on ${target.origin} …`);
      const ctx = await newContext(browser, opts.viewports[0]!, {
        runDir,
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
      });
      const found = await crawl(ctx, target.toString(), {
        maxPages: opts.maxPages,
        maxDepth: opts.maxDepth,
        respectRobots: opts.respectRobots,
        timeoutMs: opts.timeoutMs,
        policy: session.guard.policy,
        ...(opts.include ? { include: opts.include } : {}),
      });
      await ctx.close();
      urls = found.pages.map((p) => ({ url: p.url, role: p.role }));
      const robotsSkips = found.skipped.filter((s) => s.reason === 'robots.txt').length;
      if (robotsSkips)
        limitations.push(`${robotsSkips} URL(s) were skipped because robots.txt disallows them.`);
      if (!found.robots && opts.respectRobots && hostClass === 'public')
        limitations.push('No robots.txt was found; crawling stayed on the target origin.');
      if (!urls.length) urls = [{ url: target.toString() }];
    }
    log(
      `Auditing ${urls.length} page(s) × ${opts.viewports.length} viewport(s) in ${opts.browser} ${browserVersion}`,
    );

    // 2. Capture every page in every viewport.
    const observations: PageObservation[] = [];
    for (const vp of opts.viewports) {
      const ctx = await newContext(browser, vp, {
        runDir,
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
        ...(opts.locale ? { locale: opts.locale } : {}),
      });
      try {
        for (const { url } of urls) {
          log(`  ${vp.name.padEnd(8)} ${redactUrl(url)}`);
          const obs = await capturePage(ctx, url, vp, {
            runDir,
            timeoutMs: opts.timeoutMs,
            mask: opts.mask,
            // Keyboard walks are for keyboard devices; skip them on touch viewports unless only touch was requested.
            keyboard:
              !opts.inventoryOnly &&
              opts.keyboard &&
              (!vp.hasTouch || opts.viewports.every((v) => v.hasTouch)),
            axe: !opts.inventoryOnly,
            throttle: opts.throttle,
          });
          observations.push(obs);
        }
      } finally {
        await ctx.close().catch(() => undefined);
      }
    }

    // 2b. Repeated cold-cache visits for lab metrics: report medians, not a single noisy sample.
    const runs = Math.max(1, Math.min(9, Math.round(opts.runs ?? 1)));
    if (runs > 1) {
      for (const obs of observations) {
        if (!obs.vitals || (obs.status ?? 200) >= 400) continue;
        const samples = [obs.vitals];
        for (let k = 1; k < runs; k++) {
          log(`  metrics  ${obs.viewport.name.padEnd(8)} ${obs.url} (run ${k + 1}/${runs})`);
          const v = await measureVitals(browser, obs.finalUrl, obs.viewport, {
            runDir,
            timeoutMs: opts.timeoutMs,
            throttle: opts.throttle,
            ...(opts.storageState ? { storageState: opts.storageState } : {}),
          });
          if (v) samples.push(v);
        }
        const m = medianVitals(samples);
        obs.vitals = m.vitals;
        obs.vitalsSpread = m.spread;
        obs.vitalsRuns = samples.length;
      }
    }

    // 3. Form validation probes (interactive, so gated by the safety policy).
    const formFindings: Finding[] = [];
    const simulated: string[] = [];
    const formsAllowed = hostClass === 'local' || opts.allowSubmit === true;
    if (opts.forms !== false && !opts.inventoryOnly && formsAllowed) {
      const vp = opts.viewports.find((v) => !v.hasTouch) ?? opts.viewports[0]!;
      const ctx = await newContext(browser, vp, {
        runDir,
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
      });
      try {
        for (const o of observations.filter((x) => x.viewport.name === vp.name && (x.status ?? 200) < 400)) {
          // Only forms whose input is clearly needed: a known purpose, or fields marked required. A generic form
          // with optional fields may legitimately accept an empty submission.
          const probeable = (o.probe?.inventory.forms ?? []).filter(
            (f) => f.purpose !== 'search' && (f.purpose !== 'other' || f.fields.some((x) => x.required)),
          );
          for (const form of probeable.slice(0, 3)) {
            log(`  form     ${o.url} ${form.selector}`);
            const r = await probeFormValidation(
              ctx,
              o.finalUrl,
              form,
              vp,
              { hostClass, allowSubmit: opts.allowSubmit ?? false, allowDestructive: false },
              runDir,
            );
            formFindings.push(...r.findings);
            if (r.result.outcome === 'blocked')
              limitations.push(`Form ${form.selector} on ${o.url} was not submitted: ${r.result.detail}`);
            if (r.result.outcome === 'simulated') simulated.push(`${form.selector} on ${o.url}`);
          }
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

    const network = session.report();
    limitations.push(...networkLimitations(network));
    const stopped = observations.flatMap((o) => o.blockedActions ?? []);
    if (stopped.length)
      limitations.push(
        `While keys were pressed and widgets operated, ${stopped.length} request(s) that would have changed data or left the site were stopped (e.g. ${stopped[0]!.method} ${stopped[0]!.url}); audits only observe.`,
      );

    const pages: PageCapture[] = observations.map((o) => ({
      url: o.url,
      finalUrl: o.finalUrl,
      status: o.status,
      title: o.title,
      viewport: o.viewport.name,
      ...(o.screenshot ? { screenshot: o.screenshot } : {}),
      loadMs: o.loadMs,
      metrics: o.vitals ? toMetrics(o.vitals, o.vitalsSpread, o.vitalsRuns) : [],
      consoleErrors: o.console.filter((c) => c.type !== 'warning').length,
      failedRequests: o.network.length,
      inventory: o.probe?.inventory ?? emptyInventory(),
    }));

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
        axe: observations.find((o) => o.axe)?.axe?.version ?? null,
        hostClass,
        // The exact scope, so `jourilo verify` can repeat this run after a change.
        scope: { urls: [...new Set(urls.map((u) => u.url))], viewports: opts.viewports.map((v) => v.name) },
      },
      pages,
      journeys: [],
      findings,
      summary: summarize(findings, pages.length, 0),
      limitations: [...new Set(limitations)],
      ...(opts.context && (opts.context.brand || opts.context.search) ? { context: opts.context } : {}),
      ...(network.blocked.length || network.escaped.length ? { network } : {}),
    };
    ws.saveRun(run);
    return { run, runDir, observations };
  } finally {
    await session?.close();
  }
}

export function summarize(findings: Finding[], pages: number, journeys: number): RunSummary {
  const sev: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 };
  const kind: Record<FindingKind, number> = { defect: 0, hypothesis: 0, 'needs-review': 0 };
  const cat: Partial<Record<Category, number>> = {};
  for (const f of findings) {
    // Severity counts are for defects only; hypotheses and review items are counted by kind.
    if (f.kind === 'defect') sev[f.severity]++;
    kind[f.kind]++;
    cat[f.category] = (cat[f.category] ?? 0) + 1;
  }
  return { pages, journeys, findings: sev, byCategory: cat, byKind: kind };
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
