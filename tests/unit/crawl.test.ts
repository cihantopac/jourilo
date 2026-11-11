import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { crawl, explicitRobotsOverrides, robotsOverrideLimitation } from '../../src/discovery/crawl.js';

let server: Server | undefined;
afterEach(
  () =>
    new Promise<void>((r) => {
      const s = server;
      server = undefined;
      if (s) s.close(() => r());
      else r();
    }),
);

async function origin(robots: string | null): Promise<string> {
  server = createServer((req, res) => {
    if (req.url === '/robots.txt' && robots !== null) {
      res.setHeader('content-type', 'text/plain');
      res.end(robots);
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A browser context whose pages "contain" the given links, keyed by the path that was opened. */
function fakeContext(links: Record<string, string[]>): BrowserContext {
  return {
    newPage: async () => {
      let current = '';
      return {
        goto: async (u: string) => {
          current = u;
        },
        waitForLoadState: async () => undefined,
        url: () => current,
        evaluate: async () =>
          (links[new URL(current).pathname] ?? []).map((p) => new URL(p, current).toString()),
        close: async () => undefined,
      };
    },
  } as unknown as BrowserContext;
}

const opts = (over = {}) => ({
  maxPages: 10,
  maxDepth: 2,
  respectRobots: true,
  timeoutMs: 2000,
  policy: { target: 'local' as const, allowPrivate: false },
  ...over,
});

describe('crawl: trailing slashes and robots.txt', () => {
  it('keeps the trailing slash of a requested URL', async () => {
    const o = await origin(null);
    const r = await crawl(fakeContext({}), `${o}/staff/`, opts());
    expect(r.pages.map((p) => p.url)).toEqual([`${o}/staff/`]);
  });

  it('deduplicates /a and /a/, keeping the first form seen', async () => {
    const o = await origin(null);
    const r = await crawl(fakeContext({ '/': ['/a', '/a/'] }), `${o}/`, opts());
    expect(r.pages.map((p) => p.url).filter((u) => /\/a\/?$/.test(u))).toEqual([`${o}/a`]);
    const r2 = await crawl(fakeContext({ '/': ['/a/', '/a'] }), `${o}/`, opts());
    expect(r2.pages.map((p) => p.url).filter((u) => /\/a\/?$/.test(u))).toEqual([`${o}/a/`]);
  });

  it('prefers the explicitly requested form over a crawled one', async () => {
    const o = await origin(null);
    const r = await crawl(fakeContext({ '/': ['/a'] }), `${o}/`, opts({ include: ['/a/'] }));
    expect(r.pages.map((p) => p.url).filter((u) => /\/a\/?$/.test(u))).toEqual([`${o}/a/`]);
  });

  it('audits an explicitly requested URL that robots.txt disallows, and reports it', async () => {
    const o = await origin('User-agent: *\nDisallow: /staff/\n');
    const r = await crawl(fakeContext({}), `${o}/staff/`, opts());
    expect(r.pages.map((p) => p.url)).toEqual([`${o}/staff/`]);
    expect(r.robotsOverridden).toEqual([`${o}/staff/`]);
    expect(r.skipped).toEqual([]);
  });

  it('still skips a disallowed URL found by crawling', async () => {
    const o = await origin('User-agent: *\nDisallow: /staff/\n');
    const r = await crawl(fakeContext({ '/': ['/staff/', '/team'] }), `${o}/`, opts());
    expect(r.pages.map((p) => p.url)).not.toContain(`${o}/staff/`);
    expect(r.pages.map((p) => p.url)).toContain(`${o}/team`);
    expect(r.skipped).toEqual([{ url: `${o}/staff/`, reason: 'robots.txt' }]);
    expect(r.robotsOverridden).toEqual([]);
  });

  it('reports the override only for pages that were audited', async () => {
    const o = await origin('User-agent: *\nDisallow: /staff/\n');
    const r = await crawl(fakeContext({}), `${o}/`, opts({ include: ['/staff/'], maxPages: 1 }));
    expect(r.pages.map((p) => p.url)).toEqual([`${o}/`]);
    expect(r.robotsOverridden).toEqual([]);
  });
});

describe('explicit pages and robots.txt', () => {
  const policy = { target: 'local' as const, allowPrivate: false };
  it('finds explicitly requested pages that robots.txt disallows', async () => {
    const o = await origin('User-agent: *\nDisallow: /staff/\n');
    await expect(explicitRobotsOverrides([`${o}/staff/`, `${o}/team`], policy)).resolves.toEqual([
      `${o}/staff/`,
    ]);
  });
  it('finds nothing when there is no robots.txt', async () => {
    const o = await origin(null);
    await expect(explicitRobotsOverrides([`${o}/staff/`], policy)).resolves.toEqual([]);
  });
  it('words the limitation as documented', () => {
    expect(robotsOverrideLimitation('http://x.test/staff/')).toBe(
      'robots.txt disallows http://x.test/staff/; it was audited because it was requested explicitly.',
    );
  });
});
