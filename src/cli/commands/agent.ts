import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS, mergeSection } from '../../agents/adapters.js';
import { JouriloError } from '../../core/errors.js';
import { type Command, flag, str } from '../framework.js';

/** How other agents should invoke this CLI: the installed bin if on PATH-like install, else this file. */
function defaultCommand(): string {
  const self = fileURLToPath(import.meta.url);
  return /[\\/]node_modules[\\/]/.test(self) ? 'npx jourilo' : `node "${self}"`;
}

export const agent: Command = {
  name: 'agent',
  summary:
    'Install Jourilo instructions for other agents: bare /jourilo Claude skill, Codex (AGENTS.md), Cursor rule.',
  usage:
    'jourilo agent <list|install <claude-skill|codex|cursor>> [--project .] [--command "npx jourilo"] [--write]',
  options: { project: { type: 'string' }, command: { type: 'string' }, write: { type: 'boolean' } },
  details: 'Without --write the file content and destination are printed and nothing is written.',
  async run(ctx) {
    const sub = ctx.positionals[0] ?? 'list';
    if (sub === 'list') {
      return {
        data: ADAPTERS.map((a) => ({
          id: a.id,
          name: a.name,
          scope: a.scope,
          path: a.path(resolve(str(ctx, 'project') ?? '.')),
        })),
        text: ADAPTERS.map(
          (a) =>
            `  ${a.id.padEnd(14)} ${a.name}\n                 → ${a.path(resolve(str(ctx, 'project') ?? '.'))}`,
        ).join('\n'),
      };
    }
    if (sub !== 'install') throw new JouriloError('USAGE', `Usage: ${agent.usage}`);
    const id = ctx.positionals[1];
    const adapter = ADAPTERS.find((a) => a.id === id);
    if (!adapter)
      throw new JouriloError(
        'USAGE',
        `Unknown agent "${id}". Known: ${ADAPTERS.map((a) => a.id).join(', ')}`,
      );
    const target = adapter.path(resolve(str(ctx, 'project') ?? '.'));
    const body = adapter.render(str(ctx, 'command') ?? defaultCommand());
    const content = adapter.section
      ? mergeSection(existsSync(target) ? readFileSync(target, 'utf8') : '', body)
      : body;
    if (!flag(ctx, 'write'))
      return {
        data: { target, content, written: false },
        text: `Would write ${target}:\n\n${content}\nRe-run with --write to install.`,
      };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return { data: { target, written: true }, text: `Installed ${adapter.name} → ${target}` };
  },
};
