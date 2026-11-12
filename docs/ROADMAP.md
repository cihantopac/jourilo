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

- `--deny-local` / `JOURILO_DENY_LOCAL` (fail-closed, refused with WebKit); the start URL keeps its trailing slash and
  is checked against robots.txt.
- Fewer false positives: dev-server overlays and boxless focus stops, `aria-hidden` contrast glyphs, fieldsets named by
  ARIA, dialog focus guards; overflow without a located element is a review item; the stronger sighting decides a
  merged finding.
- Automation: bounded `--max-duration`, `--run-id` reuse refused, a trace on the second stop signal, `--pages 0` and
  `verify --target` as usage errors, fast failure for unresolvable `*.test` names, redirect-loop explanation.
- `foldScreenshot` for `--evidence minimal`; per-attempt journey screenshots; Turkish capitals in the lexicon.

## Planned for 1.3.0

[Plan](superpowers/plans/2026-11-11-jourilo-1.3.0.md). Open items from the list below plus the new features:

- **F21** Chromium sandbox and process group, as an opt-in (test in containers first).
- **F26** `rules list --json`, a machine-readable rule registry.
- **F29** budgets as arguments (`--budget LCP=2000,CLS=0.05`).
- **F31** `--wait-for <selector>` and the load state in the report.
- **F35** structured progress (`phase`, `done`, `total`) and a richer `manifest.json`.
- **F36** stable evidence for snapshot consumers.
- **F38** screenshot names independent of the audited origin.
- Carried from 1.2.1 review: redact failed-navigation URLs with `redactUrl` (a token in a failing target URL can
  appear in `page-unreachable` text today); Turkish capitals in the in-page probe lexicon (form purpose, trust and
  pricing signals); a `setTimeout` fallback for the dialog wait (the 250 ms cap is checked only inside
  `requestAnimationFrame`); the report's HTML falling back to `foldScreenshot`, so a minimal-evidence page does not
  show "no screenshot".

## Deferred from 1.2.0

Shipped in 1.2.1: F19, F20 and part of F22/F23. The rest is planned for
[1.3.0](superpowers/plans/2026-11-11-jourilo-1.3.0.md). Each item has its number in [FIELD-FEEDBACK.md](FIELD-FEEDBACK.md). F10 (an overall score) stays declined
([DECISIONS.md](DECISIONS.md) D3), and F17 is covered by `--auth` plus `--setup-journey`.

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
shipped in 1.2.1, together with F24-F40 (see Done in 1.2.1). What remains is listed under 1.3.0.

## Next (1.x)

All eight are planned for [1.4.0](superpowers/plans/2026-11-11-jourilo-1.4.0.md). Decisions (2026-11-11): the
TypeScript parser is bundled in a lazy chunk, the adapters are PostHog, GrowthBook and Amplitude (read-only), and the
new languages are Italian, Portuguese and Dutch.

1. Full arrow-key patterns for menus and dialogs inside menus (Escape closes, focus returns, Home/End).
2. AST-based route and component discovery for TS/TSX, Vue SFC and Svelte, and component-level root causes.
3. More deterministic fixers (`type="button"`, `scroll-padding` for sticky headers), each with a fixture and a
   verify test.
4. Normalized trends across runs (per page and viewport) on top of the run history table.
5. Read-only analytics/flag adapters for experiment plans (PostHog, GrowthBook, Amplitude); sequential testing.
6. Multi-tab journeys and OAuth popups against test identity providers.
7. More languages for the shared lexicon (`src/core/lexicon.ts`), each with a fixture site.
8. Translated rule texts in the report (titles, impact, recommendations) for Turkish.
