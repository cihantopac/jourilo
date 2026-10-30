# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-31

First working version.

### Added

- `audit` / `accessibility` / `conversion`: real-browser audits (Playwright; Chromium, Firefox, WebKit) of URLs and
  static builds with same-origin discovery (robots.txt, sitemap), desktop/mobile/reflow viewports, axe-core 4.14
  (WCAG 2.0–2.2 A/AA, `target-size` enabled), keyboard walk (focus visible, focus obscured, traps), target size,
  horizontal overflow, pointer-only controls, input purpose, placeholder-only labels, paste blocking, form validation
  feedback, lab Web Vitals, JavaScript errors and failed requests, conversion hypotheses, brand consistency.
- `journeys`: JSON scenarios with explicit success criteria; suggestion from evidence; runner with step screenshots,
  traces, generated test data and an element-level safety policy.
- `discover`: repository profiles (Next.js, Nuxt, SvelteKit, Astro, Remix, React/Vue Router, Laravel, Flutter web,
  static HTML, monorepos) and website profiles.
- `optimize`, `verify`, `checkpoint`, `rollback`: root-cause location, seven idempotent deterministic fixers with diff
  previews (html lang, viewport meta, autocomplete, focus ring, paste blocking, image dimensions, visible labels),
  byte-exact git checkpoints, before/after verification.
- `experiment`: sample size, plans from hypotheses, analysis with confidence intervals and SRM check.
- Reports: self-contained HTML Experience Observatory (root-cause-grouped "fix first", improvement roadmap lanes,
  run history for the target, journeys storyboard, before/after), Markdown, SARIF 2.1.0; `compare`.
- `jourilo.context/v1` integration contract with Markilo and Searvex adapters.
- Claude Code plugin (10 skills, `ux-reviewer` agent) and adapters for a bare `/jourilo` skill, `AGENTS.md` and Cursor.
- `bench` with fixture sites and recorded history.
- Keyboard-operated widget checks, including ARIA-less lightboxes (dialog focus, containment, Escape, focus return,
  dialog role; `aria-expanded` state); structure checks (fieldset legends, radio groups, header-less tables, empty
  alt with title); `--runs N` for median lab metrics with ranges. Metrics a browser cannot measure (CLS and TBT
  outside Chromium) are reported as not measured instead of 0.
- `benchmarks/compare`: reproducible comparison with Pa11y and Lighthouse on the GOV.UK accessibility tool audit.
- Multilingual lexicon (en, tr, de, es, fr) shared by the safety policy, conversion rules, form classification,
  error detection and field purposes. **Safety fix:** non-English payment and delete buttons ("Satın al",
  "Jetzt kaufen", "Supprimer le compte"…) were not blocked by name before.
- Cross-browser parity: identical journey, session, signed-in audit and form results in Chromium, Firefox, WebKit.
  WebKit on Windows cannot move keyboard focus to links; the report says so instead of skipping those checks silently.
- Signed-in testing: `journeys run --save-auth` stores a test-account session (mode 0600) for `--auth`; static builds
  are served with SPA fallback on a stable port per directory.
