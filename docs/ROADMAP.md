# Roadmap

Priorities follow the rule: correctness and evidence before breadth.

## Next (0.2)

1. Run the CI matrix on Linux and Windows; fix platform issues.
2. Independent real-world fixtures: reproduce known UX bugs from public issue trackers (with permission/licences) and
   measure recall that the rule authors did not design for.
3. Comparative benchmark against Lighthouse (accessibility/performance categories) and Pa11y on the same pages, with
   published methodology.
4. Repeated-run medians for lab metrics; flake detection for journeys.
5. Keyboard interaction for composite widgets (menus, tabs, dialogs: Escape closes, focus returns).
6. Historical trends across runs (regression timeline in the Observatory).

## Later

- AST-based route and component discovery (TS/TSX, Vue SFC, Svelte, Blade) and component-level root causes.
- More deterministic fixers (labels from placeholders, `type="button"`, `scroll-padding` for sticky headers,
  `width`/`height` on images) — each with a fixture and a verify test.
- Analytics/flag adapters that read (never write) funnel rates for experiment plans: PostHog, GrowthBook, Amplitude.
- Sequential testing option for experiments.
- Localization of heuristic keyword lists (trust, pricing, validation messages).
- npm publication and public marketplace listing (requires maintainer approval).
