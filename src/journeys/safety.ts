// Safety policy for interactive journeys and probes. Normal audits are read-only. Journeys may type and click, but:
//  - irreversible or financial actions (pay, delete, cancel subscription …) are blocked unless the run is on a
//    local/test host AND the user passed --allow-destructive;
//  - submitting forms on public hosts is blocked unless the user passed --allow-submit (authorized test sites
//    with test accounts only).
// Two layers enforce it, so no interaction mechanism (click, Enter, Space, a key press without a target, script)
// can bypass it:
//  1. before an element is activated, its accessible name AND its other signals (link target, form action,
//     formaction, ids, classes, data attributes, icon names) are checked — an icon-only "trash" button or a
//     "Continue" link to /account/delete counts as destructive;
//  2. every request the page then makes is checked (`checkRequest`): form posts, DELETE/PUT/PATCH, requests to
//     destructive or payment endpoints and navigations away from the target origin are aborted.
import { lexicon } from '../core/lexicon.js';
import type { HostClass } from '../core/url-safety.js';

// Multilingual (en, tr, de, es, fr) vocabulary from core/lexicon.ts, matched on Unicode word boundaries.
export const DESTRUCTIVE = lexicon('destructive');
export const FINANCIAL = lexicon('financial');

export interface SafetyPolicy {
  hostClass: HostClass;
  allowSubmit: boolean;
  allowDestructive: boolean;
}

export type SafetyVerdict = { allowed: true } | { allowed: false; reason: string; kind?: BlockKind };

/** Why a request was blocked: it left the target, was irreversible/financial, or would have sent data. */
export type BlockKind = 'off-origin' | 'destructive' | 'financial' | 'submit';

export interface ActionContext {
  action: 'click' | 'press';
  /** Accessible name / visible text of the element being activated. */
  name: string;
  /** Identifiers that reveal what the element does: id, class, name, data-*, icon names. */
  signals?: string;
  /** Where activating it goes or posts: href, form action, formaction. */
  targets?: string;
  /** The element submits a form (submit button, Enter in a form field). */
  submitsForm: boolean;
  /** The form contains payment fields (card number, CVC). */
  paymentForm: boolean;
}

/**
 * Splits identifiers and URLs into words so the lexicon can match them: "btn-deleteAccount" → "btn delete Account",
 * "/orders/42/cancel?x=1" → "orders 42 cancel x 1".
 */
export function signalWords(raw: string): string {
  return raw
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

// Words in URLs, ids and class names that mark an irreversible or payment action. Broader than the visible-text
// lexicon ("cancel" alone is a harmless dialog button, but /orders/42/cancel is not a harmless request).
const DESTRUCTIVE_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[
    'delete',
    'destroy',
    'remove',
    'erase',
    'purge',
    'wipe',
    'trash',
    'cancel',
    'unsubscribe',
    'deactivate',
    'terminate',
    'revoke',
    'close account',
    'sil',
    'silme',
    'kaldir',
    'kaldır',
    'iptal',
    'loeschen',
    'löschen',
    'entfernen',
    'kuendigen',
    'kündigen',
    'eliminar',
    'borrar',
    'cancelar',
    'dar de baja',
    'supprimer',
    'effacer',
    'resilier',
    'résilier',
    'annuler',
    'desabonner',
    'désabonner',
  ].join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);
const FINANCIAL_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[
    'pay',
    'payment',
    'payments',
    'checkout',
    'purchase',
    'charge',
    'charges',
    'order',
    'orders',
    'billing',
    'subscription',
    'transfer',
    'withdraw',
    'withdrawal',
    'donate',
    'payout',
    'odeme',
    'ödeme',
    'satin al',
    'satın al',
    'siparis',
    'sipariş',
    'zahlung',
    'bezahlen',
    'kaufen',
    'bestellung',
    'pago',
    'pagar',
    'comprar',
    'pedido',
    'paiement',
    'payer',
    'acheter',
    'commande',
  ].join('|')})(?![\\p{L}\\p{N}])`,
  'iu',
);

// In ids and class names "cancel" usually means "close this dialog", so it only counts in URLs.
const DIALOG_WORDS = /^(cancel|cancelar|annuler|iptal)$/i;

/** What an action does, judged from its visible name, its identifiers and where it goes. */
export function classifyAction(name: string, signals = '', targets = ''): 'destructive' | 'financial' | null {
  const attrWords = signalWords(signals)
    .split(' ')
    .filter((w) => !DIALOG_WORDS.test(w))
    .join(' ');
  const urlWords = signalWords(targets);
  if (
    DESTRUCTIVE.test(name) ||
    (attrWords && DESTRUCTIVE_WORDS.test(attrWords)) ||
    (urlWords && DESTRUCTIVE_WORDS.test(urlWords))
  )
    return 'destructive';
  if (FINANCIAL.test(name)) return 'financial';
  return null;
}

export function checkAction(ctx: ActionContext, policy: SafetyPolicy): SafetyVerdict {
  const safeHost = policy.hostClass === 'local';
  const label =
    ctx.name || signalWords(`${ctx.signals ?? ''} ${ctx.targets ?? ''}`).slice(0, 60) || 'this control';
  const risky = classifyAction(ctx.name, ctx.signals, ctx.targets) ?? (ctx.paymentForm ? 'financial' : null);
  if (risky) {
    if (!safeHost)
      return {
        allowed: false,
        reason: `"${label}" looks ${risky === 'financial' ? 'like a payment/purchase' : 'irreversible'}; Jourilo never performs it on a non-local host.`,
      };
    if (!policy.allowDestructive)
      return {
        allowed: false,
        reason: `"${label}" looks ${risky === 'financial' ? 'like a payment/purchase' : 'irreversible'}; rerun with --allow-destructive on a local/test environment with sandbox data to include it.`,
      };
  }
  if (ctx.submitsForm && !safeHost && !policy.allowSubmit) {
    return {
      allowed: false,
      reason:
        'Submitting a form on a non-local host is blocked; use --allow-submit only on an environment you are authorized to test, with test accounts.',
    };
  }
  return { allowed: true };
}

export interface RequestFacts {
  url: string;
  method: string;
  /** A document load in a frame (navigation, form submission). */
  isNavigation: boolean;
  /** The top-level frame (navigations of iframes may leave the origin). */
  mainFrame: boolean;
  /** Request body, if any (to tell GraphQL reads from writes). */
  body?: string | null;
}

export interface RequestPolicy extends SafetyPolicy {
  /** The audited origin. */
  origin: string;
  /** Extra origins main-frame navigations may go to (e.g. a test identity provider). */
  allowOrigins?: string[];
  /**
   * `journey`: the policy above. `read-only` (audits and form probes): nothing that changes data is sent, on any
   * host — no form posts, no PUT/PATCH/DELETE, no POST except GraphQL queries.
   */
  mode: 'journey' | 'read-only';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isGraphqlRead(body: string | null | undefined): boolean {
  if (!body) return false;
  try {
    const q = (JSON.parse(body) as { query?: unknown }).query;
    return typeof q === 'string' && /^\s*(query\b|\{)/.test(q) && !/\bmutation\b/.test(q);
  } catch {
    return false;
  }
}

/**
 * Network-level backstop for every request a page makes while Jourilo interacts with it. Whatever triggered the
 * request (a click, a key, a timer, a script), a request that would change data or leave the target is aborted
 * unless the policy allows it.
 */
export function checkRequest(r: RequestFacts, policy: RequestPolicy): SafetyVerdict {
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return { allowed: true };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { allowed: true };
  const method = r.method.toUpperCase();
  const firstParty = u.origin === policy.origin;
  const safeHost = policy.hostClass === 'local';
  if (r.isNavigation && r.mainFrame && !firstParty && !(policy.allowOrigins ?? []).includes(u.origin))
    return {
      allowed: false,
      kind: 'off-origin',
      reason: `Navigation to ${u.origin} leaves the target origin ${policy.origin}; Jourilo does not act on other sites (allow it with --allow-origin ${u.origin}).`,
    };
  const words = signalWords(`${u.pathname} ${u.search}`);
  const mutating = !SAFE_METHODS.has(method);
  const risky =
    method === 'DELETE' || (r.isNavigation && !mutating && DESTRUCTIVE_WORDS.test(words))
      ? 'destructive'
      : mutating && DESTRUCTIVE_WORDS.test(words)
        ? 'destructive'
        : mutating && FINANCIAL_WORDS.test(words)
          ? 'financial'
          : null;
  const what = `${method} ${u.pathname}`;
  if (risky && (policy.mode === 'read-only' || !safeHost || !policy.allowDestructive))
    return {
      allowed: false,
      kind: risky,
      reason: `${what} looks ${risky === 'financial' ? 'like a payment/purchase' : 'irreversible'}; ${policy.mode === 'read-only' ? 'audits never send it' : safeHost ? 'rerun with --allow-destructive on a local/test environment with sandbox data to include it' : 'Jourilo never sends it to a non-local host'}.`,
    };
  if (!mutating || isGraphqlRead(r.body)) return { allowed: true };
  if (policy.mode === 'read-only')
    return {
      allowed: false,
      kind: 'submit',
      reason: `${what} would send data; audits only observe (form probes simulate the submission instead).`,
    };
  if (!safeHost && !policy.allowSubmit && (firstParty || r.isNavigation))
    return {
      allowed: false,
      kind: 'submit',
      reason: `${what} sends data to a non-local host; use --allow-submit only on an environment you are authorized to test, with test accounts.`,
    };
  return { allowed: true };
}

/** Generated test data. Values are unique per run so repeat runs do not collide; passwords never reach logs. */
export function testData(runId: string, vars: Record<string, string> = {}): Record<string, string> {
  const tag = runId
    .replace(/[^a-z0-9]/gi, '')
    .slice(-10)
    .toLowerCase();
  const base: Record<string, string> = {
    email: `jourilo+${tag}@example.test`,
    password: `Jr-${tag}-Q7!x`,
    name: 'Jordan Test',
    firstName: 'Jordan',
    lastName: 'Test',
    phone: '+1 555 0100',
    company: 'Example Test Co',
    search: 'test',
    zip: '10001',
    // Published test card from Stripe's docs; only useful in a provider's test mode.
    testCard: '4242 4242 4242 4242',
  };
  return { ...base, ...vars };
}

export function interpolate(value: string, data: Record<string, string>): string {
  return value.replace(/\{\{\s*([A-Za-z][\w]*)\s*\}\}/g, (m, k: string) => data[k] ?? m);
}

export function isSecretValue(raw: string): boolean {
  return /\{\{\s*(password|testCard|secret|token)\s*\}\}/i.test(raw);
}
