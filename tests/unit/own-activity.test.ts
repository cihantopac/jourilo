import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import {
  asJourilo,
  INPAGE_SCHEME,
  inpageSource,
  isOwnConsoleMessage,
  isOwnException,
} from '../../src/browser/own-activity.js';

// The messages below are what Chromium, Firefox and WebKit (playwright-core 1.64.1) logged on a page with
// `script-src 'nonce-…'; style-src 'self' 'nonce-…'`.
const SITE = 'https://shop.example.test/team';
const WEBKIT_STYLE =
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
const CHROMIUM_STYLE =
  "Applying inline style violates the following Content Security Policy directive 'style-src 'self' 'nonce-abc''. Either the 'unsafe-inline' keyword, a hash ('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.";
const FIREFOX_STYLE =
  "[JavaScript Error: \"Content-Security-Policy: The page’s settings blocked an inline style (style-src-elem) from being applied because it violates the following directive: “style-src 'self' 'nonce-abc'”.\"]";
const SITE_SCRIPT =
  "Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'nonce-Q2x0eXk3a2xhbW5vcHFyc3R1''. Either the 'unsafe-inline' keyword, a hash ('sha256-+dUl+qBySKaAotglSNvBr7ZSY/rilTte03PWNVOqrgw='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.";

const page = () => ({}) as Page;

describe('own activity', () => {
  it('marks evaluated sources with a Jourilo sourceURL', () => {
    expect(inpageSource('axe', 'window.axe = {};')).toBe(
      `window.axe = {};\n//# sourceURL=${INPAGE_SCHEME}axe.js`,
    );
  });

  it("drops messages logged from Jourilo's own sources, keeps the site's", () => {
    const p = page();
    expect(isOwnConsoleMessage(p, 'axe: something', `${INPAGE_SCHEME}axe.js`)).toBe(true);
    expect(isOwnConsoleMessage(p, 'site handler error', SITE)).toBe(false);
    expect(isOwnConsoleMessage(p, 'eval in the page', '')).toBe(false);
  });

  it("drops a style refusal only while Jourilo takes a screenshot; the site's refusals stay", async () => {
    const p = page();
    for (const text of [WEBKIT_STYLE, CHROMIUM_STYLE, FIREFOX_STYLE])
      expect(isOwnConsoleMessage(p, text, SITE)).toBe(false);
    const during = await asJourilo(p, async () =>
      [WEBKIT_STYLE, CHROMIUM_STYLE, FIREFOX_STYLE, SITE_SCRIPT, 'TypeError: cart is undefined'].map((t) =>
        isOwnConsoleMessage(p, t, SITE),
      ),
    );
    // A blocked script is never Jourilo's: it injects no <script> element.
    expect(during).toEqual([true, true, true, false, false]);
    expect(isOwnConsoleMessage(p, WEBKIT_STYLE, SITE)).toBe(false);
    // Other pages are not affected by a screenshot of this one.
    expect(await asJourilo(p, async () => isOwnConsoleMessage(page(), WEBKIT_STYLE, SITE))).toBe(false);
  });

  it('closes the window when the screenshot fails', async () => {
    const p = page();
    await expect(
      asJourilo(p, async () => {
        throw new Error('Timeout 2000ms exceeded');
      }),
    ).rejects.toThrow('Timeout');
    expect(isOwnConsoleMessage(p, WEBKIT_STYLE, SITE)).toBe(false);
  });

  it("drops an exception only when its innermost frame is Jourilo's", () => {
    const err = (stack: string) => Object.assign(new Error('x'), { stack });
    // Chromium and Firefox as Playwright reports them.
    expect(isOwnException(err(`Error: boom\n    at eval (${INPAGE_SCHEME}probe.js:1:109)`))).toBe(true);
    expect(
      isOwnException(
        err(
          `Error: boom\n    at  (${INPAGE_SCHEME}probe.js:1:109)\n    at setTimeout handler* (${INPAGE_SCHEME}probe.js:1:94)`,
        ),
      ),
    ).toBe(true);
    // A site handler that throws when Jourilo clicks: the site's own defect.
    expect(
      isOwnException(
        err(
          `TypeError: cart is undefined\n    at onClick (${SITE}:2:91)\n    at eval (${INPAGE_SCHEME}widgets.js:1:5)`,
        ),
      ),
    ).toBe(false);
    expect(isOwnException(err(''))).toBe(false);
  });
});
