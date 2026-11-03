import { type ParseArgsConfig, parseArgs } from 'node:util';
import { JouriloError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';

export type OptionSpec = NonNullable<ParseArgsConfig['options']>;

export interface Context {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
  json: boolean;
  ws: Workspace;
  /** Progress lines go to stderr so stdout stays machine-readable. */
  log: (msg: string) => void;
}

export interface CommandResult {
  /** Machine-readable payload printed with --json. */
  data: unknown;
  /** Human-readable text printed otherwise. */
  text: string;
  /** Non-zero to signal a failed gate (e.g. --fail-on) without throwing. */
  exitCode?: number;
}

export interface Command {
  name: string;
  summary: string;
  usage: string;
  options?: OptionSpec;
  details?: string;
  run(ctx: Context): Promise<CommandResult>;
}

export const GLOBAL_OPTIONS: OptionSpec = {
  json: { type: 'boolean' },
  workspace: { type: 'string' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
};

export function parse(cmd: Command, argv: string[]): Context {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...(cmd.options ?? {}) },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new JouriloError('USAGE', (err as Error).message, `Usage: ${cmd.usage}`);
  }
  const values = parsed.values as Context['values'];
  const quiet = Boolean(values.quiet);
  return {
    values,
    positionals: parsed.positionals,
    json: Boolean(values.json),
    ws: new Workspace(values.workspace as string | undefined),
    log: (msg) => {
      if (!quiet) process.stderr.write(`${msg}\n`);
    },
  };
}

export function str(ctx: Context, key: string): string | undefined {
  const v = ctx.values[key];
  return typeof v === 'string' ? v : undefined;
}

export function num(ctx: Context, key: string, fallback: number): number {
  const v = str(ctx, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw new JouriloError('USAGE', `--${key} must be a non-negative number.`);
  return n;
}

export function list(ctx: Context, key: string): string[] {
  const v = ctx.values[key];
  if (Array.isArray(v))
    return v
      .flatMap((x) => x.split(','))
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** `--timezone` and `--clock`, validated up front so a typo fails before the browser starts. */
export function parseStateOptions(ctx: Context): { timezoneId?: string; clock?: string } {
  const timezoneId = str(ctx, 'timezone');
  const clock = str(ctx, 'clock');
  if (timezoneId) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: timezoneId });
    } catch {
      throw new JouriloError(
        'USAGE',
        `--timezone ${timezoneId} is not a known IANA time zone.`,
        'Example: --timezone Europe/Istanbul',
      );
    }
  }
  if (clock && Number.isNaN(new Date(clock).getTime()))
    throw new JouriloError(
      'USAGE',
      `--clock ${clock} is not a valid date-time.`,
      'Example: --clock 2026-11-03T22:30:00+03:00',
    );
  return { ...(timezoneId ? { timezoneId } : {}), ...(clock ? { clock } : {}) };
}

export function flag(ctx: Context, key: string): boolean {
  return ctx.values[key] === true;
}

export function requirePositional(ctx: Context, index: number, name: string, usage: string): string {
  const v = ctx.positionals[index];
  if (!v) throw new JouriloError('USAGE', `Missing <${name}>.`, `Usage: ${usage}`);
  return v;
}
