// Standard references used by findings. WCAG 2.2 success criteria titles and Understanding URLs come from
// https://www.w3.org/TR/WCAG22/ (W3C Recommendation, 12 December 2024 edition). See docs/research/standards.md.
import type { StandardRef } from '../core/types.js';

const WCAG22: Record<string, [title: string, level: 'A' | 'AA' | 'AAA', slug: string]> = {
  '1.1.1': ['Non-text Content', 'A', 'non-text-content'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A', 'audio-only-and-video-only-prerecorded'],
  '1.2.2': ['Captions (Prerecorded)', 'A', 'captions-prerecorded'],
  '1.2.3': [
    'Audio Description or Media Alternative (Prerecorded)',
    'A',
    'audio-description-or-media-alternative-prerecorded',
  ],
  '1.2.5': ['Audio Description (Prerecorded)', 'AA', 'audio-description-prerecorded'],
  '1.3.1': ['Info and Relationships', 'A', 'info-and-relationships'],
  '1.3.2': ['Meaningful Sequence', 'A', 'meaningful-sequence'],
  '1.3.3': ['Sensory Characteristics', 'A', 'sensory-characteristics'],
  '1.3.4': ['Orientation', 'AA', 'orientation'],
  '1.3.5': ['Identify Input Purpose', 'AA', 'identify-input-purpose'],
  '1.4.1': ['Use of Color', 'A', 'use-of-color'],
  '1.4.2': ['Audio Control', 'A', 'audio-control'],
  '1.4.3': ['Contrast (Minimum)', 'AA', 'contrast-minimum'],
  '1.4.4': ['Resize Text', 'AA', 'resize-text'],
  '1.4.5': ['Images of Text', 'AA', 'images-of-text'],
  '1.4.6': ['Contrast (Enhanced)', 'AAA', 'contrast-enhanced'],
  '1.4.10': ['Reflow', 'AA', 'reflow'],
  '1.4.11': ['Non-text Contrast', 'AA', 'non-text-contrast'],
  '1.4.12': ['Text Spacing', 'AA', 'text-spacing'],
  '1.4.13': ['Content on Hover or Focus', 'AA', 'content-on-hover-or-focus'],
  '2.1.1': ['Keyboard', 'A', 'keyboard'],
  '2.1.2': ['No Keyboard Trap', 'A', 'no-keyboard-trap'],
  '2.1.4': ['Character Key Shortcuts', 'A', 'character-key-shortcuts'],
  '2.2.1': ['Timing Adjustable', 'A', 'timing-adjustable'],
  '2.2.2': ['Pause, Stop, Hide', 'A', 'pause-stop-hide'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A', 'three-flashes-or-below-threshold'],
  '2.4.1': ['Bypass Blocks', 'A', 'bypass-blocks'],
  '2.4.2': ['Page Titled', 'A', 'page-titled'],
  '2.4.3': ['Focus Order', 'A', 'focus-order'],
  '2.4.4': ['Link Purpose (In Context)', 'A', 'link-purpose-in-context'],
  '2.4.5': ['Multiple Ways', 'AA', 'multiple-ways'],
  '2.4.6': ['Headings and Labels', 'AA', 'headings-and-labels'],
  '2.4.7': ['Focus Visible', 'AA', 'focus-visible'],
  '2.4.11': ['Focus Not Obscured (Minimum)', 'AA', 'focus-not-obscured-minimum'],
  '2.5.1': ['Pointer Gestures', 'A', 'pointer-gestures'],
  '2.5.2': ['Pointer Cancellation', 'A', 'pointer-cancellation'],
  '2.5.3': ['Label in Name', 'A', 'label-in-name'],
  '2.5.4': ['Motion Actuation', 'A', 'motion-actuation'],
  '2.5.7': ['Dragging Movements', 'AA', 'dragging-movements'],
  '2.5.8': ['Target Size (Minimum)', 'AA', 'target-size-minimum'],
  '3.1.1': ['Language of Page', 'A', 'language-of-page'],
  '3.1.2': ['Language of Parts', 'AA', 'language-of-parts'],
  '3.2.1': ['On Focus', 'A', 'on-focus'],
  '3.2.2': ['On Input', 'A', 'on-input'],
  '3.2.3': ['Consistent Navigation', 'AA', 'consistent-navigation'],
  '3.2.4': ['Consistent Identification', 'AA', 'consistent-identification'],
  '3.2.6': ['Consistent Help', 'A', 'consistent-help'],
  '3.3.1': ['Error Identification', 'A', 'error-identification'],
  '3.3.2': ['Labels or Instructions', 'A', 'labels-or-instructions'],
  '3.3.3': ['Error Suggestion', 'AA', 'error-suggestion'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA', 'error-prevention-legal-financial-data'],
  '3.3.7': ['Redundant Entry', 'A', 'redundant-entry'],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA', 'accessible-authentication-minimum'],
  '4.1.2': ['Name, Role, Value', 'A', 'name-role-value'],
  '4.1.3': ['Status Messages', 'AA', 'status-messages'],
};

export function wcag(sc: string): StandardRef {
  const entry = WCAG22[sc];
  if (!entry) return { standard: 'WCAG 2.x', id: sc, title: `Success Criterion ${sc}` };
  const [title, level, slug] = entry;
  return {
    standard: 'WCAG 2.2',
    id: sc,
    title: `${title} (Level ${level})`,
    url: `https://www.w3.org/WAI/WCAG22/Understanding/${slug}.html`,
  };
}

/** axe tags such as "wcag143" or "wcag2411" → "1.4.3", "2.4.11". */
export function wcagFromAxeTags(tags: string[]): StandardRef[] {
  const out: StandardRef[] = [];
  for (const t of tags) {
    const m = t.match(/^wcag(\d)(\d)(\d{1,2})$/);
    if (m) out.push(wcag(`${m[1]}.${m[2]}.${m[3]}`));
  }
  return out;
}

export const CWV = {
  LCP: {
    standard: 'Core Web Vitals',
    id: 'LCP',
    title: 'Largest Contentful Paint (good ≤ 2.5 s)',
    url: 'https://web.dev/articles/lcp',
  },
  CLS: {
    standard: 'Core Web Vitals',
    id: 'CLS',
    title: 'Cumulative Layout Shift (good ≤ 0.1)',
    url: 'https://web.dev/articles/cls',
  },
  INP: {
    standard: 'Core Web Vitals',
    id: 'INP',
    title: 'Interaction to Next Paint (good ≤ 200 ms)',
    url: 'https://web.dev/articles/inp',
  },
  FCP: {
    standard: 'Web Vitals',
    id: 'FCP',
    title: 'First Contentful Paint (good ≤ 1.8 s)',
    url: 'https://web.dev/articles/fcp',
  },
  TTFB: {
    standard: 'Web Vitals',
    id: 'TTFB',
    title: 'Time to First Byte (good ≤ 0.8 s)',
    url: 'https://web.dev/articles/ttfb',
  },
  TBT: {
    standard: 'Lighthouse',
    id: 'TBT',
    title: 'Total Blocking Time (lab proxy for responsiveness)',
    url: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time',
  },
} satisfies Record<string, StandardRef>;

const NN_HEURISTICS = [
  'Visibility of system status',
  'Match between system and the real world',
  'User control and freedom',
  'Consistency and standards',
  'Error prevention',
  'Recognition rather than recall',
  'Flexibility and efficiency of use',
  'Aesthetic and minimalist design',
  'Help users recognize, diagnose, and recover from errors',
  'Help and documentation',
];

export function nielsen(n: number): StandardRef {
  return {
    standard: 'Nielsen usability heuristic',
    id: `#${n}`,
    title: NN_HEURISTICS[n - 1] ?? 'Usability heuristic',
    url: 'https://www.nngroup.com/articles/ten-usability-heuristics/',
  };
}

/**
 * WCAG 2.2 A/AA questions that automated checks cannot answer, listed in every report so a clean run is never read
 * as conformance.
 */
export const MANUAL_REVIEW: string[] = [
  '1.1.1 Non-text content: is each text alternative accurate and useful (presence is checked, meaning is not)?',
  '1.2.x Time-based media: are captions, audio description and transcripts correct and complete?',
  '1.3.2 Meaningful sequence and 1.3.3 Sensory characteristics: does the reading order make sense; do instructions rely only on shape, position or colour?',
  '1.4.1 Use of colour and 1.4.11 Non-text contrast (where not measured): is colour the only cue anywhere?',
  '2.4.4 / 2.4.6 Link purpose, headings and labels: are they descriptive in context?',
  '2.5.7 Dragging movements: does every drag have a single-pointer alternative?',
  '3.1.2 Language of parts, 3.2.6 Consistent help, 3.3.7 Redundant entry, 3.3.8 Accessible authentication (beyond paste blocking).',
  '4.1.3 Status messages and the overall experience with a screen reader and with voice control.',
];
