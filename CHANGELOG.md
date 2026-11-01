# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-11-01

The detection engine is unchanged from 1.0.0 (fixture benchmark 45/45, 0 false positives); this release is about
seeing, understanding and acting on the results.

### Added

- **Repair prompts.** Select findings or whole root-cause groups in the HTML report and turn them into an editable
  Markdown prompt for Claude Code or any coding agent (copy, or download as `jourilo-repair-<run>.md`). It carries
  finding ids, pages, run-relative screenshot and evidence paths, likely source files and reproduction steps, and
  asks the agent to revalidate, make the smallest change, add regression tests and verify with `jourilo verify`.
  Page-derived text is flattened and fenced between nonce markers it cannot forge. The report never runs anything.
- **Fix paths.** Every finding is labelled automatic fix (a Jourilo fixer exists), agent-assisted, manual review or
  experiment brief; conversion hypotheses produce experiment or investigation briefs, never code changes.
- **English and Turkish report interface** and a **Light / Dark / System** theme selector. The browser's language and
  color scheme are used first; choices are remembered. Finding texts, code and screenshots stay in their original
  language.
- `docs/WORKFLOW.md`: the improvement loop, the report, repair prompts and the agent answer format.

### Changed

- **The report is redesigned** in the Daybook identity (paper, ink and brass, a book serif for headings, the
  wordmark's diamond as the recurring mark): compact counts, blocked journeys first with the step where they stopped,
  "Fix first" cards with the outlined element, three separate lanes for verified defects, manual review and
  conversion hypotheses, and short limitations with the rest folded away. Still no overall UX score.
- **Root-cause grouping** everywhere: the same rule on the same source line, or on the same element across pages, is
  one card listing every page and finding id. Filters for result type, severity, category, fix path and page.
- **Journey timelines** with the real screenshot of every step, the step that failed and the goal with its criteria;
  one blocked-journey card per journey across viewports.
- **Before / after**: the same region of the page from the baseline and the new run side by side for each fixed root
  cause, page screenshots in pairs, and metric verdicts.
- Accessibility of the report itself: a page heading, landmarks, a skip link, arrow-key tabs, keyboard-scrollable
  regions, named screenshot links, 24 px targets; axe-core finds no WCAG 2.2 A/AA violations in either theme.
- Claude Code skills and the other-agent instructions answer in 80–150 words: target, blocked journeys and key
  defects, three priorities, available fixes, the real report path and how to open it, one next step.
- The README is a visual product page; CLI examples, evaluation details and safety specifics moved to the docs.
  README images use absolute URLs so they also render on npm.

## [1.0.1] - 2026-11-01

### Added

- Brand identity "Daybook", made with Markilo: the Jourilo wordmark in the README and the report header, the J
  symbol as the report favicon, and a plugin icon (`plugin/.claude-plugin/icon.png`) for the Claude Code plugin
  directory. Masters are in `docs/assets/brand/`; the README credits Markilo.

### Changed

- The HTML report uses the brand palette (paper, ink and brass, with a matching dark theme); every text color keeps
  at least 4.5:1 contrast on its background.

## [1.0.0] - 2026-11-01

### Security

- Network guard: every browser request (subresources, redirects, iframes, WebSockets) goes through a local proxy
  that resolves names itself and connects only to allowed addresses, so an audited page can no longer reach
  loopback, LAN or cloud-metadata services, including through DNS rebinding. WebRTC and QUIC are disabled.
- Targets whose DNS answer mixes public and private addresses are refused; address classification covers IPv4/IPv6
  special-purpose ranges, embedded IPv4 and metadata endpoints. robots.txt and sitemap fetches check every redirect.
- Journey safety: key presses (with or without a target) are judged like clicks; icon-only buttons, link targets,
  `formaction` and form actions count; every request a journey triggers is checked (DELETE, destructive or payment
  endpoints, form posts on non-local hosts, navigation to other origins — `--allow-origin` for authorized ones).
- Audits never write data: the form probe simulates the empty submission by default (real only with
  `--allow-submit`), and keyboard/widget checks run read-only.
- The static server no longer serves hidden files (`.env`, `.git/`) and survives malformed URLs.
- A warning when `--save-auth` writes a session file that git would commit.

### Added

- Keyboard reachability of composite widgets: tab lists, radio groups, list boxes, menu bars and trees whose arrow
  keys do not reach the other items are reported (WCAG 2.1.1).
- `journeys run --repeat N`: flaky journeys (mixed outcomes) are reported for review.
- Lab metrics keep their range with `--runs`; `compare`/`verify` give every metric change a verdict (improved,
  regressed, within noise, unconfirmed), and `verify` repeats the baseline's number of visits.
- Reports: network guard refusals and security events, journey attempts and stopped requests, and the WCAG 2.2
  questions that still need a person.
- Laravel discovery follows included route files, groups and prefixes, Livewire/Inertia/Volt pages, Filament panels
  (nested resources, `$slug`) and guards.
- Independent benchmark on the W3C ACT Rules test cases (`benchmarks/act`); clean-install smoke test of the packed
  tarball on Linux, macOS and Windows (`scripts/smoke-pack.mjs`).

### Fixed (found on real applications)

- In-page anchors (skip links with non-English targets, section navigation) were operated as lightbox triggers and
  reported as broken dialogs.
- A layer that a dialog leaves on the page after closing made the dialog look "still open" after Escape.
- A local build with a production sitemap was crawled to 2 pages; a build without a page at `/` was reported as
  broken.
- A sign-up journey was suggested when only a dashboard route existed.

### Changed

- `optimize --apply` writes fixes as one transaction (backups and hashes first, atomic writes, automatic restore
  after a failure, recovery of interrupted applies) and no longer needs git. **`rollback` never overwrites edits made
  after a change**: such files are reported as conflicts (`--force` restores them after saving the current version).
  Checkpoint rollbacks keep the overwritten versions and can be undone. `rollback latest` skips rollbacks.
- `--allow-submit` in audits now means "really send the empty submission", on local hosts too.
- Writes cannot escape the repository through symlinked directories; files that are not UTF-8 are never rewritten.

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
