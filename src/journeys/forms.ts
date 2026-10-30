// Form validation probe: submits a form with its fields left empty and measures what a person would experience.
// Does the form say what is wrong (WCAG 3.3.1)? Is the message tied to the field or announced (1.3.1, 4.1.3)?
// Does focus move to the problem? Only runs where the safety policy allows form submission.
import type { BrowserContext } from 'playwright-core';
import { makeFinding } from '../audit/finding.js';
import { nielsen, wcag } from '../audit/standards.js';
import { DEFAULT_MASK } from '../browser/capture.js';
import { toPosix } from '../core/fs-safety.js';
import { shortHash } from '../core/hash.js';
import { excerpt, redactUrl } from '../core/redact.js';
import type { Finding, FormInfo, Viewport } from '../core/types.js';
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
  const prev = new Set(beforeText);
  const lines = document.body.innerText.split('\\n').map((s) => s.trim()).filter(Boolean);
  const fresh = lines.filter((l) => !prev.has(l) && l.length < 200);
  const errorish = fresh.filter((l) => /error|required|invalid|please|must|enter|missing|can.?t be blank|is empty|too short|zorunlu|gerekli|geçersiz|erforderlich|obligatoire|requerido/i.test(l));
  const form = document.querySelector(sel);
  const fields = form ? Array.from(form.querySelectorAll('input:not([type=hidden]):not([type=submit]), select, textarea')) : [];
  const ariaInvalid = fields.filter((f) => f.getAttribute('aria-invalid') === 'true').length;
  const described = fields.filter((f) => {
    const ids = (f.getAttribute('aria-describedby') || '') + ' ' + (f.getAttribute('aria-errormessage') || '');
    return ids.trim().split(/\\s+/).some((id) => { const el = id && document.getElementById(id); return el && el.innerText.trim(); });
  }).length;
  const live = Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]'))
    .some((r) => r.innerText.trim() && errorish.some((e) => r.innerText.includes(e)));
  const ae = document.activeElement;
  const focusOnProblem = !!ae && ae !== document.body && (fields.includes(ae) || /error|alert/i.test((ae.getAttribute('role') || '') + ' ' + (ae.className || '') + ' ' + (ae.id || '')));
  return { errorish, freshCount: fresh.length, ariaInvalid, described, live, focusOnProblem, fieldCount: fields.length };
}`;

export interface FormProbeResult {
  url: string;
  form: string;
  purpose: string;
  outcome: 'native-validation' | 'feedback' | 'no-feedback' | 'navigated' | 'blocked' | 'error';
  detail: string;
}

export async function probeFormValidation(
  ctx: BrowserContext,
  url: string,
  form: FormInfo,
  vp: Viewport,
  policy: SafetyPolicy,
  runDir: string,
): Promise<{ result: FormProbeResult; findings: Finding[] }> {
  const page = await ctx.newPage();
  const base: Omit<FormProbeResult, 'outcome' | 'detail'> = {
    url: redactUrl(url),
    form: form.selector,
    purpose: form.purpose,
  };
  const findings: Finding[] = [];
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
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
    const startUrl = page.url();
    const submit = page
      .locator(form.selector)
      .locator('button[type="submit"], button:not([type]), input[type="submit"]')
      .first();
    if (await submit.count()) await submit.click({ timeout: 10_000 });
    else await page.locator(form.selector).locator('input').first().press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const shotFile = toPosix(`screenshots/form-${shortHash(url, form.selector).slice(0, 8)}-${vp.name}.jpg`);
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
    await page.close().catch(() => undefined);
  }
}
