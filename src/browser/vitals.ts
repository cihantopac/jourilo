// Lab Web Vitals collected with the browser's own PerformanceObserver APIs. The script is plain JavaScript in a
// string so bundlers cannot rewrite it before it reaches the page. These are lab numbers from one scripted
// visit; they are not field (CrUX / real-user) data and reports say so.
import type { MetricValue } from '../core/types.js';

export const VITALS_INIT_SCRIPT = `(() => {
  if (window.__jourilo) return;
  const s = window.__jourilo = { lcp: null, lcpElement: null, cls: 0, clsEntries: [], longTasks: [], inp: null, interactions: [], fcp: null };
  const po = (type, cb, extra) => {
    try { new PerformanceObserver((l) => l.getEntries().forEach(cb)).observe(Object.assign({ type, buffered: true }, extra || {})); } catch (e) {}
  };
  po('largest-contentful-paint', (e) => {
    s.lcp = e.startTime;
    const el = e.element;
    s.lcpElement = el ? (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')) : (e.url || null);
  });
  // CLS: largest session window (gap < 1s, window < 5s), shifts without recent input only.
  let win = 0, winStart = 0, winLast = 0;
  po('layout-shift', (e) => {
    if (e.hadRecentInput) return;
    if (win && e.startTime - winLast < 1000 && e.startTime - winStart < 5000) { win += e.value; } else { win = e.value; winStart = e.startTime; }
    winLast = e.startTime;
    if (win > s.cls) s.cls = win;
    if (s.clsEntries.length < 20) {
      const src = (e.sources || []).map((x) => x.node && x.node.nodeType === 1 ? x.node.tagName.toLowerCase() + (x.node.id ? '#' + x.node.id : '') : null).filter(Boolean);
      s.clsEntries.push({ value: e.value, t: e.startTime, sources: src });
    }
  });
  po('paint', (e) => { if (e.name === 'first-contentful-paint') s.fcp = e.startTime; });
  po('longtask', (e) => { s.longTasks.push({ start: e.startTime, duration: e.duration }); });
  // INP approximation for scripted interactions: worst event duration per interactionId.
  po('event', (e) => {
    if (!e.interactionId) return;
    const prev = s.interactions.find((i) => i.id === e.interactionId);
    if (prev) { prev.duration = Math.max(prev.duration, e.duration); } else { s.interactions.push({ id: e.interactionId, name: e.name, duration: e.duration }); }
    s.inp = Math.max(s.inp || 0, e.duration);
  }, { durationThreshold: 16 });
})();`;

export interface RawVitals {
  lcp: number | null;
  lcpElement: string | null;
  /** null when the browser cannot measure it (no Layout Shift API). */
  cls: number | null;
  /** Performance entry types this browser does not support (metrics that depend on them are null). */
  unsupported?: string[];
  clsEntries: { value: number; t: number; sources: string[] }[];
  fcp: number | null;
  ttfb: number | null;
  tbt: number | null;
  inp: number | null;
  interactions: number;
  domContentLoaded: number | null;
  load: number | null;
  transferBytes: number;
  requests: number;
  domNodes: number;
}

/** Evaluated in the page after load; returns plain data. */
export const READ_VITALS_SCRIPT = `(() => {
  const s = window.__jourilo || {};
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const fcp = s.fcp;
  // Only report what this browser can measure: Firefox and WebKit lack layout-shift, longtask and some event
  // timing entries, and a default of 0 would look like a perfect score.
  const types = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
  const has = (t) => types.includes(t);
  let tbt = null;
  if (fcp != null && has('longtask')) {
    tbt = 0;
    for (const t of s.longTasks || []) {
      if (t.start + t.duration <= fcp) continue;
      tbt += Math.max(0, t.duration - 50);
    }
  }
  let bytes = nav ? (nav.transferSize || 0) : 0;
  for (const r of res) bytes += r.transferSize || 0;
  return {
    lcp: has('largest-contentful-paint') ? (s.lcp ?? null) : null, lcpElement: s.lcpElement ?? null,
    cls: has('layout-shift') ? (s.cls || 0) : null, clsEntries: s.clsEntries || [],
    fcp: fcp ?? null, ttfb: nav ? nav.responseStart : null, tbt,
    inp: has('event') ? (s.inp ?? null) : null, interactions: (s.interactions || []).length,
    unsupported: ['largest-contentful-paint', 'layout-shift', 'longtask', 'event'].filter((t) => !has(t)),
    domContentLoaded: nav ? nav.domContentLoadedEventEnd : null, load: nav ? nav.loadEventEnd : null,
    transferBytes: bytes, requests: res.length + 1, domNodes: document.getElementsByTagName('*').length,
  };
})()`;

type Thresholds = [good: number, poor: number];

// Sources: web.dev/articles/vitals (LCP, CLS, INP), web.dev/articles/fcp, web.dev/articles/ttfb,
// developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time (TBT). See docs/research/standards.md.
export const THRESHOLDS: Record<string, Thresholds> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  TBT: [200, 600],
};

export function rate(name: string, value: number): MetricValue['rating'] {
  const t = THRESHOLDS[name];
  if (!t) return undefined;
  return value <= t[0] ? 'good' : value <= t[1] ? 'needs-improvement' : 'poor';
}

export function toMetrics(v: RawVitals, spread?: Record<string, [number, number]>, runs = 1): MetricValue[] {
  const out: MetricValue[] = [];
  const KEY: Record<string, string> = {
    LCP: 'lcp',
    CLS: 'cls',
    FCP: 'fcp',
    TTFB: 'ttfb',
    TBT: 'tbt',
    Load: 'load',
    Transfer: 'transferBytes',
  };
  const add = (name: string, value: number | null, unit: MetricValue['unit'], note?: string) => {
    if (value == null || Number.isNaN(value)) return;
    const range = spread?.[KEY[name] ?? ''];
    if (runs > 1 && range) {
      const fmt = (x: number) => (unit === 'score' ? x.toFixed(3) : String(Math.round(x)));
      note = `${note ? `${note} ` : ''}Median of ${runs} runs (range ${fmt(range[0])}–${fmt(range[1])}).`;
    }
    const rounded = unit === 'score' ? Math.round(value * 1000) / 1000 : Math.round(value);
    const m: MetricValue = { name, value: rounded, unit, source: 'lab' };
    if (runs > 1 && range) {
      const r2 = (x: number) => (unit === 'score' ? Math.round(x * 1000) / 1000 : Math.round(x));
      m.runs = runs;
      m.range = [r2(range[0]), r2(range[1])];
    }
    const r = rate(name, rounded);
    if (r) m.rating = r;
    if (note) m.note = note;
    out.push(m);
  };
  add('LCP', v.lcp, 'ms', v.lcpElement ? `LCP element: ${v.lcpElement}` : undefined);
  add('CLS', v.cls, 'score');
  add('FCP', v.fcp, 'ms');
  add('TTFB', v.ttfb, 'ms');
  add('TBT', v.tbt, 'ms', 'Lab proxy for interactivity; INP needs real interactions.');
  if (v.interactions > 0)
    add('INP', v.inp, 'ms', `From ${v.interactions} scripted interaction(s); not field data.`);
  add('Load', v.load, 'ms');
  add('Transfer', v.transferBytes, 'bytes');
  add('Requests', v.requests, 'count');
  add('DOM nodes', v.domNodes, 'count');
  return out;
}
