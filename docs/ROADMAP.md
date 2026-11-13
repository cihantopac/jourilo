# Roadmap

Priorities follow the rule: correctness and evidence before breadth. Items under Next are planned, not shipped; the
1.0.0 scope and its evidence are in [RELEASE-1.0.md](RELEASE-1.0.md).

## Done for 1.0

- CI on Linux, macOS and Windows (Node 20 and 22) with Chromium, Firefox and WebKit; clean install from the packed
  tarball on all three platforms.
- Network guard, fix transactions with conflict-safe rollback, request-level journey safety, read-only audits
  ([SECURITY-REVIEW.md](SECURITY-REVIEW.md)).
- Independent benchmark on the W3C ACT Rules test cases ([EVALUATION.md](EVALUATION.md)) and validation on real
  applications.
- Repeated-run medians with ranges and noise-aware verdicts in `verify`; `journeys run --repeat` for flaky journeys.
- Keyboard reachability of composite widgets (tabs, radio groups, list boxes, menu bars, trees).
- Laravel route discovery (included route files, groups, Livewire/Inertia/Volt, Filament panels, guards).

## Done in 1.0.1

- **Brand identity and plugin icon.** 1.0.0 shipped without an icon (no concept from two Markilo rounds passed the
  critic's gate). A third, wordmark-led round produced the approved "Daybook" identity: wordmark, J symbol and plugin
  icon ([DECISIONS.md](DECISIONS.md) D16). Submitting the plugin to the Claude Code directory is a maintainer
  decision.

## Done in 1.1.0

- Redesigned, accessible report in the Daybook identity; English/Turkish interface; light/dark/system theme.
- Root-cause grouping, fix paths, repair prompts for coding agents, experiment briefs for hypotheses.
- Journey timelines, before/after crops, short agent answers, README as a visual product page.

## Done in 1.2.0

Driven by field reports ([FIELD-FEEDBACK.md](FIELD-FEEDBACK.md), [RELEASE-1.2.md](RELEASE-1.2.md)):

- Focus hidden behind any opaque content; disclosures are not dialogs; state CSS rules as the source of a finding.
- `--timezone`, `--clock` and `--setup-journey`; `finding dismiss`; `--evidence minimal`; interaction journeys for
  disclosures and toggles; covered click targets explained.
- Automation: exit 5 (no page loaded) and 6 (partial run), `--max-duration`, JSON progress, `manifest.json`,
  `--run-id`, the published run schema and its compatibility policy.
- Every implemented flag in the CLI reference.

## Done in 1.2.1

Field items F19, F20, F24, F25, F27, F28, F30, F32-F34, F37, F39, F40 and part of F22/F23
([FIELD-FEEDBACK.md](FIELD-FEEDBACK.md), [RELEASE-1.2.md](RELEASE-1.2.md)):

- `--deny-local` / `JOURILO_DENY_LOCAL` (fail-closed, refused with WebKit); trailing slashes are kept, and an explicitly
  requested URL that robots.txt disallows is audited with a limitation that says so.
- Fewer false positives: dev-server overlays and boxless focus stops, `aria-hidden` contrast glyphs, fieldsets named by
  ARIA, dialog focus guards; overflow without a located element is a review item; the stronger sighting decides a
  merged finding.
- Automation: bounded `--max-duration`, `--run-id` reuse refused, a trace on the second stop signal, `--pages 0` and
  `verify --target` as usage errors, fast failure for unresolvable `*.test` names, redirect-loop explanation.
- `foldScreenshot` for `--evidence minimal`; per-attempt journey screenshots; Turkish capitals in the lexicon.

## Done in 1.3.0

Field items F8, F15, F16, F21, F22, F23, F26, F29, F31, F35, F36 and F38
([FIELD-FEEDBACK.md](FIELD-FEEDBACK.md), [RELEASE-1.3.md](RELEASE-1.3.md)):

- **F8** contrast over images, gradients and overlaps decided from the rendered pixels (`jourilo/contrast-over-image`).
- **F15** `--proxy` / `HTTPS_PROXY` chained behind the network guard (checked addresses only, `NO_PROXY` per
  destination), `--allow-hosts` and `--block-hosts`.
- **F16** `--user-agent`, `--extra-header` (target origin only, values never stored) and `--ignore-https-errors`;
  `--output-dir` is the existing `--workspace`.
- **F21** the Chromium sandbox as an opt-in (`--chromium-sandbox`), and `browser.pids` for cleanup.
- **F22** distinct pages and captures, and what a sample left out.
- **F23** `jourilo/redirect-chain`, and keyboard traps found wherever focus starts.
- **F26** `rules list --json`, a machine-readable rule registry.
- **F29** budgets as arguments (`--budget LCP=2000,CLS=0.05`).
- **F31** `--wait-for <selector>` and the load state of each capture.
- **F35** structured progress (`phase`, `done`, `total`) and a richer `manifest.json`.
- **F36** stable performance evidence for snapshot consumers.
- **F38** screenshot names independent of the audited origin.
- Carried from the 1.2.1 review: failed-navigation URLs redacted with `redactUrl`, Turkish capitals in the in-page
  probe lexicon, a timer fallback for the dialog wait, and the report's fallback to `foldScreenshot`.
- F43 is documented: put runs outside an audited repository with `--workspace` ([WORKFLOW.md](WORKFLOW.md)).

## Done in 1.4.0

The "Next (1.x)" list from 1.3.0 and field items F42 and F44 ([RELEASE-1.4.md](RELEASE-1.4.md)):

- Full APG menu-button keys (arrows, Home/End, Escape, focus return).
- AST route discovery for TS, TSX, Vue and Svelte with a bundled TypeScript 6.0.3 parser in a lazy chunk
  ([DECISIONS.md](DECISIONS.md) D21), and component-level root causes.
- Two fixers: `type="button"` for typeless buttons that submit, and `scroll-padding` for sticky headers.
- Normalized trends across runs (`runs trend`, a table in the report).
- Read-only PostHog, GrowthBook and Amplitude adapters (D22) and sequential testing with an mSPRT (D23).
- Multi-tab journeys and OAuth popups against test identity providers, with every redirect hop checked.
- Italian, Portuguese and Dutch vocabulary; Turkish rule texts.
- **F44** findings that differ only in volatile tokens collapse into one finding with `pages`; axe-core runs under a
  strict CSP and Jourilo's own injections are not reported as site errors.
- **F42** a run where every page's own scripts fail adds a stale-server limitation, and the plugin checks the port.
- The network guard tries every resolved address (`localhost` on `::1` and `127.0.0.1`).

## Deferred from 1.2.0

Shipped in 1.2.1: F19, F20 and part of F22/F23; the rest shipped in 1.3.0 (see Done in 1.3.0). Each item has its
number in [FIELD-FEEDBACK.md](FIELD-FEEDBACK.md). F10 (an overall score) stays declined ([DECISIONS.md](DECISIONS.md)
D3), and F17 is covered by `--auth` plus `--setup-journey`.

- **F8 pixel contrast.** Sample the rendered pixels behind the text for axe "incomplete" contrast nodes. An engine
  change: it needs a fixture, a control and a rerun of the ACT benchmark.
- **F15 proxy chaining and allow/block hosts.** `--allow-hosts` / `--block-hosts`, and chaining to an upstream proxy
  behind the network guard so the guard still checks the final destination.
- **F16 user agent, extra headers, ignore-HTTPS-errors.** `--user-agent`, `--extra-header`, `--ignore-https-errors`
  (shown in the report's limits when used) and `--output-dir`.
- **F19 loopback deny, opt-in.** A flag or an environment variable that refuses `localhost`, `127.0.0.1` and `[::1]`
  for integrators that audit on behalf of others. Decided (2026-11-11): loopback stays allowed by default;
  `--deny-local` and `JOURILO_DENY_LOCAL` refuse it.
- **F20 start URL.** Check the explicit start URL against robots.txt, and stop rewriting `/staff/` to `/staff`.
- **F21 Chromium sandbox and process group.** An option to run Chromium with its sandbox, and to put the browser in
  Jourilo's process group so it is cleaned up with it. Security-sensitive: test in containers first.
- **F22 pages vs captures.** Report pages and captures separately, say how many pages a sample left out (a
  truncation signal), and make `--pages 0` a usage error.
- **F23 redirect chain and keyboard trap.** A finding for long or looping redirect chains, and trap detection that
  does not depend on where the focus starts.

## 1.2.x follow-ups

All five (the `verify --target` typo error, setup-state removal when the guard fails to close, the attempt index in
`--repeat` file names, Turkish uppercase folding in the toggle lexicon, a `--run-id` directory left by a crashed run)
shipped in 1.2.1, together with F24-F40 (see Done in 1.2.1). The four review follow-ups carried to 1.3.0 shipped
there.

## Next

Deferred from the 1.4.0 reviews, grouped; each is a small, known gap.

- **Menus:** detect a role-less popup that ignores Escape; do not reload up to four times on a cookie banner.
- **Discovery and causes:** keep hand-written long-line files out of the regex fallback; Angular `loadComponent` records.
- **Fixers:** edit an existing `html, body {}` rule; add a rect and screenshot to implicit-submit evidence.
- **Trends:** LCP and CLS from every capture; say when the page set changed between runs.
- **Experiments:** a minimum-sample floor for the sequential p-value; variants of an Amplitude flag; self-hosted LAN hosts.
- **Journeys:** domain cookies on a trailing-dot host; fail a half-finished redirect chain sooner than the step timeout.
- **Vocabulary:** stop the financial list refusing Italian "Ordina per" (sort) and similar.
- **Network:** close a half-open upstream socket sooner; try several addresses through `--proxy`.
- **WebKit:** tell Jourilo's own style refusal and exceptions from the site's without a time window.
- **Findings:** carry a dismissal across a collapse; collapse a cause seen on one page of one run and many in another.
