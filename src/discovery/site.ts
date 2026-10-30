// Product intelligence for Website Mode: what a visitor can observe from the outside. No source access is assumed.
import { pathOf } from '../audit/finding.js';
import type { PageObservation } from '../browser/capture.js';
import type { Run } from '../core/types.js';
import { pageRole } from './crawl.js';

const KNOWN_HOSTS: [
  RegExp,
  string,
  'analytics' | 'session-replay' | 'experimentation' | 'payments' | 'support' | 'tag-manager',
][] = [
  [/google-analytics\.com|analytics\.google\.com/, 'Google Analytics', 'analytics'],
  [/googletagmanager\.com/, 'Google Tag Manager', 'tag-manager'],
  [/posthog\.com/, 'PostHog', 'analytics'],
  [/amplitude\.com/, 'Amplitude', 'analytics'],
  [/segment\.(com|io)/, 'Segment', 'analytics'],
  [/mxpnl\.com|mixpanel\.com/, 'Mixpanel', 'analytics'],
  [/plausible\.io/, 'Plausible', 'analytics'],
  [/clarity\.ms/, 'Microsoft Clarity', 'session-replay'],
  [/hotjar\.(com|io)/, 'Hotjar', 'session-replay'],
  [/fullstory\.com/, 'FullStory', 'session-replay'],
  [/growthbook\.io/, 'GrowthBook', 'experimentation'],
  [/launchdarkly\.com/, 'LaunchDarkly', 'experimentation'],
  [/optimizely\.com/, 'Optimizely', 'experimentation'],
  [/visualwebsiteoptimizer\.com|vwo\.com/, 'VWO', 'experimentation'],
  [/js\.stripe\.com/, 'Stripe', 'payments'],
  [/paddle\.com/, 'Paddle', 'payments'],
  [/paypal\.com/, 'PayPal', 'payments'],
  [/intercom(cdn)?\.(com|io)/, 'Intercom', 'support'],
  [/crisp\.chat/, 'Crisp', 'support'],
  [/zdassets\.com|zendesk\.com/, 'Zendesk', 'support'],
];

export interface SiteProfile {
  schemaVersion: 1;
  kind: 'website';
  target: string;
  runId: string;
  title: string | null;
  headline: string | null;
  description: string | null;
  languages: string[];
  technologies: string[];
  services: { name: string; kind: string }[];
  pages: {
    path: string;
    role: string;
    title: string;
    h1: string | null;
    forms: string[];
    primaryCtas: string[];
    status: number | null;
  }[];
  trustSignals: string[];
  pricingSignals: string[];
  conversionPoints: { path: string; kind: string; label: string }[];
  gaps: string[];
}

export function buildSiteProfile(run: Run, observations: PageObservation[]): SiteProfile {
  const desktop = observations.filter((o) => o.viewport.name === run.viewports[0]?.name);
  const home = desktop.find((o) => pathOf(o.url).split('?')[0] === '/') ?? desktop[0];
  const tech = new Set<string>();
  const services = new Map<string, string>();
  const langs = new Set<string>();
  for (const o of desktop) {
    for (const t of o.probe?.tech ?? []) tech.add(t);
    for (const h of o.probe?.scriptHosts ?? [])
      for (const [re, name, kind] of KNOWN_HOSTS) if (re.test(h)) services.set(name, kind);
    if (o.probe?.inventory.lang) langs.add(o.probe.inventory.lang);
    for (const h of o.probe?.hreflang ?? []) if (h && h !== 'x-default') langs.add(h);
  }
  const pages = desktop.map((o) => {
    const inv = o.probe?.inventory;
    return {
      path: pathOf(o.url),
      role: pageRole(o.url),
      title: o.title,
      h1: inv?.h1[0] ?? null,
      forms: (inv?.forms ?? []).map((f) => f.purpose),
      primaryCtas: (inv?.ctas ?? [])
        .filter((c) => c.emphasis === 'primary')
        .map((c) => c.text)
        .slice(0, 5),
      status: o.status,
    };
  });
  const conversionPoints: SiteProfile['conversionPoints'] = [];
  for (const o of desktop) {
    for (const f of o.probe?.inventory.forms ?? [])
      if (['signup', 'checkout', 'newsletter', 'contact', 'login'].includes(f.purpose))
        conversionPoints.push({ path: pathOf(o.url), kind: `${f.purpose} form`, label: f.submitText ?? '' });
    const cta = o.probe?.inventory.ctas.find((c) => c.emphasis === 'primary' && c.aboveFold);
    if (cta) conversionPoints.push({ path: pathOf(o.url), kind: 'primary CTA', label: cta.text });
  }
  const gaps: string[] = [];
  if (![...services.values()].includes('analytics'))
    gaps.push('No analytics script detected on the audited pages (it may load after consent).');
  if (!pages.some((p) => p.role === 'pricing')) gaps.push('No pricing page found within the crawl budget.');
  if (!pages.some((p) => p.forms.includes('signup')))
    gaps.push(
      'No signup form found within the crawl budget (it may be behind a button or on another domain).',
    );
  gaps.push(
    'Audience, goals and business model are not observable from pages alone; confirm them with the user.',
  );
  return {
    schemaVersion: 1,
    kind: 'website',
    target: run.target,
    runId: run.id,
    title: home?.title ?? null,
    headline: home?.probe?.inventory.h1[0] ?? null,
    description: home?.probe?.inventory.metaDescription ?? null,
    languages: [...langs].sort(),
    technologies: [...tech],
    services: [...services].map(([name, kind]) => ({ name, kind })),
    pages,
    trustSignals: [...new Set(desktop.flatMap((o) => o.probe?.inventory.trustSignals ?? []))],
    pricingSignals: [...new Set(desktop.flatMap((o) => o.probe?.inventory.pricingSignals ?? []))],
    conversionPoints,
    gaps,
  };
}
