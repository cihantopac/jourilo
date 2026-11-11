import { shortHash } from '../core/hash.js';
import type { Finding, Severity } from '../core/types.js';

export type FindingInput = Omit<Finding, 'fingerprint' | 'occurrences' | 'reproduction'> & {
  /** Distinguishes several findings of one rule on one page (e.g. the element selector). */
  key?: string;
  occurrences?: number;
  reproduction?: string[];
};

export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** The page identity inside a fingerprint: one trailing slash is dropped from a non-root path, as in 1.2.0. */
export function fingerprintPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname !== '/' && u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname;
    return `${path}${u.search}`;
  } catch {
    return url;
  }
}

export function makeFinding(input: FindingInput): Finding {
  const { key, occurrences, reproduction, ...rest } = input;
  const finding: Finding = {
    ...rest,
    // Viewport is deliberately not part of the fingerprint: the same defect seen at two widths is one finding.
    fingerprint: shortHash(input.ruleId, fingerprintPath(input.url), key ?? '', input.journey ?? ''),
    occurrences: occurrences ?? 1,
    reproduction: reproduction ?? defaultReproduction(input),
  };
  return finding;
}

function defaultReproduction(f: FindingInput): string[] {
  const steps = [`Open ${f.url}${f.viewport ? ` at the ${f.viewport} viewport` : ''}.`];
  const sel = f.evidence.find((e) => e.selector)?.selector;
  if (sel) steps.push(`Locate the element \`${sel}\` (highlighted on the screenshot).`);
  return steps;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'serious', 'moderate', 'minor', 'info'];

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

const KIND_STRENGTH: Record<Finding['kind'], number> = { 'needs-review': 0, hypothesis: 1, defect: 2 };
const CONFIDENCE_STRENGTH: Record<Finding['confidence'], number> = { low: 0, medium: 1, high: 2 };

function strength(f: Finding): number {
  return KIND_STRENGTH[f.kind] * 10 + CONFIDENCE_STRENGTH[f.confidence];
}

/**
 * Folds findings that share a fingerprint (same rule, page and target seen in several viewports) into one,
 * keeping the highest severity and the union of evidence.
 */
export function mergeFindings(findings: Finding[]): Finding[] {
  const byFp = new Map<string, Finding>();
  for (const f of findings) {
    const prev = byFp.get(f.fingerprint);
    if (!prev) {
      byFp.set(f.fingerprint, { ...f, evidence: [...f.evidence] });
      continue;
    }
    const viewports = new Set([...(prev.viewport ?? '').split(', '), ...(f.viewport ?? '').split(', ')]);
    viewports.delete('');
    prev.viewport = [...viewports].join(', ');
    if (severityRank(f.severity) < severityRank(prev.severity)) prev.severity = f.severity;
    // A stronger sighting (a located defect beats a review item) decides what the merged finding says.
    if (strength(f) > strength(prev)) {
      prev.kind = f.kind;
      prev.confidence = f.confidence;
      prev.title = f.title;
      prev.description = f.description;
      prev.recommendation = f.recommendation;
    }
    prev.occurrences = Math.max(prev.occurrences, f.occurrences);
    for (const e of f.evidence) {
      if (prev.evidence.length >= 12) break;
      if (
        e.type === 'screenshot' ||
        !prev.evidence.some((p) => p.selector && p.selector === e.selector && p.type === e.type)
      )
        prev.evidence.push(e);
    }
  }
  return [...byFp.values()].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || a.ruleId.localeCompare(b.ruleId),
  );
}
