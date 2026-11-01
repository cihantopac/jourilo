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

## Next (1.x)

1. Full arrow-key patterns for menus and dialogs inside menus (Escape closes, focus returns, Home/End).
2. AST-based route and component discovery for TS/TSX, Vue SFC and Svelte, and component-level root causes.
3. More deterministic fixers (`type="button"`, `scroll-padding` for sticky headers), each with a fixture and a
   verify test.
4. Normalized trends across runs (per page and viewport) on top of the run history table.
5. Read-only analytics/flag adapters for experiment plans (PostHog, GrowthBook, Amplitude); sequential testing.
6. Multi-tab journeys and OAuth popups against test identity providers.
7. More languages for the shared lexicon (`src/core/lexicon.ts`), each with a fixture site.
8. `journeys suggest`: never treat toggles (`aria-pressed`, theme or language switches) as the main call to action.
9. Translated rule texts in the report (titles, impact, recommendations) for Turkish.
