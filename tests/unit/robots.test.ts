import { describe, expect, it } from 'vitest';
import { pageRole, rankUrl } from '../../src/discovery/crawl.js';
import { isAllowed, parseRobots } from '../../src/discovery/robots.js';

describe('robots.txt', () => {
  const txt = `
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /admin
Disallow: /*.json$
Allow: /admin/public
Sitemap: https://shop.test/sitemap.xml
`;
  it('uses the * group when no specific group matches', () => {
    const r = parseRobots(txt, 'Jourilo');
    expect(isAllowed(r, '/')).toBe(true);
    expect(isAllowed(r, '/admin/users')).toBe(false);
    expect(isAllowed(r, '/admin/public/page')).toBe(true);
    expect(isAllowed(r, '/data.json')).toBe(false);
    expect(isAllowed(r, '/data.json?x=1')).toBe(true);
    expect(r.sitemaps).toEqual(['https://shop.test/sitemap.xml']);
  });
  it('prefers a group naming Jourilo', () => {
    const r = parseRobots('User-agent: *\nDisallow:\n\nUser-agent: jourilo\nDisallow: /private', 'Jourilo');
    expect(isAllowed(r, '/private/x')).toBe(false);
    expect(isAllowed(r, '/public')).toBe(true);
  });
});

describe('page ranking', () => {
  it('ranks journey-critical pages above secondary ones', () => {
    expect(rankUrl('https://a.test/pricing', 1)).toBeGreaterThan(rankUrl('https://a.test/blog/post', 1));
    expect(rankUrl('https://a.test/', 0)).toBeGreaterThan(rankUrl('https://a.test/pricing', 1));
    expect(pageRole('https://a.test/signup')).toBe('signup');
    expect(pageRole('https://a.test/')).toBe('home');
  });
});
