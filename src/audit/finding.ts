import { shortHash } from '../core/hash.js';
import type { Finding, Severity } from '../core/types.js';
import { normalizeVolatile } from './volatile.js';

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

/** The page identity used in fingerprints and run comparison: trailing slashes are dropped from a non-root path, so `/de` and `/de/` are one page. */
export function fingerprintPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '/' : u.pathname.replace(/\/+$/, '') || '/';
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
    // Items that name their viewport (metric values, CLS shifts) are one per capture and always kept; the cap of 12
    // applies to the rest. Element items dedupe by selector, network items by snippet.
    const perViewport = (e: Finding['evidence'][number]) => typeof e.data?.viewport === 'string';
    for (const e of f.evidence) {
      if (!perViewport(e) && prev.evidence.filter((p) => !perViewport(p)).length >= 12) continue;
      const dup = prev.evidence.some(
        (p) =>
          p.type === e.type &&
          ((p.selector && p.selector === e.selector) ||
            (e.type === 'network' && p.snippet !== undefined && p.snippet === e.snippet)),
      );
      if (e.type === 'screenshot' || !dup) prev.evidence.push(e);
    }
  }
  return [...byFp.values()].sort(byImportance);
}

const byImportance = (a: Finding, b: Finding) =>
  severityRank(a.severity) - severityRank(b.severity) || a.ruleId.localeCompare(b.ruleId);

/** Page-level rules whose findings on several pages collapse into one when only volatile tokens differ (F44). */
export const COLLAPSIBLE_RULES: readonly string[] = ['jourilo/console-errors', 'jourilo/failed-requests'];

/** Every page a finding was seen on: its `pages` when it was collapsed, otherwise its one URL. */
export function pagesOf(f: Pick<Finding, 'url' | 'pages'>): string[] {
  return f.pages?.length ? f.pages : [f.url];
}

/**
 * What a finding of a collapsible rule says, independent of its page: the rule, the journey and the distinct
 * console and network snippets with volatile tokens (and the page's own URL) normalized, in sorted order. A set,
 * not a list: the same message logged at two viewports, or twice on one page, is the same evidence.
 * Undefined for other rules and for findings without such evidence.
 */
export function collapseKey(f: Finding): string | undefined {
  if (!COLLAPSIBLE_RULES.includes(f.ruleId)) return undefined;
  const items = new Set(
    f.evidence
      .filter((e) => (e.type === 'console' || e.type === 'network') && e.snippet)
      .map((e) => `${e.type}:${normalizeVolatile(e.snippet!, f.url)}`),
  );
  if (!items.size) return undefined;
  return [f.ruleId, f.journey ?? '', ...[...items].sort()].join('\n');
}

/** Two findings show the same cause on at least one shared page (used to compare runs across a collapse). */
export function sameCause(a: Finding, b: Finding): boolean {
  const k = collapseKey(a);
  if (!k || k !== collapseKey(b)) return false;
  const pages = new Set(pagesOf(a).map(fingerprintPath));
  return pagesOf(b).some((p) => pages.has(fingerprintPath(p)));
}

/**
 * Cross-page collapse (F44): findings of a collapsible rule with the same journey and the same evidence once volatile
 * tokens are normalized become one finding that lists every affected page in capture order (`pageOrder`). Its
 * fingerprint depends on the rule, the normalized evidence and the journey only, so it stays stable whichever pages
 * a run sampled. A finding seen on one page is returned unchanged, with its per-page fingerprint.
 */
export function collapseVolatileFindings(findings: Finding[], pageOrder: string[] = []): Finding[] {
  const groups = new Map<string, Finding[]>();
  const slots: (Finding | string)[] = [];
  for (const f of findings) {
    const key = collapseKey(f);
    if (!key) {
      slots.push(f);
      continue;
    }
    const g = groups.get(key);
    if (g) g.push(f);
    else {
      groups.set(key, [f]);
      slots.push(key);
    }
  }
  const rank = (url: string) => {
    const i = pageOrder.indexOf(url);
    return i < 0 ? pageOrder.length : i;
  };
  const out = slots.flatMap((s) => {
    if (typeof s !== 'string') return [s];
    const members = groups.get(s)!;
    if (new Set(members.map((m) => fingerprintPath(m.url))).size < 2) return members;
    return [
      collapse(
        [...members].sort((a, b) => rank(a.url) - rank(b.url)),
        s,
      ),
    ];
  });
  return out.sort(byImportance);
}

function collapse(members: Finding[], key: string): Finding {
  const first = members[0]!;
  const top = members.reduce(
    (best, m) => (severityRank(m.severity) < severityRank(best.severity) ? m : best),
    first,
  );
  const pages = [...new Set(members.map((m) => m.url))];
  const n = pages.length;
  const viewports = new Set(members.flatMap((m) => (m.viewport ?? '').split(', ')));
  viewports.delete('');
  const note = `The same evidence appeared on ${n} pages (volatile tokens such as nonces ignored when comparing).`;
  return {
    ...first,
    fingerprint: shortHash(first.ruleId, 'pages', key, first.journey ?? ''),
    title: top.title,
    severity: top.severity,
    description: `${top.description} Seen on ${n} pages with the same evidence (volatile tokens such as nonces ignored).`,
    ...(viewports.size ? { viewport: [...viewports].join(', ') } : {}),
    pages,
    evidence: [...first.evidence, { type: first.evidence.find((e) => e.snippet)?.type ?? 'console', note }],
    reproduction: [
      ...first.reproduction,
      `The same evidence appears on the other ${n - 1} affected page(s).`,
    ],
    occurrences: members.reduce((sum, m) => sum + m.occurrences, 0),
  };
}
