import { describe, expect, it } from 'vitest';
import { STALE_SERVER_LIMITATION, staleServerSuspect } from '../../src/audit/stale-server.js';
import { obs } from '../helpers.js';

// Field evidence (F42, Frameva): an older next-server held the port, so every chunk of every page answered 500.
const chunk = (status: number | null, extra: { failure?: string } = {}) => ({
  url: 'http://localhost:3000/_next/static/chunks/main-app.js',
  status,
  resourceType: 'script',
  firstParty: true,
  ...extra,
});
const page = (path: string, network: ReturnType<typeof chunk>[], scripts: number) =>
  obs({
    url: `http://localhost:3000${path}`,
    finalUrl: `http://localhost:3000${path}`,
    network,
    scriptRequests: { firstParty: scripts },
  });

describe('staleServerSuspect (F42)', () => {
  it('says so when every page failed every own script with 5xx', () => {
    const pages = [page('/', [chunk(500), chunk(500)], 2), page('/about', [chunk(500)], 1)];
    expect(staleServerSuspect(pages)).toBe(STALE_SERVER_LIMITATION);
    expect(STALE_SERVER_LIMITATION).not.toMatch(/\?|https?:/);
  });

  it('counts a mix of 5xx and no answer', () => {
    const pages = [
      page('/', [chunk(500), chunk(null, { failure: 'net::ERR_CONNECTION_RESET' })], 2),
      page('/about', [chunk(null, { failure: 'net::ERR_EMPTY_RESPONSE' })], 1),
    ];
    expect(staleServerSuspect(pages)).toBe(STALE_SERVER_LIMITATION);
  });

  it('stays silent when one page loaded a script', () => {
    const pages = [page('/', [chunk(500)], 1), page('/about', [], 1)];
    expect(staleServerSuspect(pages)).toBeNull();
  });

  it('stays silent when only some of a page scripts failed', () => {
    const pages = [page('/', [chunk(500)], 3), page('/about', [chunk(500)], 1)];
    expect(staleServerSuspect(pages)).toBeNull();
  });

  it('stays silent for a single page', () => {
    expect(staleServerSuspect([page('/', [chunk(500)], 1)])).toBeNull();
    // Two viewports of one page are still one page.
    expect(staleServerSuspect([page('/', [chunk(500)], 1), page('/', [chunk(500)], 1)])).toBeNull();
  });

  it('stays silent when pages have no own scripts or only 4xx and third-party failures', () => {
    expect(staleServerSuspect([page('/', [], 0), page('/about', [], 0)])).toBeNull();
    expect(staleServerSuspect([page('/', [chunk(404)], 1), page('/about', [chunk(404)], 1)])).toBeNull();
    const third = { ...chunk(500), firstParty: false };
    expect(staleServerSuspect([page('/', [third], 1), page('/about', [third], 1)])).toBeNull();
  });

  it('stays silent when a page has no recorded script count', () => {
    const counted = page('/', [chunk(500)], 1);
    const uncounted = { ...page('/about', [chunk(500)], 1), scriptRequests: undefined };
    expect(staleServerSuspect([counted, uncounted])).toBeNull();
    expect(staleServerSuspect([uncounted, counted])).toBeNull();
  });
});
