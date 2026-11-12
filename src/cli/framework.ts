import { type ParseArgsConfig, parseArgs } from 'node:util';
import { JouriloError } from '../core/errors.js';
import { Workspace } from '../core/workspace.js';

export type OptionSpec = NonNullable<ParseArgsConfig['options']>;

export interface Context {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
  json: boolean;
  ws: Workspace;
  /**
   * Progress lines go to stderr so stdout stays machine-readable; with --json each one is a JSON line
   * `{"type":"progress","message":...,"at":ISO}`.
   */
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
  const json = Boolean(values.json);
  return {
    values,
    positionals: parsed.positionals,
    json,
    ws: new Workspace(values.workspace as string | undefined),
    log: (msg) => {
      if (quiet) return;
      process.stderr.write(
        json
          ? `${JSON.stringify({ type: 'progress', message: msg.trim(), at: new Date().toISOString() })}\n`
          : `${msg}\n`,
      );
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

/** `--evidence full|minimal`; undefined when not given. */
export function parseEvidence(ctx: Context): 'full' | 'minimal' | undefined {
  const v = str(ctx, 'evidence');
  if (v === undefined) return undefined;
  if (v !== 'full' && v !== 'minimal')
    throw new JouriloError('USAGE', `--evidence must be full or minimal (got ${v}).`);
  return v;
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

/** `--deny-local`, or `JOURILO_DENY_LOCAL` set to 1, true or yes: refuse loopback / `*.test` / `*.localhost` targets. */
export function denyLocalFrom(ctx: Context): boolean {
  if (flag(ctx, 'deny-local')) return true;
  const v = (process.env.JOURILO_DENY_LOCAL ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (v && !['0', 'false', 'no', 'off'].includes(v) && !warnedDenyLocal) {
    warnedDenyLocal = true;
    process.stderr.write(
      `jourilo: JOURILO_DENY_LOCAL=${process.env.JOURILO_DENY_LOCAL} is not recognised (use 1, true or yes); local targets stay allowed.\n`,
    );
  }
  return false;
}
let warnedDenyLocal = false;

export function requirePositional(ctx: Context, index: number, name: string, usage: string): string {
  const v = ctx.positionals[index];
  if (!v) throw new JouriloError('USAGE', `Missing <${name}>.`, `Usage: ${usage}`);
  return v;
}
