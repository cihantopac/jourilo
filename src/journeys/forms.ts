// Form validation probe: submits a form with its fields left empty and measures what a person would experience.
// Does the form say what is wrong (WCAG 3.3.1)? Is the message tied to the field or announced (1.3.1, 4.1.3)?
// Does focus move to the problem?
// By default the submission is simulated: the page runs its own submit handlers and native validation, but every
// request that would send data (form post, fetch/XHR with a body) is intercepted before it leaves the browser, so a
// local database is never written. Feedback that needs the server's answer is then reported as not tested. Only
// with --allow-submit (a disposable environment) is the empty submission really sent.
import type { BrowserContext } from 'playwright-core';
import { makeFinding } from '../audit/finding.js';
import { nielsen, wcag } from '../audit/standards.js';
import { DEFAULT_MASK, originFreeName, waitForElement } from '../browser/capture.js';
import { SELECTOR_OF } from '../browser/keyboard.js';
import { toPosix } from '../core/fs-safety.js';
import { shortHash } from '../core/hash.js';
import { lexicon, lexiconSource } from '../core/lexicon.js';
import { excerpt, redactUrl } from '../core/redact.js';
import type { Finding, FormInfo, Viewport } from '../core/types.js';
import { installRequestGuard } from './request-guard.js';
import { checkAction, type SafetyPolicy } from './safety.js';

const BEFORE = `(sel) => {
  const form = document.querySelector(sel);
  if (!form) return null;
  const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
  return {
    text: document.body.innerText.split('\\n').map((s) => s.trim()).filter(Boolean),
    nativeBlocks: !form.noValidate && !form.checkValidity(),
    submitName: submit ? (submit.getAttribute('aria-label') || submit.innerText || submit.value || '').trim() : '',
    payment: !!form.querySelector('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i]'),
  };
}`;

const AFTER = `([sel, beforeText]) => {
  const ERROR_RE = new RegExp(${JSON.stringify(lexiconSource('formError'))}, 'iu');
  const prev = new Set(beforeText);
  const lines = document.body.innerText.split('\\n').map((s) => s.trim()).filter(Boolean);
  const fresh = lines.filter((l) => !prev.has(l) && l.length < 200);
  const liveText = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]')).map((r) => r.innerText.trim()).filter(Boolean);
  // Any new text announced in a live region is feedback; elsewhere it must read like an error message.
  const errorish = fresh.filter((l) => liveText.some((t) => t.includes(l)) || ERROR_RE.test(l));
  const form = document.querySelector(sel);
  const fields = form ? Array.from(form.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')) : [];
  const ariaInvalid = fields.filter((f) => f.getAttribute('aria-invalid') === 'true').length;
  const described = fields.filter((f) => {
    const ids = (f.getAttribute('aria-describedby') || '') + ' ' + (f.getAttribute('aria-errormessage') || '');
    return ids.trim().split(/\\s+/).some((id) => { const el = id && document.getElementById(id); return el && el.innerText.trim(); });
  }).length;
  const live = liveText.some((t) => errorish.some((e) => t.includes(e)));
  const ae = document.activeElement;
  const focusOnProblem = !!ae && ae !== document.body && (fields.includes(ae) || /error|alert/i.test((ae.getAttribute('role') || '') + ' ' + (ae.className || '') + ' ' + (ae.id || '')));
  return { errorish, freshCount: fresh.length, ariaInvalid, described, live, focusOnProblem, fieldCount: fields.length };
}`;

export interface FormProbeResult {
  url: string;
  form: string;
  purpose: string;
  outcome:
    | 'native-validation'
    | 'feedback'
    | 'no-feedback'
    | 'navigated'
    | 'blocked'
    | 'simulated'
    | 'skipped'
    | 'error';
  detail: string;
}

/** The screenshot a form probe writes, relative to the run directory. */
export function formScreenshotFile(
  url: string,
  selector: string,
  vp: Viewport,
  primaryOrigin?: string,
): string {
  const hash = shortHash(originFreeName(url, primaryOrigin), selector);
  return toPosix(`screenshots/form-${hash.slice(0, 8)}-${vp.name}.jpg`);
}

async function probeEmptySubmission(
  ctx: BrowserContext,
  url: string,
  form: FormInfo,
  vp: Viewport,
  policy: SafetyPolicy,
  runDir: string,
  wait?: { waitFor?: string; timeoutMs?: number; primaryOrigin?: string },
): Promise<{ result: FormProbeResult; findings: Finding[] }> {
  const page = await ctx.newPage();
  // Simulated by default (nothing that sends data leaves the browser); a real submission only with --allow-submit,
  // and even then never to delete or payment endpoints.
  const guard = await installRequestGuard(page, {
    ...policy,
    allowDestructive: false,
    origin: new URL(url).origin,
    mode: policy.allowSubmit ? 'journey' : 'read-only',
  });
  const base: Omit<FormProbeResult, 'outcome' | 'detail'> = {
    url: redactUrl(url),
    form: form.selector,
    purpose: form.purpose,
  };
  const findings: Finding[] = [];
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    // --wait-for: a client-rendered page has to reach the state the audit captured. If the element never shows
    // up on this fresh load, the form may not exist either, so no validation result is reported for it.
    if (wait?.waitFor) {
      const found = await waitForElement(page, wait.waitFor, wait.timeoutMs ?? 30_000);
      if (!found)
        return {
          result: {
            ...base,
            outcome: 'skipped',
            detail: `--wait-for ${JSON.stringify(wait.waitFor)} was not visible on the probe's fresh load`,
          },
          findings,
        };
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    }
    const before = (await page.evaluate(`(${BEFORE})(${JSON.stringify(form.selector)})`)) as {
      text: string[];
      nativeBlocks: boolean;
      submitName: string;
      payment: boolean;
    } | null;
    if (!before) return { result: { ...base, outcome: 'error', detail: 'form not found' }, findings };
    const verdict = checkAction(
      { action: 'click', name: before.submitName, submitsForm: true, paymentForm: before.payment },
      policy,
    );
    if (!verdict.allowed)
      return { result: { ...base, outcome: 'blocked', detail: verdict.reason }, findings };
    if (before.nativeBlocks) {
      return {
        result: {
          ...base,
          outcome: 'native-validation',
          detail: 'Browser constraint validation blocks the empty submission.',
        },
        findings,
      };
    }
    // An empty submission means empty: clear prefilled text fields first.
    await page.evaluate(
      `(() => { const f = document.querySelector(${JSON.stringify(form.selector)}); if (!f) return; for (const el of f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea')) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`,
    );
    const startUrl = page.url();
    const submit = page
      .locator(form.selector)
      .locator('button[type="submit"], button:not([type]), input[type="submit"]')
      .first();
    const submittedAt = Date.now();
    if (await submit.count()) await submit.click({ timeout: 10_000 });
    else await page.locator(form.selector).locator('input').first().press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const intercepted = guard.since(submittedAt);
    const shotFile = formScreenshotFile(url, form.selector, vp, wait?.primaryOrigin);
    await page
      .screenshot({
        path: `${runDir}/${shotFile}`,
        type: 'jpeg',
        quality: 70,
        mask: DEFAULT_MASK.map((s) => page.locator(s)),
        maskColor: '#FF00FF',
      })
      .catch(() => undefined);
    const after = (await page
      .evaluate(`(${AFTER})(${JSON.stringify([form.selector, before.text])})`)
      .catch(() => null)) as {
      errorish: string[];
      freshCount: number;
      ariaInvalid: number;
      described: number;
      live: boolean;
      focusOnProblem: boolean;
      fieldCount: number;
    } | null;
    const navigated = page.url() !== startUrl;
    const repro = [
      `Open ${redactUrl(url)} (${vp.name}).`,
      `Leave every field in \`${form.selector}\` empty.`,
      `Press "${before.submitName || 'Submit'}".`,
    ];
    const evidence = [
      { type: 'screenshot' as const, file: shotFile, note: 'After submitting the empty form' },
    ];

    if (after && !after.errorish.length && !after.ariaInvalid && intercepted.length) {
      // The page sent the empty form to the server and Jourilo stopped it: what the server would answer is unknown.
      return {
        result: {
          ...base,
          outcome: 'simulated',
          detail: `No client-side validation; the empty submission (${intercepted[0]!.method} ${intercepted[0]!.url}) was intercepted, so server-side feedback was not tested.`,
        },
        findings,
      };
    }
    if (!after || (!after.errorish.length && !after.ariaInvalid)) {
      const accepted = navigated && after !== null;
      findings.push(
        makeFinding({
          ruleId: 'ux/no-validation-feedback',
          key: form.selector,
          title: accepted
            ? 'Empty form submission is accepted without feedback'
            : 'Submitting an incomplete form gives no feedback',
          category: 'usability',
          kind: 'defect',
          severity: 'serious',
          confidence: 'medium',
          provenance: 'observed',
          url: redactUrl(url),
          viewport: vp.name,
          description: accepted
            ? `Submitting the ${form.purpose} form with all fields empty navigated to ${redactUrl(page.url())} and no error text appeared.`
            : `After submitting the ${form.purpose} form with all fields empty, no error message, aria-invalid state or native validation appeared (the page ${navigated ? 'reloaded' : 'did not change'}).`,
          impact: 'People do not learn what is missing; they retry blindly or abandon the form.',
          recommendation:
            'Validate required fields and show a specific message next to each field (and in an error summary for long forms); mark fields aria-invalid and link messages with aria-describedby.',
          standards: [wcag('3.3.1'), wcag('3.3.3'), nielsen(9)],
          evidence,
          reproduction: repro,
        }),
      );
      return {
        result: {
          ...base,
          outcome: navigated ? 'navigated' : 'no-feedback',
          detail: 'no visible error feedback',
        },
        findings,
      };
    }

    const associated = after.ariaInvalid > 0 || after.described > 0 || after.live;
    if (after.errorish.length && !associated) {
      findings.push(
        makeFinding({
          ruleId: 'a11y/errors-not-associated',
          key: form.selector,
          title: 'Error messages are visible but not exposed to assistive technology',
          category: 'accessibility',
          kind: 'defect',
          severity: 'serious',
          confidence: 'medium',
          provenance: 'observed',
          url: redactUrl(url),
          viewport: vp.name,
          description: `After an empty submission the page shows ${after.errorish.length} message(s) (e.g. "${excerpt(after.errorish[0], 80)}"), but no field has aria-invalid="true" or aria-describedby/aria-errormessage pointing to a message, and no live region announces them.`,
          impact: 'Screen-reader users are not told that the submission failed or which field to fix.',
          recommendation:
            'Set aria-invalid="true" on invalid fields, reference each message with aria-describedby, and announce the error summary in a role="alert" region or move focus to it.',
          standards: [wcag('3.3.1'), wcag('4.1.3'), wcag('1.3.1')],
          evidence: [
            ...evidence,
            {
              type: 'dom',
              snippet: after.errorish
                .slice(0, 5)
                .map((e) => excerpt(e, 120))
                .join(' | '),
            },
          ],
          reproduction: repro,
        }),
      );
    }
    if (!after.focusOnProblem && after.fieldCount > 2) {
      findings.push(
        makeFinding({
          ruleId: 'ux/error-focus',
          key: form.selector,
          title: 'Focus does not move to the first error',
          category: 'usability',
          kind: 'defect',
          severity: 'minor',
          confidence: 'medium',
          provenance: 'observed',
          url: redactUrl(url),
          viewport: vp.name,
          description:
            'After a failed submission, keyboard focus stays where it was instead of moving to the first invalid field or an error summary.',
          impact:
            'Keyboard and screen-reader users must search for the problem; on mobile the error may be off-screen.',
          recommendation:
            'Move focus to the error summary or the first invalid field after a failed submission.',
          standards: [nielsen(9)],
          evidence,
          reproduction: repro,
        }),
      );
    }
    return {
      result: {
        ...base,
        outcome: 'feedback',
        detail: `${after.errorish.length} message(s), aria-invalid on ${after.ariaInvalid}`,
      },
      findings,
    };
  } catch (err) {
    return { result: { ...base, outcome: 'error', detail: excerpt((err as Error).message, 200) }, findings };
  } finally {
    await guard.detach();
    await page.close().catch(() => undefined);
  }
}

// The form's buttons without a type, each with a selector and its opening tag as the page wrote it.
const IMPLICIT_BUTTONS = `(sel) => {
  const form = document.querySelector(sel);
  if (!form) return [];
  const path = ${SELECTOR_OF};
  return Array.from(form.querySelectorAll('button:not([type])')).map((b, index) => {
    const attrs = ['id', 'class', 'aria-label', 'name']
      .filter((a) => b.hasAttribute(a))
      .map((a) => ' ' + a + '="' + b.getAttribute(a).replace(/\\s+/g, ' ').trim().slice(0, 80).replace(/"/g, '&quot;') + '"');
    return {
      index,
      selector: path(b),
      name: (b.getAttribute('aria-label') || b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      markup: '<button' + attrs.join('') + '>',
      disabled: b.disabled,
    };
  });
}`;

// Records the form's submit events and cancels them, so a probe click never navigates; the request guard still
// stops any request the page's own handlers send.
const WATCH_SUBMIT = `(() => {
  window.__jouriloSubmits = 0;
  window.addEventListener('submit', (e) => { window.__jouriloSubmits++; e.preventDefault(); }, true);
})()`;

/**
 * jourilo/button-implicit-submit: a `<button>` with no `type` inside a form submits it, so a "Show password" or
 * "Close" button sends the form by accident. Each such button whose name is not a submit word (lexicon `submit`) is
 * clicked once with submissions cancelled and requests intercepted; the rule fires only when a `submit` event
 * really fired. Native validation is switched off for the click, because an empty required field would otherwise
 * hide the submission. A fresh page per form: the clicks may run the page's own handlers.
 */
async function probeImplicitSubmit(
  ctx: BrowserContext,
  url: string,
  form: FormInfo,
  vp: Viewport,
  policy: SafetyPolicy,
  wait?: { waitFor?: string; timeoutMs?: number },
): Promise<{ findings: Finding[]; limitation?: string }> {
  const page = await ctx.newPage();
  const guard = await installRequestGuard(page, {
    ...policy,
    allowDestructive: false,
    origin: new URL(url).origin,
    mode: policy.allowSubmit ? 'journey' : 'read-only',
  });
  const findings: Finding[] = [];
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    if (wait?.waitFor && !(await waitForElement(page, wait.waitFor, wait.timeoutMs ?? 30_000)))
      return { findings };
    const buttons = (await page
      .evaluate(`(${IMPLICIT_BUTTONS})(${JSON.stringify(form.selector)})`)
      .catch(() => [])) as {
      index: number;
      selector: string;
      name: string;
      markup: string;
      disabled: boolean;
    }[];
    const submitWord = lexicon('submit');
    const candidates = buttons.filter((b) => !b.disabled && b.name && !submitWord.test(b.name));
    if (!candidates.length) return { findings };
    await page.evaluate(WATCH_SUBMIT);
    for (const b of candidates.slice(0, 5)) {
      const payment = await page
        .evaluate(
          `(() => { const f = document.querySelector(${JSON.stringify(form.selector)}); return !!f && !!f.querySelector('input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i]'); })()`,
        )
        .catch(() => false);
      const verdict = checkAction(
        { action: 'click', name: b.name, submitsForm: true, paymentForm: payment as boolean },
        policy,
      );
      if (!verdict.allowed) continue;
      const button = page.locator(form.selector).locator('button:not([type])').nth(b.index);
      await page.evaluate(
        `(() => { window.__jouriloSubmits = 0; const f = document.querySelector(${JSON.stringify(form.selector)}); if (f) f.noValidate = true; })()`,
      );
      await button.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(150);
      const submits = (await page.evaluate('window.__jouriloSubmits').catch(() => 0)) as number;
      if (!submits) continue;
      findings.push(
        makeFinding({
          ruleId: 'jourilo/button-implicit-submit',
          key: `${form.selector} ${b.selector}`,
          title: `"${excerpt(b.name, 40)}" button submits the form because it has no type`,
          category: 'usability',
          kind: 'defect',
          severity: 'moderate',
          confidence: 'high',
          provenance: 'observed',
          url: redactUrl(url),
          viewport: vp.name,
          description: `A <button> with no type attribute inside \`${form.selector}\` fired a submit event when clicked. Its name, "${excerpt(b.name, 60)}", is not a submit word, so the form is sent by accident.`,
          impact:
            'A control that is meant to do something else (reveal a password, open a menu, close a panel) also sends the form, with whatever is typed so far.',
          recommendation:
            'Give the button type="button". A button that should send the form keeps type="submit".',
          standards: [nielsen(5)],
          evidence: [
            {
              type: 'element',
              selector: b.selector,
              snippet: excerpt(`${b.markup}${b.name}`, 240),
              data: { buttonName: b.name, form: form.selector },
            },
          ],
          reproduction: [
            `Open ${redactUrl(url)} (${vp.name}).`,
            `Click "${b.name}" in \`${form.selector}\`.`,
            'Observe that the form fires a submit event.',
          ],
        }),
      );
    }
    return { findings };
  } catch (err) {
    return {
      findings,
      limitation: `Buttons without a type in ${form.selector} on ${redactUrl(url)} were not checked for accidental submission: ${excerpt((err as Error).message, 160)}`,
    };
  } finally {
    await guard.detach();
    await page.close().catch(() => undefined);
  }
}

export async function probeFormValidation(
  ctx: BrowserContext,
  url: string,
  form: FormInfo,
  vp: Viewport,
  policy: SafetyPolicy,
  runDir: string,
  wait?: { waitFor?: string; timeoutMs?: number; primaryOrigin?: string },
): Promise<{ result: FormProbeResult; findings: Finding[]; limitation?: string }> {
  const out: { result: FormProbeResult; findings: Finding[]; limitation?: string } =
    await probeEmptySubmission(ctx, url, form, vp, policy, runDir, wait);
  // Only where the empty submission was allowed to run: the same safety policy covers the probe clicks.
  if (
    out.result.outcome !== 'blocked' &&
    out.result.outcome !== 'skipped' &&
    out.result.outcome !== 'error'
  ) {
    const implicit = await probeImplicitSubmit(ctx, url, form, vp, policy, wait);
    out.findings.push(...implicit.findings);
    if (implicit.limitation) out.limitation = implicit.limitation;
  }
  return out;
}
