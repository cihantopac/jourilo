import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from '../core/types.js';
import type { RunComparison } from './compare.js';
import { renderHtml } from './html.js';
import { renderMarkdown, renderSarif } from './text.js';

export interface WrittenReports {
  html: string;
  markdown: string;
  sarif?: string;
}

export function writeReports(
  dir: string,
  run: Run,
  cmp?: RunComparison,
  opts: { sarif?: boolean } = {},
): WrittenReports {
  const html = join(dir, 'report.html');
  const markdown = join(dir, 'report.md');
  writeFileSync(html, renderHtml(run, cmp));
  writeFileSync(markdown, renderMarkdown(run, cmp));
  const out: WrittenReports = { html, markdown };
  if (opts.sarif) {
    out.sarif = join(dir, 'report.sarif');
    writeFileSync(out.sarif, `${JSON.stringify(renderSarif(run), null, 2)}\n`);
  }
  return out;
}
