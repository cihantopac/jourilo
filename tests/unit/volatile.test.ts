import { describe, expect, it } from 'vitest';
import { normalizeVolatile } from '../../src/audit/volatile.js';

// Field evidence (F44, frameva.io): Cloudflare's e-mail decoder blocked by the site's CSP, one nonce per page.
const csp = (nonce: string) =>
  `Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self' 'nonce-${nonce}'". Either the 'unsafe-inline' keyword, a hash ('sha256-…'), or a nonce ('nonce-...') is required to enable inline execution.`;

describe('normalizeVolatile', () => {
  it('ignores CSP nonces, quoted or bare', () => {
    expect(normalizeVolatile(csp('Q2x0eXk3a2xhbW5vcHFy'))).toBe(
      normalizeVolatile(csp('ZmRzYTEyMzQ1Njc4OTA/+=')),
    );
    expect(normalizeVolatile('nonce-abc123XYZ')).toBe(normalizeVolatile('nonce-zz99'));
  });

  it('ignores sha256/384/512 hashes', () => {
    for (const alg of ['sha256', 'sha384', 'sha512'])
      expect(normalizeVolatile(`'${alg}-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='`)).toBe(
        normalizeVolatile(`'${alg}-RFWPLDbv2BY+rCkDzsE+0fr8ylGr2R2faWMhq4lfEQc='`),
      );
  });

  it('ignores UUIDs', () => {
    expect(normalizeVolatile('request 3f1c2a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f failed')).toBe(
      normalizeVolatile('request 0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d failed'),
    );
  });

  it('ignores chunk hashes in file names', () => {
    expect(normalizeVolatile('script https://example.test/_next/static/chunks/main-3f2a9c1b.js → 404')).toBe(
      'script https://example.test/_next/static/chunks/main-*.js → 404',
    );
    expect(normalizeVolatile('app.9a8b7c6d5e.css')).toBe(normalizeVolatile('app.0f1e2d3c4b.css'));
  });

  it('ignores cache-busting query values', () => {
    const req = (v: string) =>
      `script https://example.test/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js?v=${v} → net::ERR_BLOCKED_BY_CLIENT`;
    expect(normalizeVolatile(req('1731400000123'))).toBe(normalizeVolatile(req('1731400000999')));
    expect(normalizeVolatile('/api/data?_=1731400000123&lang=en')).toBe('/api/data?_=*&lang=en');
    expect(normalizeVolatile('/app.js?t=abc')).toBe(normalizeVolatile('/app.js?t=xyz'));
    expect(normalizeVolatile('/feed?since=20261112')).toBe(normalizeVolatile('/feed?since=20261113'));
  });

  it('ignores long hex or base64-like runs and numeric timestamps', () => {
    expect(normalizeVolatile('token a1b2c3d4e5f60718293a')).toBe(
      normalizeVolatile('token ffeeddccbbaa99887766'),
    );
    expect(normalizeVolatile('session dGhpcyBpczEyMzQ1Njc4OQ ended')).toBe(
      normalizeVolatile('session YW5vdGhlcjk4NzY1NDMyMQ ended'),
    );
    expect(normalizeVolatile('at 1731400000 ms')).toBe(normalizeVolatile('at 1731409999 ms'));
  });

  it("ignores the page's own URL or path in a message", () => {
    expect(normalizeVolatile('Error at https://site.test/a', 'https://site.test/a')).toBe(
      normalizeVolatile('Error at https://site.test/b', 'https://site.test/b'),
    );
    expect(normalizeVolatile('route /pricing failed', 'https://site.test/pricing')).toBe(
      normalizeVolatile('route /about failed', 'https://site.test/about'),
    );
    // A different resource below the page is real content, not the page itself.
    expect(normalizeVolatile('script https://site.test/a/x.js → 404', 'https://site.test/a')).not.toBe(
      normalizeVolatile('script https://site.test/b/x.js → 404', 'https://site.test/b'),
    );
  });

  it('keeps status codes, short words and real content', () => {
    expect(normalizeVolatile('fetch https://example.test/api/cart → 500')).toBe(
      'fetch https://example.test/api/cart → 500',
    );
    expect(normalizeVolatile('fetch /api/cart → 500')).not.toBe(normalizeVolatile('fetch /api/cart → 503'));
    expect(normalizeVolatile('Uncaught ReferenceError: track is not defined')).toBe(
      'Uncaught ReferenceError: track is not defined',
    );
    expect(normalizeVolatile('addEventListener Content-Security-Policy unsafe-inline')).toBe(
      'addEventListener Content-Security-Policy unsafe-inline',
    );
    expect(normalizeVolatile('TypeError: a is undefined')).not.toBe(
      normalizeVolatile('TypeError: b is undefined'),
    );
    expect(normalizeVolatile('script /js/app.js → 404')).not.toBe(
      normalizeVolatile('script /js/cart.js → 404'),
    );
    expect(normalizeVolatile('Minified React error #418')).toBe('Minified React error #418');
  });
});
