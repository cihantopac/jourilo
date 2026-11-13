# Jourilo 1.4.0

## 1.4.0 (2026-11-14)

A minor release that works through the "Next (1.x)" list of 1.3.0 and closes two field items (F42 and F44 in
[FIELD-FEEDBACK.md](FIELD-FEEDBACK.md)). Details are in the [changelog](../CHANGELOG.md).

- **Menus:** the menu-button keys of the APG pattern are checked (arrows, Home/End, Escape, focus return) without ever
  activating an item.
- **Discovery:** routes of TS, TSX, Vue and Svelte projects are read from the syntax tree with a bundled TypeScript
  6.0.3 parser in a lazy chunk (`plugin/dist/ts-parser.mjs`, [DECISIONS.md](DECISIONS.md) D21); a file it cannot read
  falls back to the regex with a limitation.
- **Root causes:** a component graph groups a cause in a shared component, with the source lines of every member.
- **Fixers:** `type="button"` (`jourilo/button-implicit-submit`) and `scroll-padding` (`jourilo/focus-obscured`).
- **Trends:** `jourilo runs trend` and a trend table in the report, normalized per page, viewport and capture.
- **Experiments:** read-only PostHog, GrowthBook and Amplitude adapters (`--from`, keys from the environment only, D22)
  and sequential testing (mSPRT, `--sequential`, `--fixed`, `--tau`, D23).
- **Journeys:** multi-tab steps and OAuth popups against test identity providers; every redirect hop is checked
  against `--allow-origin`, and cookies follow SameSite and RFC 6265 on proxied navigations.
- **Languages:** Italian, Portuguese and Dutch vocabulary; Turkish rule texts in the report (axe-core help stays
  English, because axe-core ships no Turkish locale).
- **F44:** findings that differ only in volatile tokens collapse into one finding with `pages`; axe-core runs under a
  strict CSP and Jourilo's own injections are no longer reported as site errors.
- **F42:** a run where every page's own scripts fail says it looks like a stale server; the plugin checks the port
  before it starts a dev server.
- **Network guard:** every resolved address is tried, so `localhost` works on `::1` and on `127.0.0.1`.
- **Upgrade notes:** journeys proxy top-level navigations through Node (timings include it, `goto` reports 200 for a
  redirect, 307/308 non-urlencoded bodies are blocked); a stopped navigation between steps blocks the next step;
  `--metric`, `--start`, `--end` and `--control-key` without `--from` are a usage error; the sequential `--from` JSON has
  no `z`, `significant` or `ci*`; collapsed findings have new fingerprints, so a dismissal does not carry over; the axe
  limitation wording changed. See the changelog.

`RUN_SCHEMA_VERSION` stays 1; new fields are optional. One new bundled dependency (the TypeScript parser, in a lazy
chunk).

### Evidence (2026-11-14, macOS 27, Node 22.23, Playwright 1.64.1)

Measured once on the release branch (macOS, Node 22).

| Check                                                                           | Result                                                                                                                 |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)       | 51 files, 761 tests green (1.3.0: 38 files, 468 tests)                                                                 |
| Fixture benchmark (`npm run bench`)                                             | 90 / 90 found (1.3.0: 56 / 56; 34 new must-find items), 0 false positives, source location 10 / 10, 362 s              |
| Independent W3C ACT benchmark                                                   | not re-run for 1.4.0; the 1.3.0 numbers (93.4 % / 56.1 % / 12 false positives) stand for the rules that did not change |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command) | passed: `jourilo-1.4.0.tgz`, 31 files, 1575 kB, every command run from a clean install (includes `ts-parser.mjs`)      |
| `claude plugin validate` (marketplace and plugin, strict)                       | passed                                                                                                                 |
| Sequential test, false stops at alpha 0.05 (A/A, small samples, large `--tau`)  | 0.2 to 4.4 % over repeated probes with the max-variance form (the plug-in variance gave 12 to 13.6 %); power 300 / 300 |

No real-project audit was repeated for 1.4.0. No automated run shows WCAG conformance.

### Known limitations (1.4.0)

- The analytics adapters were tested on responses synthesized from each vendor's documentation, not on live accounts.
  Amplitude cannot detect a missing third arm of a multi-arm experiment.
- The sequential test has no history between runs: each `analyze` is one look. An arm with almost no visitors can give
  a far too small p-value (the decision stays correct).
- Journeys proxy top-level navigations: timings include the hop, and where a browser's cookie decision cannot be
  reproduced the cookie is withheld. In Chromium, a navigation that another window or frame started without a Referer
  is judged by the tab's own page.
- `--proxy` opens its tunnel to the first allowed address of a name only.
- Numeric query values of 8 or more digits and runs of 10 or more digits count as volatile, so a real identifier of
  that shape can collapse findings that differ only in it.
- In WebKit, Jourilo's own style refusal during a screenshot is dropped only by time window, and an exception from its
  own code cannot be told from the site's.
- axe-core help is English in a Turkish report. The first Turkish rule texts are for a fluent reader to review.
- The 1.3.0 limitations still apply, except the one for per-page findings with a volatile token (F44), which is fixed.
  The full list is in [LIMITATIONS.md](LIMITATIONS.md).
