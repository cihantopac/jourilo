import { createRequire } from 'node:module';
import { installBrowser, launchBrowser } from '../../browser/runtime.js';
import { JouriloError } from '../../core/errors.js';
import { serveStatic } from '../../core/static-server.js';
import { VERSION } from '../../core/version.js';
import { type Command, requirePositional, str } from '../framework.js';

export const setup: Command = {
  name: 'setup',
  summary: 'Download the Playwright browser build Jourilo drives (Chromium by default, ~150 MB, one time).',
  usage: 'jourilo setup [--browser chromium|firefox|webkit]',
  options: { browser: { type: 'string' } },
  async run(ctx) {
    const name = (str(ctx, 'browser') ?? 'chromium') as 'chromium' | 'firefox' | 'webkit';
    if (!['chromium', 'firefox', 'webkit'].includes(name))
      throw new JouriloError('USAGE', '--browser must be chromium, firefox or webkit.');
    ctx.log(`Installing ${name} for Playwright …`);
    const res = installBrowser(name);
    if (!res.ok)
      throw new JouriloError('BROWSER_UNAVAILABLE', `Browser install failed:\n${res.output.slice(-2000)}`);
    return { data: { installed: name }, text: `${name} is installed.` };
  },
};

export const doctor: Command = {
  name: 'doctor',
  summary: 'Check the toolchain: Node.js, playwright-core, browsers, axe-core.',
  usage: 'jourilo doctor',
  async run() {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const [major, minor] = process.versions.node.split('.').map(Number) as [number, number];
    checks.push({
      name: 'node',
      ok: major > 20 || (major === 20 && minor >= 10),
      detail: process.versions.node,
    });
    let pwVersion = '';
    try {
      const req = createRequire(import.meta.url);
      pwVersion = (req('playwright-core/package.json') as { version: string }).version;
      checks.push({ name: 'playwright-core', ok: true, detail: pwVersion });
    } catch {
      checks.push({ name: 'playwright-core', ok: false, detail: 'not installed — run npm install' });
    }
    if (pwVersion) {
      for (const b of ['chromium', 'firefox', 'webkit'] as const) {
        try {
          const br = await launchBrowser(b);
          checks.push({ name: b, ok: true, detail: br.version() });
          await br.close();
        } catch (err) {
          checks.push({
            name: b,
            ok: b !== 'chromium',
            detail: `${b === 'chromium' ? '' : 'optional — '}${(err as JouriloError).hint ?? (err as Error).message}`,
          });
        }
      }
    }
    const axe = await import('axe-core');
    checks.push({ name: 'axe-core', ok: true, detail: (axe.default as { version: string }).version });
    const ok = checks.every((c) => c.ok);
    return {
      data: { version: VERSION, ok, checks },
      text: [
        `Jourilo ${VERSION}`,
        ...checks.map((c) => `  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(16)} ${c.detail}`),
      ].join('\n'),
      exitCode: ok ? 0 : 1,
    };
  },
};

export const serve: Command = {
  name: 'serve',
  summary: 'Serve a static build directory on 127.0.0.1 (for audits and journeys of static sites).',
  usage: 'jourilo serve <dir> [--port 4173]',
  options: { port: { type: 'string' } },
  async run(ctx) {
    const dir = requirePositional(ctx, 0, 'dir', serve.usage);
    const server = await serveStatic(dir, Number(str(ctx, 'port') ?? 4173));
    process.stderr.write(`Serving ${dir} at ${server.url} (Ctrl+C to stop)\n`);
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()));
    await server.close();
    return { data: { url: server.url }, text: 'Stopped.' };
  },
};
