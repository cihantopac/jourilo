// Responsive layout, reliability (errors, failed requests) and lab performance rules.
import type { PageObservation } from '../../browser/capture.js';
import { toMetrics } from '../../browser/vitals.js';
import type { Finding, Severity } from '../../core/types.js';
import { makeFinding } from '../finding.js';
import { CWV, nielsen, wcag } from '../standards.js';

export function responsiveFindings(obs: PageObservation): Finding[] {
  const p = obs.probe;
  if (!p) return [];
  const out: Finding[] = [];
  const vp = obs.viewport;
  const shot = obs.screenshot ? { file: obs.screenshot } : {};

  if (p.overflow.docWidth > p.overflow.viewportWidth + 1) {
    const narrow = vp.width <= 400;
    const extra = p.overflow.docWidth - p.overflow.viewportWidth;
    out.push(
      makeFinding({
        ruleId: 'jourilo/horizontal-overflow',
        title: `Page scrolls sideways at ${vp.width} px`,
        category: 'responsive',
        kind: 'defect',
        severity: narrow ? 'serious' : 'moderate',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp.name,
        description: `The document is ${p.overflow.docWidth} px wide in a ${p.overflow.viewportWidth} px viewport (${extra} px of horizontal scrolling).${
          p.overflow.offenders.length
            ? ` Widest culprit: <${p.overflow.offenders[0]!.tag}> ending at ${p.overflow.offenders[0]!.right} px.`
            : ''
        }`,
        impact:
          'Content is cut off or requires two-dimensional scrolling; on phones the page wobbles sideways while scrolling.',
        recommendation:
          'Constrain the offending element (max-width: 100%, flex-wrap, min-width: 0 on flex children, overflow-wrap: anywhere for long strings, responsive tables in a scroll container).',
        standards: vp.width <= 320 ? [wcag('1.4.10')] : [wcag('1.4.10'), nielsen(8)],
        evidence: p.overflow.offenders.map((o) => ({
          type: 'element' as const,
          selector: o.selector,
          rect: o.rect,
          data: { right: o.right, width: o.width, viewport: p.overflow.viewportWidth },
          ...shot,
        })),
        occurrences: Math.max(1, p.overflow.offenders.length),
      }),
    );
  }

  if (vp.isMobile && !p.inventory.hasViewportMeta) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/missing-viewport-meta',
        title: 'No responsive viewport meta tag',
        category: 'responsive',
        kind: 'defect',
        severity: 'serious',
        confidence: 'high',
        provenance: 'measured',
        url: obs.url,
        viewport: vp.name,
        description:
          'The page has no <meta name="viewport">, so mobile browsers render it at desktop width and zoom out.',
        impact: 'Text is tiny and controls are hard to tap on phones.',
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the document head.',
        standards: [wcag('1.4.10')],
        evidence: [{ type: 'dom', snippet: 'document.querySelector(\'meta[name="viewport"]\') === null' }],
      }),
    );
  }

  if (vp.isMobile && p.smallText.samples.length >= 3) {
    const share = p.smallText.samples.length / Math.max(1, p.smallText.checked);
    out.push(
      makeFinding({
        ruleId: 'jourilo/small-text',
        title: 'Body text below 12 px on mobile',
        category: 'usability',
        kind: 'defect',
        severity: share > 0.25 ? 'moderate' : 'minor',
        confidence: 'medium',
        provenance: 'heuristic',
        url: obs.url,
        viewport: vp.name,
        description: `${p.smallText.samples.length} text block(s) render below 12 CSS px (smallest: ${Math.min(
          ...p.smallText.samples.map((s) => s.fontSize),
        )} px).`,
        impact:
          'Small text is hard to read on phones, especially for older users; this is a readability judgment, not a WCAG failure.',
        recommendation: 'Use at least 16 px for body text on mobile and 12 px for secondary text.',
        standards: [nielsen(8)],
        evidence: p.smallText.samples.slice(0, 8).map((s) => ({
          type: 'element' as const,
          selector: s.selector,
          rect: s.rect,
          snippet: s.sample,
          data: { fontSize: s.fontSize },
          ...shot,
        })),
        occurrences: p.smallText.samples.length,
      }),
    );
  }
  return out;
}

export function reliabilityFindings(obs: PageObservation): Finding[] {
  const out: Finding[] = [];
  const vp = obs.viewport.name;

  const navError = obs.errors.find((e) => e.startsWith('navigation:'));
  if (navError) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/page-unreachable',
        title: 'Page failed to load',
        category: 'reliability',
        kind: 'defect',
        severity: 'critical',
        confidence: 'high',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: navError,
        impact: 'Visitors cannot use this page at all.',
        recommendation: 'Check the server, DNS and redirects for this URL.',
        standards: [],
        evidence: [{ type: 'network', snippet: navError }],
      }),
    );
    return out;
  }

  if (obs.status !== null && obs.status >= 400) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/http-error-page',
        title: `Page responds with HTTP ${obs.status}`,
        category: 'reliability',
        kind: 'defect',
        severity: obs.status >= 500 ? 'critical' : 'serious',
        confidence: 'high',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: `Navigating to this URL returned HTTP ${obs.status}. It was reached through a link on the site, so visitors can hit it.`,
        impact: 'A dead end in the journey; visitors leave or lose trust.',
        recommendation: 'Fix or remove links to this URL, or redirect it to the right page.',
        standards: [nielsen(9)],
        evidence: [{ type: 'network', snippet: `GET ${obs.url} → ${obs.status}` }],
      }),
    );
  }

  const errors = obs.console.filter((c) => c.type === 'pageerror' || c.type === 'error');
  if (errors.length) {
    const uncaught = errors.filter((e) => e.type === 'pageerror').length;
    out.push(
      makeFinding({
        ruleId: 'jourilo/console-errors',
        title: uncaught ? 'Uncaught JavaScript exceptions' : 'Errors logged to the browser console',
        category: 'reliability',
        kind: 'defect',
        severity: uncaught ? 'serious' : 'moderate',
        confidence: 'high',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: `${errors.length} error(s) during page load${uncaught ? `, ${uncaught} of them uncaught exceptions` : ''}.`,
        impact:
          'Errors often mean broken features (buttons that do nothing, missing content) that are invisible in a screenshot.',
        recommendation:
          'Reproduce with the listed messages and fix the underlying exception; add error monitoring.',
        standards: [],
        evidence: errors.slice(0, 10).map((e) => ({
          type: 'console' as const,
          snippet: e.text,
          ...(e.location ? { note: e.location } : {}),
        })),
        occurrences: errors.length,
      }),
    );
  }

  const critical = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);
  const first = obs.network.filter((n) => n.firstParty);
  if (first.length) {
    const severe = first.some((n) => critical.has(n.resourceType) || (n.status ?? 0) >= 500);
    out.push(
      makeFinding({
        ruleId: 'jourilo/failed-requests',
        title: 'First-party requests failed',
        category: 'reliability',
        kind: 'defect',
        severity: severe ? 'serious' : 'moderate',
        confidence: 'high',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: `${first.length} request(s) to the site's own origin failed or returned an error status.`,
        impact: 'Missing scripts, styles, data or images break parts of the page.',
        recommendation: 'Fix the URLs or server handlers listed in the evidence.',
        standards: [],
        evidence: first.slice(0, 10).map((n) => ({
          type: 'network' as const,
          snippet: `${n.resourceType} ${n.url} → ${n.status ?? n.failure}`,
        })),
        occurrences: first.length,
      }),
    );
  }
  const third = obs.network.filter((n) => !n.firstParty);
  if (third.length) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/failed-third-party',
        title: 'Third-party requests failed',
        category: 'reliability',
        kind: 'defect',
        severity: 'minor',
        confidence: 'medium',
        provenance: 'observed',
        url: obs.url,
        viewport: vp,
        description: `${third.length} request(s) to other origins failed. Some may be blocked trackers in a headless browser.`,
        impact: 'Possible broken embeds, fonts or widgets.',
        recommendation: 'Confirm whether each dependency is still needed and reachable.',
        standards: [],
        evidence: third.slice(0, 10).map((n) => ({
          type: 'network' as const,
          snippet: `${n.resourceType} ${n.url} → ${n.status ?? n.failure}`,
        })),
        occurrences: third.length,
      }),
    );
  }
  return out;
}

const METRIC_ADVICE: Record<string, string> = {
  LCP: 'Serve the LCP element sooner: preload the hero image or font, avoid lazy-loading it, compress it, cut render-blocking CSS/JS and server time.',
  CLS: 'Reserve space for images, ads and embeds (width/height or aspect-ratio), avoid inserting content above existing content, use font-display with size-adjusted fallbacks.',
  TBT: 'Break up long main-thread tasks: code-split, defer non-critical scripts, move work off the main thread.',
  FCP: 'Reduce render-blocking resources and server response time; inline critical CSS.',
  TTFB: 'Speed up the server response: caching, CDN, fewer redirects, faster backend queries.',
};

export function performanceFindings(obs: PageObservation): Finding[] {
  if (!obs.vitals) return [];
  const out: Finding[] = [];
  const vp = obs.viewport.name;
  for (const m of toMetrics(obs.vitals)) {
    if (!m.rating || m.rating === 'good') continue;
    const std = CWV[m.name as keyof typeof CWV];
    if (!std) continue;
    const severity: Severity =
      m.rating === 'poor' ? (m.name === 'LCP' || m.name === 'CLS' ? 'serious' : 'moderate') : 'minor';
    const shown = m.unit === 'ms' ? `${(m.value / 1000).toFixed(2)} s` : String(m.value);
    const evidence: Finding['evidence'] = [
      { type: 'metric', data: { name: m.name, value: m.value, unit: m.unit, rating: m.rating } },
    ];
    if (m.name === 'LCP' && obs.vitals.lcpElement)
      evidence.push({ type: 'element', selector: obs.vitals.lcpElement, note: 'LCP element' });
    if (m.name === 'CLS')
      for (const e of obs.vitals.clsEntries.slice(0, 5))
        evidence.push({
          type: 'metric',
          data: { shift: Math.round(e.value * 1000) / 1000, at: Math.round(e.t) },
          note: e.sources.join(', '),
        });
    out.push(
      makeFinding({
        ruleId: `perf/${m.name.toLowerCase()}`,
        title: `${m.name} ${m.rating === 'poor' ? 'is poor' : 'needs improvement'} (${shown}, lab)`,
        category: 'performance',
        kind: 'defect',
        severity,
        confidence: 'medium',
        provenance: 'measured',
        url: obs.url,
        viewport: vp,
        description:
          `Measured ${m.name} = ${shown} in one lab visit (${vp} viewport). ${m.note ?? ''}`.trim(),
        impact:
          m.name === 'CLS'
            ? 'Content jumps while people read or try to tap, causing mis-clicks.'
            : 'Slow pages lose visitors before they see the offer.',
        recommendation: METRIC_ADVICE[m.name] ?? 'Investigate with a performance trace.',
        standards: [std],
        evidence,
        reproduction: [
          `Open ${obs.url} at the ${vp} viewport with a cold cache.`,
          'Record a performance trace (Chrome DevTools → Performance) and inspect the metric.',
          'Lab values vary between runs and machines; compare with field data (CrUX/RUM) before prioritizing.',
        ],
      }),
    );
  }
  const p = obs.probe;
  if (p && p.inventory.images.withoutDimensions > 0 && (obs.vitals.cls ?? 0) > 0.05) {
    out.push(
      makeFinding({
        ruleId: 'jourilo/unsized-images',
        title: 'Images without reserved space contribute to layout shift',
        category: 'performance',
        kind: 'defect',
        severity: 'minor',
        confidence: 'medium',
        provenance: 'heuristic',
        url: obs.url,
        viewport: vp,
        description: `${p.inventory.images.withoutDimensions} visible image(s) have no width/height attributes or CSS aspect-ratio, and CLS was ${obs.vitals.cls.toFixed(3)}.`,
        impact: 'Content moves when images load.',
        recommendation: 'Add width and height attributes (or aspect-ratio) to images.',
        standards: [CWV.CLS],
        evidence: [
          {
            type: 'metric',
            data: { withoutDimensions: p.inventory.images.withoutDimensions, cls: obs.vitals.cls },
          },
        ],
        occurrences: p.inventory.images.withoutDimensions,
      }),
    );
  }
  return out;
}
