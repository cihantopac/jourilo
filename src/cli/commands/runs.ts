import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { JouriloError } from '../../core/errors.js';
import { compareRuns } from '../../report/compare.js';
import { writeReports } from '../../report/index.js';
import { renderMarkdown, renderSarif } from '../../report/text.js';
import { type Command, flag, str } from '../framework.js';

export const runs: Command = {
  name: 'runs',
  summary: 'List stored runs in the workspace (.jourilo/runs).',
  usage: 'jourilo runs',
  async run(ctx) {
    const list = ctx.ws.listRuns();
    return {
      data: list,
      text: list.length
        ? list.map((r) => `${r.id}  ${String(r.findings).padStart(4)} findings  ${r.target}`).join('\n')
        : `No runs in ${ctx.ws.runsDir}.`,
    };
  },
};

export const report: Command = {
  name: 'report',
  summary: 'Re-render the report for a run (html, markdown, sarif or json) — default: latest run.',
  usage: 'jourilo report [run-id|latest|path] [--format html|md|sarif|json] [--baseline run-id]',
  options: { format: { type: 'string' }, baseline: { type: 'string' }, stdout: { type: 'boolean' } },
  async run(ctx) {
    const { run, dir } = ctx.ws.loadRun(ctx.positionals[0] ?? 'latest');
    const baseRef = str(ctx, 'baseline');
    const cmp = baseRef ? compareRuns(ctx.ws.loadRun(baseRef).run, run) : undefined;
    const format = str(ctx, 'format') ?? 'html';
    if (format === 'md' && flag(ctx, 'stdout')) {
      const md = renderMarkdown(run, cmp);
      return { data: { markdown: md }, text: md };
    }
    if (format === 'json') return { data: run, text: JSON.stringify(run, null, 2) };
    if (format === 'sarif') {
      const s = renderSarif(run);
      return { data: s, text: JSON.stringify(s, null, 2) };
    }
    if (!['html', 'md'].includes(format))
      throw new JouriloError('USAGE', '--format must be html, md, sarif or json.');
    const written = writeReports(dir, run, cmp);
    return { data: written, text: `Report: ${format === 'md' ? written.markdown : written.html}` };
  },
};

export const compare: Command = {
  name: 'compare',
  summary: 'Compare two runs (before/after): fixed, new and persisting findings plus lab metric deltas.',
  usage: 'jourilo compare <baseline-run> [head-run=latest] [--fail-on-regression]',
  options: { 'fail-on-regression': { type: 'boolean' } },
  async run(ctx) {
    const baseRef = ctx.positionals[0] ?? 'previous';
    const headRef = ctx.positionals[1] ?? 'latest';
    const base = ctx.ws.loadRun(baseRef).run;
    const { run: head, dir } = ctx.ws.loadRun(headRef);
    if (base.id === head.id) throw new JouriloError('USAGE', 'Baseline and head are the same run.');
    const cmp = compareRuns(base, head);
    const written = writeReports(dir, head, cmp);
    const failed = flag(ctx, 'fail-on-regression') && !cmp.regressionFree;
    const lines = [
      `Baseline ${base.id} → ${head.id}`,
      `  fixed ${cmp.fixed.length} · new ${cmp.introduced.length} · still present ${cmp.persisting.length} · changed ${cmp.changed.length}`,
      ...cmp.introduced.slice(0, 10).map((f) => `  NEW    ${f.severity.padEnd(9)} ${f.title} (${f.url})`),
      ...cmp.fixed.slice(0, 10).map((f) => `  FIXED  ${f.severity.padEnd(9)} ${f.title} (${f.url})`),
      cmp.regressionFree ? '  No new serious/critical defects.' : '  ⚠ New serious/critical defects.',
      `  Report: ${written.html}`,
    ];
    return {
      data: {
        base: base.id,
        head: head.id,
        fixed: cmp.fixed,
        introduced: cmp.introduced,
        persisting: cmp.persisting.map((f) => f.fingerprint),
        changed: cmp.changed.map((c) => ({
          fingerprint: c.after.fingerprint,
          before: c.before.severity,
          after: c.after.severity,
        })),
        metrics: cmp.metrics,
        regressionFree: cmp.regressionFree,
        report: written.html,
      },
      text: lines.join('\n'),
      exitCode: failed ? 1 : 0,
    };
  },
};

export function reportExists(dir: string): boolean {
  return existsSync(join(dir, 'report.html'));
}
