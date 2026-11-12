import { agent } from './commands/agent.js';
import { accessibility, audit, conversion } from './commands/audit.js';
import { bench } from './commands/bench.js';
import { discover } from './commands/discover.js';
import { experiment } from './commands/experiment.js';
import { finding } from './commands/finding.js';
import { journeys } from './commands/journeys.js';
import { checkpoint, optimize, rollbackCmd, verify } from './commands/optimize.js';
import { rules } from './commands/rules.js';
import { compare, report, runs } from './commands/runs.js';
import { doctor, serve, setup } from './commands/system.js';
import type { Command } from './framework.js';

export const COMMANDS: Command[] = [
  discover,
  audit,
  accessibility,
  conversion,
  journeys,
  experiment,
  optimize,
  verify,
  checkpoint,
  rollbackCmd,
  finding,
  report,
  compare,
  runs,
  bench,
  agent,
  rules,
  serve,
  setup,
  doctor,
];

export const GROUPS: [string, string[]][] = [
  ['Understand', ['discover']],
  ['Audit', ['audit', 'accessibility', 'conversion']],
  ['Journeys', ['journeys']],
  ['Experiment', ['experiment']],
  ['Improve', ['optimize', 'verify', 'checkpoint', 'rollback']],
  ['Results', ['report', 'compare', 'runs', 'finding']],
  ['System', ['agent', 'bench', 'rules', 'serve', 'setup', 'doctor']],
];

export function cliMarkdown(): string {
  const out = [
    '# Jourilo CLI reference',
    '',
    '<!-- Generated from src/cli/registry.ts by scripts/build.mjs. Do not edit by hand. -->',
    '',
    'Every command prints human-readable text, or JSON with `--json`. Errors go to stderr; with `--json` they are',
    '`{"error":{"code","message","hint"}}` with a stable `code`. Exit codes: 0 ok, 1 failed gate or error, 2 usage,',
    '3 blocked by a safety rule (unsafe URL/path, robots.txt, policy), 4 browser unavailable, 5 no page could be loaded,',
    '6 stopped early by SIGINT/SIGTERM or `--max-duration` (a partial run is still written; a second signal exits 130).',
    '',
    'Global options: `--json`, `--workspace DIR` (default `.jourilo`, or `JOURILO_WORKSPACE`), `--quiet`. With `--json`,',
    'progress lines on stderr are JSON too: `{"type":"progress","message":"…","at":"<ISO time>"}`. `--workspace` is also',
    'the output directory: every run is written to `DIR/runs/<id>/` (there is no separate `--output-dir`).',
    '',
  ];
  for (const [title, names] of GROUPS) {
    out.push(`## ${title}`, '');
    for (const n of names) {
      const c = COMMANDS.find((x) => x.name === n);
      if (!c) continue;
      out.push(`### \`jourilo ${c.name}\``, '', c.summary, '', '```', c.usage, '```', '');
      if (c.details) out.push('```', c.details, '```', '');
    }
  }
  return out.join('\n');
}
