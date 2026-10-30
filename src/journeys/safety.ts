// Safety policy for interactive journeys. Normal audits are read-only. Journeys may type and click, but:
//  - irreversible or financial actions (pay, delete, cancel subscription …) are blocked unless the run is on a
//    local/test host AND the user passed --allow-destructive;
//  - submitting forms on public hosts is blocked unless the user passed --allow-submit (authorized test sites
//    with test accounts only).
// The policy looks at the accessible name of the element actually about to be activated, not at the journey's
// own description, so a mislabelled journey cannot bypass it.
import type { HostClass } from '../core/url-safety.js';

export const DESTRUCTIVE =
  /\b(delete|remove|destroy|erase|deactivate|close (my )?account|cancel (my )?(subscription|plan|membership|order|account)|unsubscribe|terminate|revoke|wipe|reset (all|data)|transfer|withdraw|send (money|payment))\b/i;
export const FINANCIAL =
  /\b(pay( now)?|purchase|buy( now)?|place (the )?order|complete (the )?(order|purchase|checkout|payment)|confirm (the )?(order|payment|purchase)|checkout now|submit (order|payment)|donate|upgrade now|start (paid|subscription))\b/i;

export interface SafetyPolicy {
  hostClass: HostClass;
  allowSubmit: boolean;
  allowDestructive: boolean;
}

export type SafetyVerdict = { allowed: true } | { allowed: false; reason: string };

export interface ActionContext {
  action: 'click' | 'press';
  /** Accessible name / visible text of the element being activated. */
  name: string;
  /** The element submits a form (submit button, Enter in a form field). */
  submitsForm: boolean;
  /** The form contains payment fields (card number, CVC). */
  paymentForm: boolean;
}

export function checkAction(ctx: ActionContext, policy: SafetyPolicy): SafetyVerdict {
  const safeHost = policy.hostClass === 'local';
  const risky = DESTRUCTIVE.test(ctx.name)
    ? 'destructive'
    : FINANCIAL.test(ctx.name) || ctx.paymentForm
      ? 'financial'
      : null;
  if (risky) {
    if (!safeHost)
      return {
        allowed: false,
        reason: `"${ctx.name}" looks ${risky === 'financial' ? 'like a payment/purchase' : 'irreversible'}; Jourilo never performs it on a non-local host.`,
      };
    if (!policy.allowDestructive)
      return {
        allowed: false,
        reason: `"${ctx.name}" looks ${risky === 'financial' ? 'like a payment/purchase' : 'irreversible'}; rerun with --allow-destructive on a local/test environment with sandbox data to include it.`,
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
