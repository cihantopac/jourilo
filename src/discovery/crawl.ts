// Site discovery for Website Mode: starts at the target, reads robots.txt and sitemap.xml, follows same-origin
// links found in the rendered DOM and ranks pages by how likely they are part of a key user journey.
import type { BrowserContext } from 'playwright-core';
import { guardedFetchText } from '../core/net-guard.js';
import { redactUrl } from '../core/redact.js';
import { type AddressPolicy, crawlKey, isCrawlable, normalizeForCrawl } from '../core/url-safety.js';
import { isAllowed, parseRobots, type RobotsRules } from './robots.js';

export const USER_AGENT_TOKEN = 'Jourilo';

/** Path keywords that usually mark journey-critical pages, with a weight. */
const IMPORTANT: [RegExp, number, string][] = [
  [/pric|plans/i, 9, 'pricing'],
  [/sign-?up|register|join|get-?started|trial|onboard/i, 9, 'signup'],
  [/log-?in|sign-?in|auth/i, 7, 'login'],
  [/checkout|cart|basket|order/i, 8, 'checkout'],
  [/product|shop|store|catalog|collections?/i, 6, 'product'],
  [/features?|solutions?|how-it-works/i, 5, 'features'],
  [/search/i, 5, 'search'],
  [/contact|support|help|faq/i, 4, 'support'],
  [/dashboard|account|settings|profile/i, 4, 'app'],
  [/about|customers|case-stud/i, 2, 'about'],
  [/blog|news|press|legal|terms|privacy|cookie|careers|jobs/i, -3, 'secondary'],
];

export function pageRole(url: string): string {
  const path = new URL(url).pathname;
  if (path === '/' || path === '') return 'home';
  for (const [re, , role] of IMPORTANT) if (re.test(path)) return role;
  return 'page';
}

export function rankUrl(url: string, depth: number): number {
  const path = new URL(url).pathname;
  let score = path === '/' ? 100 : 10 - depth * 2 - path.split('/').filter(Boolean).length;
  for (const [re, w] of IMPORTANT) if (re.test(path)) score += w;
  return score;
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  respectRobots: boolean;
  timeoutMs: number;
  /** Extra URLs the user wants included. */
  include?: string[];
  /** Address policy for Node-side fetches (robots.txt, sitemaps). */
  policy: AddressPolicy;
}

export interface CrawlResult {
  pages: { url: string; depth: number; role: string; score: number }[];
  skipped: { url: string; reason: string }[];
  /** Explicitly requested URLs that robots.txt disallows; they are audited anyway. */
  robotsOverridden: string[];
  robots: RobotsRules | null;
  sitemapUrls: number;
  /** Pages the crawl could have audited (allowed by robots.txt), before `maxPages` chose among them. */
  discovered: number;
  /** Ranked pages that were not chosen (redacted), best first. */
  leftOut: string[];
  /** The sitemap's own origin when its URLs were mapped onto a local target. */
  sitemapRebasedFrom: string | null;
}

async function fetchText(url: string, timeoutMs: number, policy: AddressPolicy): Promise<string | null> {
  // Same origin only, every redirect hop checked against the address policy before connecting.
  return guardedFetchText(url, policy, {
    timeoutMs,
    userAgent: `${USER_AGENT_TOKEN} (+https://github.com/cihantopac/jourilo)`,
  }).catch(() => null);
}

export async function loadRobots(
  origin: string,
  policy: AddressPolicy,
  timeoutMs = 8000,
): Promise<RobotsRules | null> {
  const text = await fetchText(`${origin}/robots.txt`, timeoutMs, policy);
  return text === null ? null : parseRobots(text, USER_AGENT_TOKEN);
}

/** The limitation recorded when robots.txt disallows a page that was audited because it was requested explicitly. */
export function robotsOverrideLimitation(url: string): string {
  return `robots.txt disallows ${url}; it was audited because it was requested explicitly.`;
}

/** Explicitly requested pages (--url, or the lone target) that robots.txt disallows. They are audited anyway. */
export async function explicitRobotsOverrides(
  urls: string[],
  policy: AddressPolicy,
  timeoutMs = 8000,
): Promise<string[]> {
  const out: string[] = [];
  const rules = new Map<string, RobotsRules | null>();
  for (const raw of urls) {
    const u = new URL(raw);
    if (!rules.has(u.origin)) rules.set(u.origin, await loadRobots(u.origin, policy, timeoutMs));
    const r = rules.get(u.origin);
    if (r && !isAllowed(r, `${u.pathname}${u.search}`)) out.push(redactUrl(u.toString()));
  }
  return out;
}

async function sitemapUrls(
  origin: string,
  robots: RobotsRules | null,
  timeoutMs: number,
  policy: AddressPolicy,
): Promise<{ urls: string[]; rebasedFrom: string | null }> {
  // A local build usually carries its production sitemap (https://example.com/...): on a local target, its paths are
  // mapped onto the local server, because they describe the same build.
  const local = policy.target === 'local';
  const rebase = (raw: string): string | null => {
    try {
      const u = new URL(raw, origin);
      if (u.origin === origin) return u.toString();
      return local ? new URL(`${u.pathname}${u.search}`, origin).toString() : null;
    } catch {
      return null;
    }
  };
  const candidates = [...(robots?.sitemaps ?? []), `${origin}/sitemap.xml`];
  const urls: string[] = [];
  let rebasedFrom: string | null = null;
  for (const sm of candidates.slice(0, 3)) {
    const smUrl = rebase(sm);
    if (!smUrl) continue;
    const xml = await fetchText(smUrl, timeoutMs, policy);
    if (!xml) continue;
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const loc = m[1]!.replace(/&amp;/g, '&');
      const mapped = rebase(loc);
      if (!mapped) continue;
      if (mapped !== loc) rebasedFrom ??= new URL(loc).origin;
      urls.push(mapped);
      if (urls.length >= 500) break;
    }
    if (urls.length) break;
  }
  return { urls, rebasedFrom };
}

/** Breadth-first crawl in a real browser so client-rendered links are found. */
export async function crawl(ctx: BrowserContext, start: string, opts: CrawlOptions): Promise<CrawlResult> {
  const origin = new URL(start).origin;
  const robots = opts.respectRobots ? await loadRobots(origin, opts.policy) : null;
  const skipped: CrawlResult['skipped'] = [];
  const robotsOverridden: string[] = [];
  // Deduplicated on crawlKey (`/a` and `/a/` are one page); the first form seen is the one that is audited.
  const seen = new Map<string, { url: string; depth: number; blocked: boolean }>();
  const queue: { url: string; depth: number }[] = [];
  const push = (raw: string, depth: number, explicit = false) => {
    let n: string;
    let key: string;
    try {
      n = normalizeForCrawl(raw);
      key = crawlKey(raw);
    } catch {
      return;
    }
    if (seen.has(key) || !isCrawlable(n, origin)) return;
    const u = new URL(n);
    if (robots && !isAllowed(robots, `${u.pathname}${u.search}`)) {
      if (explicit) {
        // The user asked for this page by name: audit it and say so.
        robotsOverridden.push(redactUrl(n));
      } else {
        skipped.push({ url: redactUrl(n), reason: 'robots.txt' });
        seen.set(key, { url: n, depth, blocked: true });
        return;
      }
    }
    seen.set(key, { url: n, depth, blocked: false });
    queue.push({ url: n, depth });
  };
  push(start, 0, true);
  for (const extra of opts.include ?? []) push(new URL(extra, start).toString(), 0, true);
  const fromSitemap = await sitemapUrls(origin, robots, opts.timeoutMs, opts.policy);
  for (const u of fromSitemap.urls) push(u, 1);

  // Visit pages (best first) to find more links, until we have enough candidates.
  const visited = new Set<string>();
  const page = await ctx.newPage();
  try {
    while (visited.size < Math.max(opts.maxPages, 3) && visited.size < 30) {
      const next = queue
        .filter((q) => !visited.has(q.url) && q.depth < opts.maxDepth)
        .sort((a, b) => rankUrl(b.url, b.depth) - rankUrl(a.url, a.depth))[0];
      if (!next) break;
      visited.add(next.url);
      try {
        await page.goto(next.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
        const finalUrl = page.url();
        if (new URL(finalUrl).origin !== origin) {
          skipped.push({ url: redactUrl(next.url), reason: `redirects off-origin` });
          continue;
        }
        const hrefs = (await page.evaluate(
          'Array.from(document.querySelectorAll("a[href]")).map((a) => a.href).slice(0, 400)',
        )) as string[];
        for (const h of hrefs) push(h, next.depth + 1);
      } catch (err) {
        // Unreachable pages are still audited later so the failure is reported with evidence.
        skipped.push({ url: redactUrl(next.url), reason: `crawl: ${(err as Error).message.split('\n')[0]}` });
      }
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  const ranked = [...seen.values()]
    .filter((e) => !e.blocked)
    .map(({ url, depth }) => ({ url, depth, role: pageRole(url), score: rankUrl(url, depth) }))
    .sort((a, b) => b.score - a.score);
  // Diversity: prefer one page per role before taking a second page of the same role.
  const picked: typeof ranked = [];
  const roles = new Set<string>();
  for (const p of ranked) {
    if (picked.length >= opts.maxPages) break;
    if (!roles.has(p.role) || p.role === 'home') {
      picked.push(p);
      roles.add(p.role);
    }
  }
  for (const p of ranked) {
    if (picked.length >= opts.maxPages) break;
    if (!picked.includes(p)) picked.push(p);
  }
  // Only pages that were actually audited carry the note.
  const auditedOverrides = robotsOverridden.filter((u) => picked.some((p) => redactUrl(p.url) === u));
  return {
    pages: picked,
    skipped,
    robotsOverridden: auditedOverrides,
    robots,
    sitemapUrls: fromSitemap.urls.length,
    discovered: ranked.length,
    leftOut: ranked.filter((p) => !picked.includes(p)).map((p) => redactUrl(p.url)),
    sitemapRebasedFrom: fromSitemap.rebasedFrom,
  };
}
