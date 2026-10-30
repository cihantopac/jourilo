import { emptyInventory } from '../src/audit/engine.js';
import type { PageObservation, ProbeResult } from '../src/browser/capture.js';
import { VIEWPORTS } from '../src/browser/viewports.js';
import type { Finding, Run } from '../src/core/types.js';
import { RUN_SCHEMA_VERSION } from '../src/core/types.js';

export function probe(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    inventory: {
      ...emptyInventory(),
      hasViewportMeta: true,
      lang: 'en',
      h1: ['Ship analytics your team trusts'],
    },
    undersized: [],
    overflow: { docWidth: 390, viewportWidth: 390, offenders: [] },
    smallText: { checked: 10, samples: [] },
    clickable: [],
    scroll: { height: 1000, width: 390 },
    ...over,
  };
}

export function obs(over: Partial<PageObservation> = {}): PageObservation {
  return {
    url: 'https://example.test/',
    finalUrl: 'https://example.test/',
    status: 200,
    title: 'Example',
    viewport: VIEWPORTS.mobile!,
    loadMs: 100,
    console: [],
    network: [],
    vitals: null,
    probe: probe(),
    axe: null,
    keyboard: null,
    errors: [],
    ...over,
  };
}

export function run(findings: Finding[], over: Partial<Run> = {}): Run {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    id: '20261030-120000-abcdef',
    tool: { name: 'jourilo', version: 'test' },
    mode: 'website',
    target: 'https://example.test/',
    startedAt: '2026-10-30T12:00:00.000Z',
    finishedAt: '2026-10-30T12:01:00.000Z',
    browser: { name: 'chromium', version: 'test' },
    viewports: [VIEWPORTS.desktop!, VIEWPORTS.mobile!],
    settings: {},
    pages: [],
    journeys: [],
    findings,
    summary: {
      pages: 0,
      journeys: 0,
      findings: { critical: 0, serious: 0, moderate: 0, minor: 0, info: 0 },
      byCategory: {},
      byKind: { defect: 0, hypothesis: 0, 'needs-review': 0 },
    },
    limitations: [],
    ...over,
  };
}
