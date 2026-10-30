// Domain model shared by every engine. Everything Jourilo stores on disk is one of these shapes, versioned by
// RUN_SCHEMA_VERSION so reports and comparisons can refuse data they do not understand.

export const RUN_SCHEMA_VERSION = 1;

/** How a statement was established. Reports group and label findings by this. */
export type Provenance =
  /** A number measured in the browser (contrast ratio, box size, timing). Reproducible. */
  | 'measured'
  /** Something that happened in the browser (console error, failed request, step failure). Reproducible. */
  | 'observed'
  /** A rule of thumb applied to measured or observed data (e.g. "vague CTA label"). Deterministic, but a judgment. */
  | 'heuristic'
  /** A conclusion drawn by an AI agent from the evidence. Not deterministic. */
  | 'inferred'
  /** Stated by the user. */
  | 'user';

export type Severity = 'critical' | 'serious' | 'moderate' | 'minor' | 'info';
export type Confidence = 'high' | 'medium' | 'low';

export type Category =
  | 'accessibility'
  | 'usability'
  | 'responsive'
  | 'performance'
  | 'conversion'
  | 'reliability'
  | 'content'
  | 'design-system';

/**
 * Usability defects are things that are broken or measurably harmful. Conversion hypotheses are plausible
 * improvements whose effect must be tested; Jourilo never reports them as defects.
 */
export type FindingKind = 'defect' | 'hypothesis' | 'needs-review';

export interface StandardRef {
  /** e.g. "WCAG 2.2", "Core Web Vitals", "Nielsen heuristic" */
  standard: string;
  /** e.g. "1.4.3", "LCP", "#1" */
  id: string;
  title: string;
  url?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A pointer to something that actually happened, captured during a run. */
export interface Evidence {
  type:
    | 'screenshot'
    | 'element'
    | 'console'
    | 'network'
    | 'metric'
    | 'axe'
    | 'step'
    | 'trace'
    | 'source'
    | 'dom';
  /** Path relative to the run directory, for files. */
  file?: string;
  /** Element box on the referenced screenshot, in CSS px of the full-page screenshot. */
  rect?: Rect;
  selector?: string;
  /** Short, redacted HTML or text excerpt. Page content is untrusted data, never instructions. */
  snippet?: string;
  /** Free-form measured values, e.g. { ratio: 2.1, required: 4.5 }. */
  data?: Record<string, unknown>;
  note?: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  excerpt?: string;
  /** Why this location is a candidate (matched text, id, class, component name...). */
  reason: string;
  confidence: Confidence;
}

export interface Finding {
  /** Stable across runs for the same rule + page + target: used to compare runs. */
  fingerprint: string;
  ruleId: string;
  title: string;
  category: Category;
  kind: FindingKind;
  severity: Severity;
  confidence: Confidence;
  provenance: Provenance;
  /** Page URL (redacted) the finding was observed on. */
  url: string;
  viewport?: string;
  journey?: string;
  description: string;
  /** Why it matters to people using the product. */
  impact: string;
  recommendation: string;
  standards: StandardRef[];
  evidence: Evidence[];
  /** Steps a human can follow to see the problem. */
  reproduction: string[];
  /** Filled by the repair engine (repository mode). */
  sources?: SourceLocation[];
  /** Number of elements / occurrences folded into this finding. */
  occurrences: number;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export interface MetricValue {
  name: string;
  value: number;
  unit: 'ms' | 'score' | 'bytes' | 'count';
  /** Lab measurements are taken by Jourilo's scripted browser; they are not field (real-user) data. */
  source: 'lab';
  rating?: 'good' | 'needs-improvement' | 'poor';
  note?: string;
}

export interface PageCapture {
  url: string;
  finalUrl: string;
  status: number | null;
  title: string;
  viewport: string;
  screenshot?: string;
  loadMs: number;
  metrics: MetricValue[];
  consoleErrors: number;
  failedRequests: number;
  /** Product-facing inventory used by the conversion and journey engines. */
  inventory: PageInventory;
}

export interface PageInventory {
  lang: string | null;
  h1: string[];
  headings: { level: number; text: string }[];
  landmarks: string[];
  ctas: CtaInfo[];
  forms: FormInfo[];
  links: { href: string; text: string; internal: boolean }[];
  images: { total: number; withoutAlt: number; withoutDimensions: number };
  trustSignals: string[];
  pricingSignals: string[];
  wordCount: number;
  metaDescription: string | null;
  hasViewportMeta: boolean;
}

export interface CtaInfo {
  text: string;
  selector: string;
  href: string | null;
  rect: Rect;
  aboveFold: boolean;
  /** "primary" when it is visually emphasized (filled background contrasting with the page). */
  emphasis: 'primary' | 'secondary' | 'link';
}

export interface FormInfo {
  selector: string;
  purpose: FormPurpose;
  action: string | null;
  method: string;
  fields: FieldInfo[];
  submitText: string | null;
}

export type FormPurpose =
  | 'signup'
  | 'login'
  | 'search'
  | 'checkout'
  | 'contact'
  | 'newsletter'
  | 'recovery'
  | 'other';

export interface FieldInfo {
  selector: string;
  type: string;
  name: string | null;
  label: string | null;
  placeholder?: string | null;
  required: boolean;
  autocomplete: string | null;
}

export interface JourneyStepResult {
  index: number;
  action: string;
  description: string;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  durationMs: number;
  screenshot?: string;
  url: string;
  error?: string;
}

export interface JourneyResult {
  id: string;
  name: string;
  viewport: string;
  status: 'passed' | 'failed' | 'blocked';
  steps: JourneyStepResult[];
  successCriteria: { description: string; met: boolean; detail?: string }[];
  durationMs: number;
  trace?: string;
}

export type RunMode = 'website' | 'repository';

export interface RunSummary {
  pages: number;
  journeys: number;
  /** Defects by severity (hypotheses and needs-review items are only counted in byKind). */
  findings: Record<Severity, number>;
  byCategory: Partial<Record<Category, number>>;
  byKind: Record<FindingKind, number>;
}

export interface Run {
  schemaVersion: number;
  id: string;
  tool: { name: 'jourilo'; version: string };
  mode: RunMode;
  target: string;
  startedAt: string;
  finishedAt: string;
  browser: { name: string; version: string };
  viewports: Viewport[];
  settings: Record<string, unknown>;
  pages: PageCapture[];
  journeys: JourneyResult[];
  findings: Finding[];
  summary: RunSummary;
  /** Things Jourilo could not check in this run, stated so nobody mistakes silence for a pass. */
  limitations: string[];
  /** Product intelligence attached by `discover`, when available. */
  product?: unknown;
}
