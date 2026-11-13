// Shared plumbing of the analytics adapters: keys from the environment, read-only JSON requests through the guarded
// fetch, and the rule that a partial answer (429, a failed page, a missing variant) becomes `complete: false` with a
// note instead of numbers. Keys travel only in request headers and are scrubbed from every message as a last resort.
import { JouriloError } from '../../core/errors.js';
import { GuardBlockedError, guardedFetch } from '../../core/net-guard.js';
import { type AddressPolicy, isLocalHostname, type Upstream } from '../../core/url-safety.js';
import { VERSION } from '../../core/version.js';
import type { ExperimentData } from './types.js';

/** The subset of `fetch` the adapters use. Tests pass a stub that serves recorded responses. */
export type AdapterFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface AdapterDeps {
  env: Record<string, string | undefined>;
  /** Defaults to the guarded fetch under a policy for the vendor host. */
  fetch?: AdapterFetch;
  /** The upstream proxy for a vendor URL (`HTTPS_PROXY` and friends), when no `fetch` is given. */
  proxy?: (url: URL) => Upstream | undefined;
  /** `--metric`: which metric to read (PostHog, GrowthBook) or the conversion event (Amplitude). */
  metric?: string;
  /** `--start` / `--end` (YYYY-MM-DD), Amplitude only. */
  start?: string;
  end?: string;
  /** `--control-key`: the control variant's key, Amplitude only (default `control`). */
  controlKey?: string;
}

/** Raised while reading: the data is partial. The adapter returns what it has with `complete: false`. */
export class IncompleteData extends Error {}

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 20_000_000;

export function requireEnv(env: AdapterDeps['env'], name: string, what: string): string {
  const v = env[name]?.trim();
  if (!v)
    throw new JouriloError(
      'USAGE',
      `${name} is not set.`,
      `Set ${name} to ${what}. It is read from the environment only.`,
    );
  return v;
}

/**
 * The vendor host from `name`, else `fallback`. Only http(s) without credentials; plain http only for a local host,
 * so a key never crosses the network unencrypted. The value is not repeated in errors.
 */
export function hostFrom(env: AdapterDeps['env'], name: string, fallback: string): URL {
  const raw = env[name]?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new JouriloError('USAGE', `${name} is not a valid URL.`, 'Example: https://eu.posthog.com');
  }
  if (url.username || url.password)
    throw new JouriloError(
      'USAGE',
      `${name} must not contain credentials; keys are read from their own variables.`,
    );
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHostname(url.hostname)))
    throw new JouriloError('USAGE', `${name} must be an https:// URL (plain http only for a local host).`);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

export function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out;
}

/** The guarded fetch with a per-host policy: a local vendor host may use loopback, nothing may use the LAN. */
export function defaultFetch(proxy?: AdapterDeps['proxy']): AdapterFetch {
  return (url, init) => {
    const u = new URL(url);
    const upstream = proxy?.(u);
    const policy: AddressPolicy = {
      target: isLocalHostname(u.hostname) ? 'local' : 'public',
      allowPrivate: false,
      ...(upstream ? { upstream } : {}),
    };
    return guardedFetch(url, policy, { ...init, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
  };
}

export interface Client {
  get(url: string): Promise<unknown>;
  post(url: string, body: unknown): Promise<unknown>;
  scrub(text: string): string;
}

/**
 * Read-only JSON requests for one vendor. 429 and 5xx answers and unreachable hosts are IncompleteData; a refused key
 * is a usage error naming the variable; 404 is NOT_FOUND; a destination the network guard refuses is UNSAFE_URL.
 */
export function client(
  vendor: string,
  deps: AdapterDeps,
  auth: { header: string; keyVars: string; secrets: string[] },
): Client {
  const fetch = deps.fetch ?? defaultFetch(deps.proxy);
  const clean = (t: string) => scrub(t, auth.secrets);
  const send = async (method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> => {
    const path = new URL(url).pathname;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: auth.header,
          accept: 'application/json',
          'user-agent': `Jourilo/${VERSION} (+https://github.com/cihantopac/jourilo)`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (e instanceof GuardBlockedError)
        throw new JouriloError(
          'UNSAFE_URL',
          clean(`${vendor}: the network guard refused the request: ${e.message}`),
        );
      throw new IncompleteData(
        clean(`${vendor} could not be reached for ${path} (${(e as Error).message}).`),
      );
    }
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      throw new IncompleteData(
        `${vendor} rate-limited the request for ${path} (HTTP 429)${retry && /^\d+$/.test(retry) ? `; retry after ${retry} s` : ''}. The numbers read so far are partial.`,
      );
    }
    if (res.status === 401 || res.status === 403)
      throw new JouriloError(
        'USAGE',
        `${vendor} refused the key in ${auth.keyVars} (HTTP ${res.status}).`,
        'Check that the key is valid and has read access to experiments.',
      );
    if (res.status === 404)
      throw new JouriloError('NOT_FOUND', `${vendor}: ${path} was not found (HTTP 404).`);
    if (res.status < 200 || res.status >= 300)
      throw new IncompleteData(
        `${vendor} answered HTTP ${res.status} for ${path}; that page of data is missing.`,
      );
    try {
      return JSON.parse(await res.text());
    } catch {
      throw new IncompleteData(`${vendor} sent a response for ${path} that is not JSON.`);
    }
  };
  return {
    get: (url) => send('GET', url),
    post: (url, body) => send('POST', url, body),
    scrub: clean,
  };
}

/** True when `n` can be a count of users. */
export const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export interface ReadState {
  metric: string;
  variants: ExperimentData['variants'];
  /** Every note, informational or not. Completeness is `complete`, never the number of notes. */
  notes: string[];
  /** False once `incomplete` was called. */
  readonly complete: boolean;
  /** Records why the numbers cannot be trusted as complete, and keeps reading. */
  incomplete(note: string): void;
  /** Records a note that does not make the data partial (e.g. users left out by design). */
  note(text: string): void;
}

/**
 * Runs a read and turns IncompleteData into `complete: false`, keeping every note. A response of an unexpected shape
 * (a TypeError while reading it) is incomplete data too, with a note that says so; JouriloErrors pass through scrubbed.
 */
export async function collect(
  vendor: string,
  id: string,
  read: (state: ReadState) => Promise<void>,
  secrets: string[],
): Promise<ExperimentData> {
  let complete = true;
  const notes: string[] = [];
  const state: ReadState = {
    metric: '',
    variants: [],
    notes,
    get complete() {
      return complete;
    },
    incomplete(note) {
      complete = false;
      notes.push(note);
    },
    note(text) {
      notes.push(text);
    },
  };
  try {
    await read(state);
  } catch (e) {
    if (e instanceof IncompleteData) state.incomplete(e.message);
    else if (e instanceof JouriloError) throw new JouriloError(e.code, scrub(e.message, secrets), e.hint);
    else
      state.incomplete(
        `${vendor} sent a response Jourilo could not read (${(e as Error)?.message ?? String(e)}); its shape may have changed.`,
      );
  }
  return {
    id,
    metric: state.metric,
    variants: state.variants,
    complete,
    notes: notes.map((n) => scrub(n, secrets)),
  };
}

/**
 * Puts the variants in the experiment's own order (control first) and marks the data incomplete when an expected
 * variant has no numbers, or when fewer than two arms came back.
 */
export function settleVariants(vendor: string, state: ReadState, expected: string[]): void {
  if (expected.length) {
    const byName = new Map(state.variants.map((v) => [v.name, v]));
    const missing = expected.filter((n) => !byName.has(n));
    if (missing.length)
      state.incomplete(
        `${vendor} returned no numbers for variant${missing.length > 1 ? 's' : ''} ${missing.join(', ')}; a comparison without ${missing.length > 1 ? 'them' : 'it'} would be partial.`,
      );
    const extra = state.variants.filter((v) => !expected.includes(v.name));
    state.variants = [...expected.flatMap((n) => byName.get(n) ?? []), ...extra];
  }
  // Fewer than two arms is always partial data, whatever else was noted.
  if (state.variants.length < 2 && state.complete)
    state.incomplete(
      `${vendor} returned numbers for ${state.variants.length} variant(s)${state.variants.length ? ` (${state.variants.map((v) => v.name).join(', ')})` : ''}; the other arm is missing, and a comparison needs at least two.`,
    );
}

/** A variant's numbers, or a note when they cannot be counts of users. */
export function pushVariant(state: ReadState, name: string, exposures: unknown, conversions: unknown): void {
  if (!isCount(exposures) || !isCount(conversions) || conversions > exposures) {
    state.incomplete(
      `Variant ${name}: the numbers are not user counts with conversions ≤ exposures (got ${String(conversions)}/${String(exposures)}); analyze needs a conversion metric.`,
    );
    return;
  }
  state.variants.push({ name, exposures, conversions });
}
