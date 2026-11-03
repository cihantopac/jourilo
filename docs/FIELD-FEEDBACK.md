# Field feedback for 1.2.0

Experience reports from using Jourilo 1.1.0 on real projects, collected before 1.2.0 is planned. Nothing here is
scheduled yet: items are triaged against the code when they arrive, recurrences are counted, and the 1.2.0 plan is made
from the whole list at once.

## How to report

One entry per problem, in this shape:

- **What happened** — command, flags, target, and what Jourilo did or reported.
- **What was expected** — and why (WCAG criterion, the real state of the page, a manual check).
- **Evidence** — run id, finding ids, screenshot or report path, repository and branch.
- **Impact** — missed defect, false positive, wrong location, failed run, friction, or a missing capability.

## Intake

| #   | Project     | Area          | Summary                                                                                                            | Verdict           |
| --- | ----------- | ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------- |
| F1  | cihanca.com | Keyboard      | Focus hidden behind a non-fixed overlay (a half-closed shutter) not reported (2.4.11)                              | Bug               |
| F2  | cihanca.com | Run setup     | No way to set the state before auditing: `--timezone`, `--clock`, `--setup-journey`                                | Feature           |
| F3  | cihanca.com | Widgets       | `aria-expanded` + `aria-controls` disclosure reported as a dialog (3 false positives)                              | Bug               |
| F4  | cihanca.com | Triage        | A false positive cannot be dismissed; it comes back on every run                                                   | Feature           |
| F5  | cihanca.com | Source locate | Located `page.tsx:37` instead of the CSS rule `globals.css .tool[aria-pressed]`                                    | Bug               |
| F6  | cihanca.com | Journeys      | `journeys suggest` suggested nothing on a page made of toggles and disclosures                                     | Feature           |
| F7  | cihanca.com | Journeys      | Clicking a covered target times out ("Timeout 10000ms exceeded") without saying why                                | Bug               |
| F8  | cihanca.com | Contrast      | axe `color-contrast` incomplete on 47–59 nodes; pixel sampling could decide many                                   | Feature (large)   |
| F9  | cihanca.com | Evidence      | About 38 MB of evidence for two runs; a light evidence mode is wanted                                              | Feature           |
| F10 | cihanca.com | Report        | Wants an overall score for "where do we stand"                                                                     | Declined (D3)     |
| F11 | Frameva     | Automation    | An unresolvable host is classed as public; the run ends with exit 0 and a finding                                  | Bug               |
| F12 | Frameva     | Automation    | SIGTERM leaves no `run.json`; no `--max-duration` with partial results; free-text progress                         | Feature           |
| F13 | Frameva     | Automation    | No `manifest.json` with sha256 per artifact, no `--run-id` for idempotent runs                                     | Feature           |
| F14 | Frameva     | Automation    | No published JSON Schema for `run.json` and no additive-change policy for schemaVersion                            | Feature           |
| F15 | Frameva     | Network       | No upstream proxy chaining behind the guard; no `--allow-hosts` / `--block-hosts`                                  | Feature           |
| F16 | Frameva     | Run setup     | No `--user-agent`, `--extra-header`, `--ignore-https-errors`; no `--output-dir`                                    | Feature           |
| F17 | Frameva     | Run setup     | Audits cannot get past cookie walls; only journeys can                                                             | Partly (see note) |
| F18 | Frameva     | Docs          | Implemented flags missing from docs/CLI.md: `--timeout`, `--locale`, `--headed`, `report --stdout`, journeys flags | Bug               |
| F19 | Frameva     | Network       | Loopback targets (`localhost`, `127.0.0.1`, `[::1]`) are audited with no flag; only private ranges exit 3          | Needs decision    |
| F20 | Frameva     | Crawl         | The start URL ignores robots.txt, and trailing-slash normalisation audited `/staff/` as `/staff` (a 404)           | Bug               |
| F21 | Frameva     | Browser       | Chromium always runs with `--no-sandbox` and outside Jourilo's process group                                       | Feature           |
| F22 | Frameva     | Report        | `summary.pages` counts captures; no signal when pages are left out of a sample; `--pages 0` silently becomes 1     | Bug               |
| F23 | Frameva     | Detection     | A redirect chain gives no finding; a keyboard trap is found only with focusable elements outside it                | Feature           |

## Notes per item

- **F1** — `src/browser/keyboard.ts` samples five points with `elementFromPoint`, but only counts a cover whose element
  or ancestor is `fixed`/`sticky`. Any opaque, hit-testable element that is not the focused element or its descendant
  should count. Needs a fixture with an in-flow overlay and a control with a translucent one.
- **F2** — Playwright offers `timezoneId` and `page.clock`. A setup journey (run before every page) covers theme, night
  mode, consent and signed-in states in general.
- **F3** — `src/browser/widgets.ts` tests "a dialog appeared" before the disclosure branch, so any overlay that becomes
  visible wins. A trigger with `aria-expanded` and `aria-controls` whose controlled element toggles is a disclosure,
  unless the opened element has `role=dialog`/`alertdialog` or `aria-modal`.
- **F4** — A `finding dismiss <id> --reason` verdict stored by fingerprint and applied to later runs (shown as
  dismissed, never deleted). Relivaro has the same pattern.
- **F5** — The locator does not rank attribute-state selectors (`[aria-pressed]`, `[aria-expanded]`, `[data-state]`)
  when the finding is about a state.
- **F6** — Suggestions come only from calls to action and forms. Add interaction journeys for `aria-expanded` /
  `aria-pressed` controls (open, check the state, close).
- **F7** — On a click timeout, report the element on top at the target's center and try the visible part of the target.
- **F8** — Sample the rendered pixels behind the text for axe "incomplete" contrast nodes. Engine change; needs a
  benchmark rerun.
- **F9** — `--evidence minimal`: first-screen shots plus screenshots of failing steps and findings only.
- **F10** — Kept out on purpose (DECISIONS D3). The report lede and the short agent answer already give a one-line status;
  consider making that line more explicit instead.
- **F11–F18 (Frameva)** — From a planning study of the code and docs for a one-job-per-container adapter, not from a
  run yet (backlog JOURILO-001..011 in the Frameva repository, `docs/tool-feedback/BACKLOG.md`). A measured report is
  promised after the first real run.
- **F11** — `src/core/url-safety.ts` returns `public` when DNS lookup fails, so the browser's navigation error becomes a
  finding and the command exits 0. Needs a distinct outcome (`NAVIGATION_FAILED`) and a non-zero exit when no page loaded.
- **F12** — No SIGTERM/SIGINT handler finalizes the run. A signal or a time budget should write `run.json` marked
  partial; progress could be JSON lines on stderr with `--json`.
- **F15** — `src/core/net-guard.ts` connects to the resolved address directly; chaining to a corporate or sandbox proxy
  needs care so the guard still checks the final destination.
- **F16** — `--timezone` from the same request is counted under F2. `ignoreHTTPSErrors` is hard-coded to false in
  `src/browser/capture.ts`; an opt-in flag should be shown in the report's limits.
- **F17** — `audit --auth <storage-state>` already exists, so a saved consent state works. A consent click before each
  page is the setup journey of F2.
- **F18** — The generated reference does not list these flags; check the generator against every command's options.
- **Frameva measured report (2026-11-03)** — 12 real runs of 1.1.0 on a local fixture site with planted issues, plus an
  image check in GitHub Actions (`frameva/docs/tool-feedback/jourilo/2026-11-03-m1-a-06-fixture-runs.md`). It confirms
  F11 (plain-http DNS failure and connection reset reported as an HTTP 502 with exit 0), F12 (SIGTERM: no `run.json`,
  exit 1) and F18 (`--timeout`, `--locale` missing from `--help`). Two runs of the same site had identical fingerprints.
- **F19** — Auditing a local dev server is the main use, so loopback stays allowed by default. An integrator that audits
  on behalf of others needs an opt-in deny (a flag or an environment variable). Decision for after 1.2.0 (JOURILO-012).
- **F20** — The explicit start URL is not checked against robots.txt, and the URL is rewritten without its trailing
  slash (JOURILO-014).
- **F21** — Security-sensitive; needs a sandbox option tested in containers and a documented cleanup (JOURILO-015).
- **F22** — Report pages and captures separately, say how many pages a sample left out, and make `--pages 0` a usage
  error (JOURILO-016).
- **F23** — A redirect-chain finding, and keyboard-trap detection that does not depend on the focus start.

## Status in 1.2.0

Tasks refer to [the 1.2.0 plan](superpowers/plans/2026-11-03-jourilo-1.2.0.md); what shipped is in the
[changelog](../CHANGELOG.md) and [RELEASE-1.2.md](RELEASE-1.2.md). Deferred items are on the
[roadmap](ROADMAP.md#deferred-from-120).

| #   | Status                                                          |
| --- | --------------------------------------------------------------- |
| F1  | Done (task 1)                                                   |
| F2  | Done (tasks 5, 6)                                               |
| F3  | Done (task 2)                                                   |
| F4  | Done (task 7)                                                   |
| F5  | Done (task 3)                                                   |
| F6  | Done (task 13)                                                  |
| F7  | Done (task 4)                                                   |
| F8  | Deferred (roadmap F8)                                           |
| F9  | Done (task 12)                                                  |
| F10 | Declined (D3)                                                   |
| F11 | Done (task 8)                                                   |
| F12 | Done (task 9)                                                   |
| F13 | Done (task 10)                                                  |
| F14 | Done (task 11)                                                  |
| F15 | Deferred (roadmap F15)                                          |
| F16 | Partly: `--timezone` done (task 5); rest deferred (roadmap F16) |
| F17 | Covered by `--auth` and `--setup-journey` (task 6)              |
| F18 | Done (task 14)                                                  |
| F19 | Deferred, needs a decision (roadmap F19)                        |
| F20 | Deferred (roadmap F20)                                          |
| F21 | Deferred (roadmap F21)                                          |
| F22 | Deferred (roadmap F22)                                          |
| F23 | Deferred (roadmap F23)                                          |

## Recurrence

Count each project that reports the same item again here; recurrence decides priority in the 1.2.0 plan.

| Item | Projects                            |
| ---- | ----------------------------------- |
| F1   | cihanca.com                         |
| F2   | cihanca.com, Frameva (`--timezone`) |
| F3   | cihanca.com                         |
| F4   | cihanca.com                         |
| F5   | cihanca.com                         |
| F6   | cihanca.com                         |
| F7   | cihanca.com                         |
| F8   | cihanca.com                         |
| F9   | cihanca.com                         |
| F10  | cihanca.com                         |
| F11  | Frameva (planning, then measured)   |
| F12  | Frameva (planning, then measured)   |
| F13  | Frameva                             |
| F14  | Frameva                             |
| F15  | Frameva                             |
| F16  | Frameva                             |
| F17  | Frameva                             |
| F18  | Frameva (planning, then measured)   |
| F19  | Frameva                             |
| F20  | Frameva                             |
| F21  | Frameva                             |
| F22  | Frameva                             |
| F23  | Frameva                             |
