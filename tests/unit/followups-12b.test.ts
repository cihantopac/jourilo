import { describe, expect, it } from 'vitest';
import { reliabilityFindings } from '../../src/audit/rules/experience.js';
import { WAIT_FOCUS_STABLE } from '../../src/browser/widgets.js';
import { redactUrlsIn } from '../../src/core/redact.js';
import { renderHtml } from '../../src/report/html.js';
import { obs, run } from '../helpers.js';

describe('failed-navigation URLs are redacted as URLs', () => {
  const msg =
    'navigation: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/?access_token=s3cret&code=abc';
  it('redactUrlsIn redacts every URL, keeps the rest', () => {
    const out = redactUrlsIn(`${msg}; retry https://a.test/x?sig=zzz.`);
    expect(out).not.toMatch(/s3cret|code=abc|zzz/);
    expect(out).toContain('ERR_CONNECTION_REFUSED');
    expect(out).toContain('http://127.0.0.1:1/');
  });
  it('page-unreachable text and evidence never carry the token', () => {
    const f = reliabilityFindings(obs({ errors: [msg] })).find(
      (x) => x.ruleId === 'jourilo/page-unreachable',
    )!;
    const text = JSON.stringify([f.title, f.description, f.evidence]);
    expect(text).not.toMatch(/s3cret|code=abc/);
    expect(text).toContain('ERR_CONNECTION_REFUSED');
  });
});

describe('dialog focus wait cap', () => {
  it('resolves within about 250 ms when requestAnimationFrame never fires', async () => {
    const fn = new Function('document', 'requestAnimationFrame', `return ${WAIT_FOCUS_STABLE}`);
    const t0 = Date.now();
    const result = await fn({ activeElement: null }, () => 0);
    const ms = Date.now() - t0;
    expect(result).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(200);
    expect(ms).toBeLessThan(600);
  });
});

describe('report falls back to foldScreenshot', () => {
  it('shows the fold image for a page without a full screenshot', () => {
    const base = run([]).pages[0];
    const r = run([], {
      pages: [
        {
          url: 'https://example.test/',
          finalUrl: 'https://example.test/',
          status: 200,
          title: 'Home',
          viewport: 'desktop',
          foldScreenshot: 'screenshots/home-desktop-fold.png',
          loadMs: 10,
          metrics: [],
          consoleErrors: 0,
          failedRequests: 0,
          inventory: base?.inventory as never,
        },
      ],
    });
    const html = renderHtml(r);
    expect(html).toContain('screenshots/home-desktop-fold.png');
    expect(html).not.toContain('data-i18n="pages.noShot"');
  });
});
