// A guarded browser session: the network guard proxy plus a browser routed through it. Every audit, journey run and
// form probe uses one, so the address policy applies to every request the page makes, not only to the target URL.
import type { Browser, BrowserContext } from 'playwright-core';
import { type BlockedConnection, type NetGuard, redirectEscape, startNetGuard } from '../core/net-guard.js';
import { redactUrl } from '../core/redact.js';
import { type AddressPolicy, type Upstream, upstreamLabel } from '../core/url-safety.js';
import { type BrowserName, launchBrowser } from './runtime.js';

export interface NetworkReport {
  /** Connections the guard refused (host, port, reason). */
  blocked: BlockedConnection[];
  /** Redirect hops that reached a forbidden loopback address outside the proxy (detected, not prevented). */
  escaped: { url: string; reason: string }[];
}

export interface GuardedSession {
  browser: Browser;
  guard: NetGuard;
  report(): NetworkReport;
  close(): Promise<void>;
}

const sessions = new WeakMap<Browser, { policy: AddressPolicy; escaped: NetworkReport['escaped'] }>();

export async function openGuardedBrowser(
  name: BrowserName,
  headed: boolean,
  policy: AddressPolicy,
  ownSignals = false,
): Promise<GuardedSession> {
  const guard = await startNetGuard(policy);
  let browser: Browser;
  try {
    browser = await launchBrowser(name, headed, guard, ownSignals);
  } catch (err) {
    await guard.close();
    throw err;
  }
  const escaped: NetworkReport['escaped'] = [];
  sessions.set(browser, { policy, escaped });
  return {
    browser,
    guard,
    report: () => ({ blocked: [...guard.blocked], escaped: [...escaped] }),
    close: async () => {
      await browser.close().catch(() => undefined);
      await guard.close();
    },
  };
}

/** Called for every new context of a guarded browser: records redirect hops that escaped the proxy. */
export function watchContext(browser: Browser, ctx: BrowserContext): void {
  const s = sessions.get(browser);
  if (!s) return;
  ctx.on('request', (req) => {
    const from = req.redirectedFrom()?.url() ?? null;
    const reason = redirectEscape(req.url(), from, s.policy);
    if (reason && s.escaped.length < 50) s.escaped.push({ url: redactUrl(req.url()), reason });
  });
}

/** Lines for a run's limitations: what the guard refused, and anything it could not prevent. */
export function networkLimitations(r: NetworkReport): string[] {
  const out: string[] = [];
  const list = (bs: NetworkReport['blocked']) =>
    `${bs
      .slice(0, 3)
      .map((b) => `${b.host}:${b.port}`)
      .join(', ')}${bs.length > 3 ? ', …' : ''}`;
  const byName = (b: BlockedConnection) => /--(allow|block)-hosts/.test(b.reason);
  const listed = r.blocked.filter(byName);
  const denied = r.blocked.filter((b) => !byName(b) && b.reason.includes('--deny-local'));
  const other = r.blocked.filter((b) => !byName(b) && !b.reason.includes('--deny-local'));
  if (listed.length)
    out.push(
      `The network guard refused ${listed.length} connection(s) to hosts excluded by --allow-hosts / --block-hosts (${list(listed)}); content that depends on them was not loaded.`,
    );
  if (denied.length)
    out.push(
      `The network guard refused ${denied.length} connection(s) to local addresses because --deny-local is set (${list(denied)}); content that depends on them was not loaded.`,
    );
  if (other.length)
    out.push(
      `The network guard refused ${other.length} connection(s) to non-public addresses (${list(other)}); content that depends on them was not loaded.`,
    );
  if (r.escaped.length)
    out.push(
      `SECURITY: ${r.escaped.length} redirect(s) from the target reached this machine outside the network guard (${r.escaped[0]!.url}). This browser follows HTTPS redirects to loopback addresses directly; use Chromium or Firefox for untrusted sites.`,
    );
  return out;
}

/** The limitation line of a run that chained to an upstream proxy (named without its credentials). */
export function proxyLimitation(up: Upstream | undefined): string[] {
  if (!up) return [];
  return [
    `Requests went through the upstream proxy ${upstreamLabel(up)}: the network guard checked every destination first and tunnelled to the checked address; loopback addresses were reached directly. Timings include the proxy hop.`,
  ];
}
