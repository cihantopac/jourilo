// Conversion intelligence. Everything here is a *hypothesis*: a plausible friction point derived from measured
// page structure, to be validated with an experiment or real analytics. Jourilo never predicts a lift.

import { makeFinding, pathOf } from '../audit/finding.js';
import { nielsen } from '../audit/standards.js';
import type { PageObservation } from '../browser/capture.js';
import type { Finding, FormInfo } from '../core/types.js';

const VAGUE = /^(submit|send|go|click here|here|ok|continue|next|learn more|read more|more|start|enter)$/i;
const GENERIC_H1 = /^(welcome|home|homepage|hello|index|untitled|main)\b/i;

export function isLandingPath(url: string): boolean {
  const p = pathOf(url).split('?')[0]!;
  return p === '/' || p === '' || /^\/(index(\.html?)?|home|[a-z]{2}(-[a-z]{2})?)\/?$/i.test(p);
}

export function isPricingPage(obs: PageObservation): boolean {
  const inv = obs.probe?.inventory;
  return /pric|plans|subscribe/i.test(pathOf(obs.url)) || (inv?.pricingSignals.length ?? 0) >= 2;
}

function hypothesis(
  obs: PageObservation,
  ruleId: string,
  title: string,
  description: string,
  recommendation: string,
  metric: string,
  evidence: Finding['evidence'],
  opts: { key?: string; confidence?: Finding['confidence']; severity?: Finding['severity'] } = {},
): Finding {
  return makeFinding({
    ruleId,
    ...(opts.key ? { key: opts.key } : {}),
    title,
    category: 'conversion',
    kind: 'hypothesis',
    severity: opts.severity ?? 'minor',
    confidence: opts.confidence ?? 'low',
    provenance: 'heuristic',
    url: obs.url,
    viewport: obs.viewport.name,
    description,
    impact: `Hypothesis, not a measured effect. Validate with: ${metric}.`,
    recommendation,
    standards: [],
    evidence,
  });
}

export function conversionFindings(obs: PageObservation): Finding[] {
  const inv = obs.probe?.inventory;
  if (!inv) return [];
  const out: Finding[] = [];
  const fold = obs.foldScreenshot ? { file: obs.foldScreenshot } : {};
  const landing = isLandingPath(obs.url);

  if (landing) {
    const primaryAbove = inv.ctas.filter((c) => c.emphasis === 'primary' && c.aboveFold);
    if (!primaryAbove.length) {
      out.push(
        hypothesis(
          obs,
          'conv/no-primary-cta-above-fold',
          `No prominent call to action in the first screen (${obs.viewport.name})`,
          `On the ${obs.viewport.name} viewport (${obs.viewport.width}×${obs.viewport.height}) no visually emphasized button or link is visible before scrolling.`,
          'Test a single, high-contrast primary action (e.g. "Start free trial") in the hero area.',
          'click-through rate from landing to the next funnel step',
          [{ type: 'screenshot', note: 'First screen', ...fold }],
          { severity: 'moderate', confidence: 'medium' },
        ),
      );
    }
    const distinct = [...new Set(primaryAbove.map((c) => c.text.toLowerCase()))];
    if (distinct.length > 3) {
      out.push(
        hypothesis(
          obs,
          'conv/competing-ctas',
          'Several competing primary actions in the first screen',
          `${distinct.length} different emphasized actions are visible before scrolling: ${distinct.slice(0, 6).join(', ')}.`,
          'Test one primary action with the others visually demoted to secondary.',
          'primary CTA click-through and downstream signup completion',
          primaryAbove.map((c) => ({
            type: 'element' as const,
            selector: c.selector,
            rect: c.rect,
            snippet: c.text,
            ...fold,
          })),
        ),
      );
    }
    const h1 = inv.h1[0];
    if (!h1 || GENERIC_H1.test(h1) || h1.split(/\s+/).length < 2) {
      out.push(
        hypothesis(
          obs,
          'conv/unclear-value-proposition',
          h1
            ? 'Main headline does not state a value proposition'
            : 'No main headline (h1) on the landing page',
          h1
            ? `The h1 is "${h1}", which does not say what the product does or for whom.`
            : 'The landing page has no visible h1, so the first message is left to images or smaller text.',
          'Test a headline that states the outcome for a specific audience, with a supporting subheadline.',
          'bounce rate and scroll depth on the landing page, plus primary CTA click-through',
          [
            { type: 'dom', snippet: h1 ? `<h1>${h1}</h1>` : 'no <h1>' },
            { type: 'screenshot', ...fold },
          ],
          { confidence: 'medium' },
        ),
      );
    }
  }

  for (const cta of inv.ctas) {
    if (cta.emphasis !== 'primary' || !VAGUE.test(cta.text.trim())) continue;
    out.push(
      hypothesis(
        obs,
        'conv/vague-cta-label',
        `Vague call-to-action label "${cta.text}"`,
        `A primary button says only "${cta.text}", which does not tell people what happens next.`,
        'Test a label that names the outcome ("Create my account", "Get the report").',
        'click-through rate on this control',
        [
          {
            type: 'element',
            selector: cta.selector,
            rect: cta.rect,
            snippet: cta.text,
            ...(obs.screenshot ? { file: obs.screenshot } : {}),
          },
        ],
        { key: cta.selector },
      ),
    );
  }

  for (const form of inv.forms) out.push(...formFriction(obs, form));

  const conversionForm = inv.forms.find((f) => f.purpose === 'signup' || f.purpose === 'checkout');
  if (conversionForm && inv.trustSignals.length === 0) {
    out.push(
      hypothesis(
        obs,
        'conv/no-trust-signals',
        `No trust signals near the ${conversionForm.purpose} form`,
        'The page asks for personal or payment data but shows no testimonials, ratings, security/privacy statements or customer proof that Jourilo could detect in the text.',
        'Test adding relevant, truthful reassurance next to the form (privacy note, security badge you actually hold, cancellation terms, real testimonials).',
        'form start → submit completion rate',
        [{ type: 'element', selector: conversionForm.selector }],
        { key: conversionForm.selector },
      ),
    );
  }

  if (
    isPricingPage(obs) &&
    inv.pricingSignals.includes('price amounts') &&
    !inv.pricingSignals.includes('billing period')
  ) {
    out.push(
      hypothesis(
        obs,
        'conv/pricing-period-unclear',
        'Prices shown without a billing period',
        'The pricing page shows amounts but no "/month", "per user" or "billed annually" wording was found.',
        'State the billing period and unit next to every price.',
        'pricing → checkout/signup click-through and support questions about price',
        [{ type: 'dom', snippet: `pricing signals: ${inv.pricingSignals.join(', ')}` }],
        { confidence: 'medium' },
      ),
    );
  }
  return out;
}

function formFriction(obs: PageObservation, form: FormInfo): Finding[] {
  const out: Finding[] = [];
  const visible = form.fields.filter((f) => !['hidden', 'submit', 'button'].includes(f.type));
  if (form.purpose === 'signup') {
    const confirm = visible.filter((f) => f.type === 'password').length >= 2;
    const phone = visible.some((f) => f.type === 'tel' && f.required);
    if (visible.length > 5 || confirm || phone) {
      const reasons = [
        visible.length > 5 ? `${visible.length} fields` : '',
        confirm ? 'a password confirmation field' : '',
        phone ? 'a required phone number' : '',
      ].filter(Boolean);
      out.push(
        hypothesis(
          obs,
          'conv/signup-friction',
          'Signup form asks for more than it needs',
          `The signup form has ${reasons.join(', ')}.`,
          'Test a shorter form (email + password, or SSO), defer optional profile questions to onboarding, and replace the confirmation field with a show-password toggle.',
          'signup form start → completion rate',
          visible.map((f) => ({
            type: 'element' as const,
            selector: f.selector,
            snippet: `${f.type} ${f.label ?? f.name ?? ''}`,
          })),
          { key: form.selector, confidence: 'medium', severity: 'moderate' },
        ),
      );
    }
  }
  if (form.purpose === 'checkout' && visible.some((f) => f.type === 'password')) {
    out.push(
      hypothesis(
        obs,
        'conv/forced-account-checkout',
        'Checkout appears to require creating an account',
        'A password field is part of the checkout form.',
        'Test guest checkout with optional account creation after purchase.',
        'checkout start → order completion rate',
        [{ type: 'element', selector: form.selector }],
        { key: form.selector, confidence: 'medium', severity: 'moderate' },
      ),
    );
  }
  const required = visible.filter((f) => f.required).length;
  if (visible.length >= 4 && required === 0 && form.purpose !== 'search') {
    out.push(
      makeFinding({
        ruleId: 'ux/required-fields-unmarked',
        key: form.selector,
        title: 'Required fields are not indicated',
        category: 'usability',
        kind: 'defect',
        severity: 'minor',
        confidence: 'low',
        provenance: 'heuristic',
        url: obs.url,
        viewport: obs.viewport.name,
        description: `None of the ${visible.length} fields in the ${form.purpose} form is marked required (required / aria-required). If some are required, people only find out after submitting.`,
        impact: 'Extra error round-trips and frustration.',
        recommendation:
          'Mark required fields with required/aria-required and a visible indicator, or mark the optional ones.',
        standards: [nielsen(5)],
        evidence: [{ type: 'element', selector: form.selector }],
      }),
    );
  }
  return out;
}
