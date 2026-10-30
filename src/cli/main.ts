import { exitCodeFor, JouriloError } from '../core/errors.js';
import { VERSION } from '../core/version.js';
import { accessibility, audit, conversion } from './commands/audit.js';
import { bench } from './commands/bench.js';
import { journeys } from './commands/journeys.js';
import { compare, report, runs } from './commands/runs.js';
import { doctor, serve, setup } from './commands/system.js';
import { type Command, parse } from './framework.js';

export const COMMANDS: Command[] = [
  audit,
  accessibility,
  conversion,
  journeys,
  report,
  compare,
  runs,
  bench,
  serve,
  setup,
  doctor,
];

const GROUPS: [string, string[]][] = [
  ['Audit', ['audit', 'accessibility', 'conversion']],
  ['Journeys', ['journeys']],
  ['Results', ['report', 'compare', 'runs']],
  ['System', ['bench', 'serve', 'setup', 'doctor']],
];

function usage(): string {
  const lines = [
    `Jourilo ${VERSION} — product experience & conversion engineering studio`,
    '',
    'Usage: jourilo <command> [options]   (jourilo <command> --help for details)',
    '',
  ];
  for (const [title, names] of GROUPS) {
    lines.push(`${title}:`);
    for (const n of names) {
      const c = COMMANDS.find((x) => x.name === n);
      if (c) lines.push(`  ${n.padEnd(15)} ${c.summary}`);
    }
    lines.push('');
  }
  lines.push('Global options: --json (machine-readable stdout), --workspace DIR (default .jourilo), --quiet');
  return lines.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h' || name === 'help') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (name === '--version' || name === '-v' || name === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const cmd = COMMANDS.find((c) => c.name === name);
  const json = rest.includes('--json');
  try {
    if (!cmd)
      throw new JouriloError(
        'USAGE',
        `Unknown command "${name}".`,
        'Run `jourilo --help` for the list of commands.',
      );
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(
        `${cmd.summary}\n\nUsage: ${cmd.usage}\n${cmd.details ? `\n${cmd.details}\n` : ''}`,
      );
      return 0;
    }
    const ctx = parse(cmd, rest);
    const result = await cmd.run(ctx);
    process.stdout.write(
      ctx.json ? `${JSON.stringify(result.data, null, process.stdout.isTTY ? 2 : 0)}\n` : `${result.text}\n`,
    );
    return result.exitCode ?? 0;
  } catch (err) {
    const e =
      err instanceof JouriloError ? err : new JouriloError('INTERNAL', (err as Error)?.stack ?? String(err));
    if (json)
      process.stderr.write(
        `${JSON.stringify({ error: { code: e.code, message: e.message, hint: e.hint } })}\n`,
      );
    else process.stderr.write(`jourilo: ${e.message}${e.hint ? `\n  ${e.hint}` : ''}\n`);
    return exitCodeFor(e);
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
