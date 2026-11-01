# Roadmap

Priorities follow the rule: correctness and evidence before breadth. Items here are **not** part of 1.0.0; the
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

## Excluded from 1.0

- **Plugin icon.** Two design rounds in Markilo (seven directions) produced no mark that passed the independent
  critic's gate, and the project's rule is to ship only Markilo-made assets. The icon is used only by the plugin
  directory listing; the plugin works without it. A third round needs the maintainer's steer (the critic suggests a
  wordmark-led identity with one constructed, measurable detail).

## Next (1.x)

1. Full arrow-key patterns for menus and dialogs inside menus (Escape closes, focus returns, Home/End).
2. AST-based route and component discovery for TS/TSX, Vue SFC and Svelte, and component-level root causes.
3. More deterministic fixers (`type="button"`, `scroll-padding` for sticky headers), each with a fixture and a
   verify test.
4. Normalized trends across runs (per page and viewport) on top of the run history table.
5. Read-only analytics/flag adapters for experiment plans (PostHog, GrowthBook, Amplitude); sequential testing.
6. Multi-tab journeys and OAuth popups against test identity providers.
7. More languages for the shared lexicon (`src/core/lexicon.ts`), each with a fixture site.
