// The in-page probe must see Turkish capitals the way core/lexicon.ts does ("ŞİFRE" as "şifre").
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import PROBE_SOURCE from '../../src/browser/inpage/probe.js?raw';
import { lexiconSources } from '../../src/core/lexicon.js';

let browser: Awaited<ReturnType<typeof chromium.launch>>;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function inventoryOf(html: string) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html lang="tr"><body>${html}</body></html>`);
    const opts = { maxItems: 40, viewportWidth: 1280, viewportHeight: 800, lex: lexiconSources() };
    const probe = await page.evaluate(`(${PROBE_SOURCE.trim().replace(/;$/, '')})(${JSON.stringify(opts)})`);
    return (
      probe as {
        inventory: { trustSignals: string[]; pricingSignals: string[]; forms: { purpose: string }[] };
      }
    ).inventory;
  } finally {
    await page.close();
  }
}

const page = (upper: boolean) => {
  const t = (s: string) => (upper ? s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase() : s);
  return `<p>${t('güvenli ödeme')}</p><p>${t('ücretsiz deneme')}</p>
    <form action="/sifre"><input type="email" name="e" aria-label="E-posta"><button>${t('şifre sıfırla')}</button></form>`;
};

describe('in-page probe lexicon and Turkish capitals', () => {
  it('recognises the lower-case Turkish page (control)', async () => {
    const inv = await inventoryOf(page(false));
    expect(inv.trustSignals).toContain('security');
    expect(inv.pricingSignals).toContain('free trial');
    expect(inv.forms[0]?.purpose).toBe('recovery');
  }, 60_000);
  it('recognises the same page written in capitals', async () => {
    const inv = await inventoryOf(page(true));
    expect(inv.trustSignals).toContain('security');
    expect(inv.pricingSignals).toContain('free trial');
    expect(inv.forms[0]?.purpose).toBe('recovery');
  }, 60_000);
});
