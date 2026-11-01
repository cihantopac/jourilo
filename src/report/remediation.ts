// How a finding can be acted on. Kept apart from "can a file be edited": an agent can edit anything, but a judgment
// call needs a person, and a conversion hypothesis needs an experiment, not a code change.
import type { Finding } from '../core/types.js';
import { FIXERS } from '../repair/fixes.js';

/**
 * - `auto` — a Jourilo fixer previews a minimal, reversible patch (`jourilo optimize`), applied only on approval.
 * - `agent` — no fixer, but the evidence and source candidates are enough for a coding agent to make a targeted change.
 * - `manual` — automated checks could not decide; a person has to judge before anything changes.
 * - `experiment` — a conversion hypothesis: plan an experiment or investigate; never shipped as a "fix".
 */
export type FixPath = 'auto' | 'agent' | 'manual' | 'experiment';

export const FIX_PATHS: FixPath[] = ['auto', 'agent', 'manual', 'experiment'];

export function fixPathOf(f: Finding): FixPath {
  if (f.kind === 'hypothesis') return 'experiment';
  if (f.kind === 'needs-review') return 'manual';
  if (f.ruleId in FIXERS) return 'auto';
  return 'agent';
}

/**
 * Root-cause key: the same rule traced to the same source line is one fix, however many pages show it. Without a
 * confident source location, the same rule on the same element (a shared header, footer or component) is one cause.
 */
export function rootCauseKey(f: Finding): string {
  const src = f.sources?.[0];
  if (src && src.confidence !== 'low') return `${f.ruleId}|src|${src.file}:${src.line}`;
  const sel = f.evidence.find((e) => e.selector)?.selector;
  // A bare tag name ("img", "a") says nothing about the element being shared; only specific selectors group.
  if (sel && !f.journey && /[#.[>:]/.test(sel)) return `${f.ruleId}|sel|${sel}`;
  return `${f.ruleId}|fp|${f.fingerprint}`;
}
