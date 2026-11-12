import { type ParseArgsConfig, parseArgs } from 'node:util';
import { JouriloError } from '../core/errors.js';
import { type AddressPolicy, noProxyMatches, type Upstream } from '../core/url-safety.js';
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

/** `--pages N`: a whole number from 1 (`0` used to become 1 silently). */
export function pagesOption(ctx: Context, fallback: number): number {
  const v = str(ctx, 'pages');
  if (v === undefined) return fallback;
  const n = Number(v);
  if (v.trim() === '' || !Number.isInteger(n) || n < 1)
    throw new JouriloError('USAGE', `--pages must be a whole number of 1 or more (got "${v}").`);
  return n;
}

/** The longest `--max-duration`: one day, far below the timer limit (about 24.8 days) where Node fires at once. */
export const MAX_DURATION_LIMIT_S = 86_400;

/** `--max-duration SECS`: undefined when absent, otherwise 1 to 86 400 seconds. */
export function maxDurationOption(ctx: Context): number | undefined {
  const v = str(ctx, 'max-duration');
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n) || n < 1 || n > MAX_DURATION_LIMIT_S)
    throw new JouriloError(
      'USAGE',
      `--max-duration must be from 1 to ${MAX_DURATION_LIMIT_S} seconds (got "${v}").`,
    );
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

/**
 * `--deny-local`, or `JOURILO_DENY_LOCAL`: refuse loopback / `*.test` / `*.localhost` targets.
 * Unset, empty, 0, false, no or off disable it; 1, true, yes or on enable it; any other value fails closed
 * (enabled) with a warning through the context logger (a JSON progress line under --json).
 */
export function denyLocalFrom(ctx: Context): boolean {
  if (flag(ctx, 'deny-local')) return true;
  const raw = process.env.JOURILO_DENY_LOCAL ?? '';
  const v = raw.trim().toLowerCase();
  if (!v || ['0', 'false', 'no', 'off'].includes(v)) return false;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (!warnedDenyLocal) {
    warnedDenyLocal = true;
    ctx.log(
      `JOURILO_DENY_LOCAL=${raw} is not recognised (use 1, true, yes or on to enable, 0, false, no or off to disable); --deny-local is on.`,
    );
  }
  return true;
}
let warnedDenyLocal = false;

/** WebKit sends HTTPS redirects outside the proxy, so the redirect protection of --deny-local cannot hold there. */
export function refuseDenyLocalWebkit(denyLocal: boolean, browser: string): void {
  if (denyLocal && browser === 'webkit')
    throw new JouriloError(
      'UNSAFE_URL',
      '--deny-local cannot be combined with --browser webkit: WebKit sends HTTPS redirects outside the network guard, so a redirect to a local address could not be blocked.',
      'Use --browser chromium or firefox.',
    );
}

/** Options every browsing command shares: the upstream proxy and the host lists (F15). */
export const NETWORK_OPTIONS: OptionSpec = {
  proxy: { type: 'string' },
  'allow-hosts': { type: 'string', multiple: true },
  'block-hosts': { type: 'string', multiple: true },
};

/** The `details` lines for NETWORK_OPTIONS, indented to a command's option column. */
export function networkOptionsHelp(column: number): string {
  const pad = (flag: string) => `  ${flag.padEnd(column - 2)}`;
  const cont = ' '.repeat(column);
  return [
    `${pad('--proxy URL')}Chain to an upstream HTTP proxy (http://[user:password@]host:port) behind the network guard;`,
    `${cont}default HTTPS_PROXY / HTTP_PROXY (either case), skipped for a target that NO_PROXY matches.`,
    `${cont}The guard still checks every destination, then tunnels to the checked address (CONNECT ip:port);`,
    `${cont}loopback connects directly. The run records the proxy without its credentials`,
    `${pad('--allow-hosts LIST')}Only these hosts may be reached (comma-separated or repeated; *.example.com = its subdomains);`,
    `${cont}the target's own host is always allowed. Other hosts are refused and listed in the limitations`,
    `${pad('--block-hosts LIST')}Refuse these hosts (e.g. *.tracker.example); refused requests are listed in the limitations`,
  ].join('\n');
}

const HOST_PATTERN = /^(\*\.)?[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*\.?$/i;
const IP_PATTERN = /^\[?[0-9a-f:.]+\]?$/i;

/** `--allow-hosts` and `--block-hosts`: lower-case host names or `*.suffix` patterns; anything else is a usage error. */
export function hostListsFrom(ctx: Context): { allowHosts: string[]; blockHosts: string[] } {
  const read = (key: string) =>
    list(ctx, key).map((p) => {
      if (!HOST_PATTERN.test(p) && !IP_PATTERN.test(p))
        throw new JouriloError(
          'USAGE',
          `--${key} ${p} is not a host name or a *.domain pattern.`,
          'Example: --allow-hosts example.com,*.cdn.example.com',
        );
      return p.toLowerCase().replace(/^\[|\]$/g, '');
    });
  return { allowHosts: read('allow-hosts'), blockHosts: read('block-hosts') };
}

function envValue(...names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return undefined;
}

/**
 * The upstream proxy for a run against `target`: `--proxy URL`, else HTTPS_PROXY / HTTP_PROXY (lower case first,
 * the variable for the target's scheme first). NO_PROXY (either case) is honoured for the target: when it matches,
 * the run goes direct. Only plain `http://` proxies are supported (a scheme-less value means http). An invalid value
 * is a usage error that never repeats the value, since it may hold credentials.
 */
export function proxyFrom(ctx: Context, target: URL): AddressPolicy['upstream'] {
  const flagValue = str(ctx, 'proxy');
  const https = target.protocol === 'https:';
  const env = https
    ? envValue('https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY')
    : envValue('http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY');
  const source = flagValue !== undefined ? { name: '--proxy', value: flagValue } : env;
  if (!source) return undefined;
  const noProxy = envValue('no_proxy', 'NO_PROXY')?.value ?? '';
  const port = Number(target.port || (https ? 443 : 80));
  if (noProxy && noProxyMatches(target.hostname, port, noProxy)) return undefined;
  const usage = (why: string) =>
    new JouriloError(
      'USAGE',
      `${source.name}: ${why}`,
      'Expected http://host:port or http://user:password@host:port (the value is not shown, it may hold credentials).',
    );
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(source.value) ? source.value : `http://${source.value}`);
  } catch {
    throw usage('not a valid proxy URL.');
  }
  if (url.protocol !== 'http:')
    throw usage(`only http:// proxies are supported (got ${url.protocol.replace(/:$/, '')}).`);
  if (!url.hostname) throw usage('the proxy URL has no host.');
  let auth: string | undefined;
  try {
    auth =
      url.username || url.password
        ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
        : undefined;
  } catch {
    throw usage('the credentials in the proxy URL are not valid percent-encoding.');
  }
  const up: Upstream = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) };
  return auth ? { ...up, auth } : up;
}

/**
 * Proxy and host lists for a browsing command, ready to spread into its audit options. The target's own host joins
 * `--allow-hosts` later (`hostListsFor`), when the target is known for certain.
 */
export function networkFrom(
  ctx: Context,
  target: string,
): { upstream?: Upstream; allowHosts?: string[]; blockHosts?: string[] } {
  const { allowHosts, blockHosts } = hostListsFrom(ctx);
  let url: URL | undefined;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`);
  } catch {
    url = undefined; // the audit itself reports an invalid target
  }
  const upstream = url ? proxyFrom(ctx, url) : undefined;
  return {
    ...(upstream ? { upstream } : {}),
    ...(allowHosts.length ? { allowHosts } : {}),
    ...(blockHosts.length ? { blockHosts } : {}),
  };
}

export function requirePositional(ctx: Context, index: number, name: string, usage: string): string {
  const v = ctx.positionals[index];
  if (!v) throw new JouriloError('USAGE', `Missing <${name}>.`, `Usage: ${usage}`);
  return v;
}
