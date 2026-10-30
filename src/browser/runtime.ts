// Loads Playwright lazily so commands that do not need a browser (report, compare, experiment, discover repo)
// work without it, and so a missing browser produces one actionable error instead of a stack trace.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Browser, BrowserType, LaunchOptions } from 'playwright-core';
import { JouriloError } from '../core/errors.js';

export type BrowserName = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'msedge';

type PlaywrightModule = typeof import('playwright-core');

let cached: PlaywrightModule | undefined;

export async function loadPlaywright(): Promise<PlaywrightModule> {
  if (cached) return cached;
  try {
    cached = (await import('playwright-core')) as PlaywrightModule;
    return cached;
  } catch {
    throw new JouriloError(
      'BROWSER_UNAVAILABLE',
      'playwright-core is not installed.',
      'Run `npm install` in the Jourilo directory (or `npx jourilo setup`).',
    );
  }
}

export async function launchBrowser(name: BrowserName = 'chromium', headed = false): Promise<Browser> {
  const pw = await loadPlaywright();
  const type: BrowserType = name === 'firefox' ? pw.firefox : name === 'webkit' ? pw.webkit : pw.chromium;
  const opts: LaunchOptions = { headless: !headed };
  if (name === 'chrome' || name === 'msedge') opts.channel = name;
  try {
    return await type.launch(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|browserType\.launch: .*not found|install/i.test(msg)) {
      throw new JouriloError(
        'BROWSER_UNAVAILABLE',
        `The ${name} browser is not installed for Playwright.`,
        name === 'chrome' || name === 'msedge'
          ? `Install ${name === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}, or use --browser chromium.`
          : `Run \`jourilo setup --browser ${name}\` (downloads the browser build Playwright needs), or use --browser chrome to drive an installed Google Chrome.`,
      );
    }
    throw new JouriloError('BROWSER_UNAVAILABLE', `Could not launch ${name}: ${msg.split('\n')[0]}`);
  }
}

/** Downloads a Playwright browser build with playwright-core's own installer. */
export function installBrowser(name: 'chromium' | 'firefox' | 'webkit'): { ok: boolean; output: string } {
  const require = createRequire(import.meta.url);
  let cli: string;
  try {
    cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js');
  } catch {
    throw new JouriloError(
      'BROWSER_UNAVAILABLE',
      'playwright-core is not installed; cannot install browsers.',
    );
  }
  const res = spawnSync(process.execPath, [cli, 'install', name], { encoding: 'utf8' });
  return { ok: res.status === 0, output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim() };
}
