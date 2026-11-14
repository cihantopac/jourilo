# Jourilo 1.5.0

## 1.5.0 (2026-11-14)

A minor release that closes the deferred minors of 1.3.0 and 1.4.0 and field item F43
([FIELD-FEEDBACK.md](FIELD-FEEDBACK.md)). Details are in the [changelog](../CHANGELOG.md). One branch, one commit per
task, no new dependency.

- **Vocabulary and discovery:** Italian sorting and browsing controls are no longer refused as financial actions;
  hand-written files with one long line keep their AST routes; code files are read once.
- **Menus and widgets:** banner-shaped popups are closed by one reload in `settle()`; stable trigger tagging; a faster
  disclosure loop.
- **Capture:** contrast sampling has a 15 s budget per capture and no longer scrolls to nodes already in view; the
  manifest marks a bundled axe version.
- **Network:** `--proxy` tunnels try every allowed address; clearer proxy and certificate errors; `verify --allow-hosts ""`
  drops the baseline list.
- **Journeys:** prompt hop aborts, cookie and Referer edge cases.
- **Experiments:** a sequential stop needs 100 visitors and 5 conversions per arm (`enoughData`); `--allow-private` for
  self-hosted PostHog and GrowthBook on a LAN.
- **Reports:** per-page compare of collapsed findings (`pageOccurrences`), steadier trends, fixer evidence, dismissals
  that carry across a collapse.
- **F43:** a warning when the workspace is inside the audited `--repo`.

`RUN_SCHEMA_VERSION` stays 1; new fields (`pageOccurrences`, dismissal `pages`, `axe.bundled`) are optional.

### Evidence (2026-11-14, macOS 27, Node 22.23, Playwright 1.64.1)

Measured once on the release branch (macOS, Node 22).

| Check                                                                           | Result                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)       | 53 files, 842 tests green (1.4.0: 51 files, 761 tests); one stale progress assertion fixed and re-run |
| Fixture benchmark (`npm run bench`)                                             | 91/91 found, 0 false positives, source location 10/10 (1.4.0: 90/90)                                  |
| Independent W3C ACT benchmark                                                   | not re-run for 1.5.0                                                                                  |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command) | passed, 31 files, 1580 kB                                                                             |
| `claude plugin validate` (marketplace and plugin, strict)                       | passed                                                                                                |

No real-project audit was repeated for 1.5.0. No automated run shows WCAG conformance.

### Not done

Each of these needs a design change or a new dependency, so it was left out on purpose.

- A pathless layout route (`<Route element={<Layout/>}>` without `path`) does not count toward its children's `usedBy`
  (needs a route-model change).
- WebKit: Jourilo's own style refusal and its own exceptions are still told apart from the site's by time window only.
  WebKit gives console messages no source URL and stacks read `undefined:1:32`; it needs a marker in every evaluated
  source.
- Plain-HTTP keep-alive pooling for the direct case (needs a custom `http.Agent` with a checked connect).
- Amplitude: a missing arm of a multi-arm experiment is not detected, because the funnels endpoint never lists
  variants (needs the management API or a `--variants` option).
- The fixer-lab obscured-focus page keeps its `scrollIntoView` handler: a forward Tab never lands focus under a sticky
  top bar, so no realistic page fires the rule.
- `document.referrer` on the final page of a redirect chain still shows the hand-over URL (the browser sets it); the
  Referer header the site receives is fixed.

### Decided, not changed

- The component graph was measured on a large local repository (6000-file index cap, 1569 components): about
  1.3 s and 405 MB peak RSS in total, far under the 10 s threshold, so no cap or cache was added.

- The empty `cookie:` header on proxied navigations stays on purpose: omitting it makes Playwright's `route.fetch` add
  every cookie of the context.

### Known limitations (1.5.0)

The full list is in [LIMITATIONS.md](LIMITATIONS.md). The analytics adapters were tested on responses synthesized from
each vendor's documentation, not on live accounts.
