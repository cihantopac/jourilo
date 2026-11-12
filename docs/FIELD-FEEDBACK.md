# Field feedback

Experience reports from using Jourilo on real projects. Items are triaged against the code when they arrive and
recurrences are counted; each release plan is made from the whole list at once. F1–F23 came from 1.1.0 and drove 1.2.0;
F24–F41 came from 1.2.0 and drove 1.2.1 and 1.3.0; F42–F44 came on 2026-11-12.

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
| F24 | Frameva     | Keyboard      | `jourilo/focus-visible` reports the zero-size `next dev` overlay (`nextjs-portal`) as serious, high confidence     | Bug               |
| F25 | Frameva     | Contrast      | `axe-review/color-contrast` lists `aria-hidden` decorative glyphs (11–25 items per page)                           | Bug               |
| F26 | Frameva     | Automation    | No machine-readable rule registry (`rules list --json`)                                                            | Feature           |
| F27 | Frameva     | Structure     | `jourilo/fieldset-legend` reports a fieldset named by `aria-label` / `aria-labelledby`                             | Bug               |
| F28 | Frameva     | Run outcome   | A redirect loop is reported as a critical "Page failed to load" without the redirect chain                         | Bug               |
| F29 | Frameva     | Performance   | No budgets as arguments (`--budget LCP=2000,CLS=0.05`)                                                             | Feature           |
| F30 | Frameva     | Widgets       | `dialog-focus-containment` reads a dialog library's focus guard before it wraps (3 false positives)                | Bug               |
| F31 | Frameva     | Run setup     | No `--wait-for <selector>`; a client-rendered page is captured while loading                                       | Feature           |
| F32 | Frameva     | Automation    | `--max-duration` waits for the current page (20 s took 25.9 s); values above ~2 147 483 s stop at once             | Bug               |
| F33 | Frameva     | Automation    | `--run-id` reuses an existing directory that has no `run.json` (old screenshots mix in)                            | Bug               |
| F34 | Frameva     | Automation    | An unresolvable `*.test` name waits for the full 30 s navigation timeout                                           | Bug               |
| F35 | Frameva     | Automation    | Progress lines have no `phase` / `done` / `total`; `manifest.json` has no tool, browser, axe versions or scope     | Feature           |
| F36 | Frameva     | Evidence      | Snapshot instability: perf evidence items differ by milliseconds, CLS depends on font loading                      | Feature           |
| F37 | Frameva     | Layout        | `horizontal-overflow` can be reported with zero evidence elements                                                  | Bug               |
| F38 | Frameva     | Evidence      | Screenshot file names depend on the audited origin (host and port)                                                 | Feature           |
| F39 | Frameva     | Evidence      | With `--evidence minimal`, a consumer cannot tell which file is a page's first screen                              | Bug               |
| F40 | Frameva     | Automation    | A second stop signal exits 130 with no trace (no line, no run)                                                     | Bug               |
| F41 | Frameva     | Run setup     | No way to preload `localStorage` / `sessionStorage` for an audit                                                   | Partly (see note) |
| F42 | Frameva     | Run setup     | A stale dev server on the target port answered 500 for every chunk; reported as site defects                       | Gap               |
| F43 | Frameva     | Run output    | With `--repo`, `.jourilo` inside the audited repository tripped its own non-git conformance check                  | Partly (see note) |
| F44 | Frameva     | Findings      | One cause (a CSP-blocked script) came back as 8 console-error and 8 failed-request findings, one per page          | Gap               |

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
- **Frameva after 1.2.0 (2026-11-04 to 2026-11-09)** — Frameva adopted 1.2.0 on release day and audited its own
  screens with it (`frameva/docs/tool-feedback/jourilo/2026-11-04-*` to `2026-11-09-*`, backlog JOURILO-016..031).
  Verified fixed: F11, F12, F13, F14, F18; `run.schema.json` agrees with Frameva's strict schema on 18 runs and 18
  manifests; 34 of 35 fingerprints equal 1.1.0 (the difference is the intended F11 change). F1, F3 and F7 could not be
  checked there (no such elements). F19–F23 were measured again and are still open.
- **F24** — The Tab walk ends on `body > script > nextjs-portal`, a 0 × 0 element. A stop without a box cannot show an
  indicator and is not page content; skip zero-area stops and known dev overlays (`nextjs-portal`,
  `vite-error-overlay`). Five reports; it fails a `--fail-on serious` gate on every `next dev` page (JOURILO-024).
- **F25** — axe returns "incomplete" for glyphs in a fallback font inside `aria-hidden` spans. Nodes inside an
  `aria-hidden="true"` subtree are not presented to assistive technology and are not read as text by the people the
  rule protects; drop them from the review list (JOURILO-025). The sticky-column cause in the same report is a real
  axe limitation and stays.
- **F27** — The probe accepts only a `<legend>`; a `fieldset` with a non-empty `aria-label` or a resolvable
  `aria-labelledby` has a group name (JOURILO-027).
- **F28** — Chromium ends a redirect loop with `ERR_TOO_MANY_REDIRECTS`; the finding should name the loop, the status
  chain and the final URL (JOURILO-028).
- **F30** — Base UI, Radix, React Aria and Headless UI park focus on an empty sentinel for a tick before wrapping. Wait
  until the active element is stable before judging, and do not count a sentinel (no text, `aria-hidden` or a
  `data-*focus-guard*` attribute) as an escape (JOURILO-030).
- **F32** — The stop is cooperative by design (1.2.0 task 9); the limit should still be kept within a few seconds by
  abandoning the page in progress, and out-of-range values must be a usage error (JOURILO-020).
- **F34** — 30.4 s to exit 5 for a `.test` name in a container; the name is classed `local` without a lookup
  (JOURILO-022).
- **F39** — Under `--evidence minimal`, a page that fits in one screen keeps a single file used as both first screen
  and full page (1.2.0 ruling), named like a full-page shot; `run.json` does not say which file is the first screen, so
  Frameva counted 1 of 19. Record it.
- **F40** — Found while measuring F12; the second signal should at least print one line (JSON with `--json`).
- **F41** — `--setup-journey` can set storage through the page, and `--auth` loads a Playwright storage state that
  includes `localStorage`; a direct preload flag is not planned.
- **F42** — 2026-11-12, on 1.1.0: a second run hit an older `next-server` still holding the port, so every chunk
  answered 500 and each was reported as a defect of the site. Jourilo does not start the server (the caller or the
  plugin does), so it cannot tell a stale one from the right one. Proposed: when every page fails the same way (all of
  its own-origin scripts answer 5xx), write one limitation line that suggests a stale server, instead of one finding
  per page; and have the plugin check that the port is free before it starts a dev server.
- **F43** — 2026-11-12, on 1.1.0: the run directory follows the working directory (or `--workspace` /
  `JOURILO_WORKSPACE`), and `.jourilo/.gitignore` with `*` has kept it out of git since 1.0. A conformance check that
  does not use git still sees it. Open: say in the docs how to put runs outside the audited repository, and consider a
  warning when the workspace is inside `--repo`.
- **F44** — 2026-11-12, on 1.2.1 as Frameva's production engine on frameva.io: a real defect (Cloudflare's e-mail
  obfuscation decoder blocked by the site's CSP, giving a console error, React error #418 and a failed request on
  every page) came back as 8 console-error and 8 failed-request findings whose evidence differed only by the CSP
  nonce. Proposed: collapse findings whose evidence differs only in volatile tokens into one finding with a list of
  affected URLs. Needs its own fixture and review, so it is not in 1.3.0.
- **F27 again** — the same report (on 1.1.0) found the `aria-label` fieldset false positive; fixed in 1.2.1.
- **F27 in the field** — the 2026-11-12 Frameva report on 1.2.1 confirms the fix.
- **F26, F29, F31, F35, F36, F38** — Features for 1.3.0.
- **F37** — Decided: without a located element the finding becomes a low-confidence review item.

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

## Status after 1.2.0

Every open item is planned: 1.2.1 in [its plan](superpowers/plans/2026-11-11-jourilo-1.2.1.md), 1.3.0 in
[its plan](superpowers/plans/2026-11-11-jourilo-1.3.0.md). Decisions by Cihan on 2026-11-11: F19 becomes an opt-in deny,
F37 becomes a review item when no element is located, F20 ships in full in 1.2.1, and F21 is an opt-in in 1.3.0.

| #   | Status                                               |
| --- | ---------------------------------------------------- |
| F8  | 1.3.0                                                |
| F15 | 1.3.0                                                |
| F16 | 1.3.0 (`--output-dir` is the existing `--workspace`) |
| F19 | 1.2.1 (task 9), opt-in `--deny-local`                |
| F20 | 1.2.1 (task 8)                                       |
| F21 | 1.3.0, opt-in                                        |
| F22 | `--pages 0` in 1.2.1 (task 10); the rest in 1.3.0    |
| F23 | Redirect loop in 1.2.1 (task 6); the rest in 1.3.0   |
| F24 | 1.2.1 (task 1)                                       |
| F25 | 1.2.1 (task 4)                                       |
| F26 | 1.3.0                                                |
| F27 | 1.2.1 (task 3)                                       |
| F28 | 1.2.1 (task 6)                                       |
| F29 | 1.3.0                                                |
| F30 | 1.2.1 (task 2)                                       |
| F31 | 1.3.0                                                |
| F32 | 1.2.1 (task 10)                                      |
| F33 | 1.2.1 (task 10)                                      |
| F34 | 1.2.1 (task 7)                                       |
| F35 | 1.3.0                                                |
| F36 | 1.3.0                                                |
| F37 | 1.2.1 (task 5)                                       |
| F38 | 1.3.0                                                |
| F39 | 1.2.1 (task 11)                                      |
| F40 | 1.2.1 (task 10)                                      |
| F41 | Covered by `--setup-journey` and `--auth`            |

## Status after 1.2.1

Done in 1.2.1 unless a row says otherwise; the rest is planned for 1.3.0
([plan](superpowers/plans/2026-11-11-jourilo-1.3.0.md)). F10 stays declined (D3).

| #   | Status                                                                                         |
| --- | ---------------------------------------------------------------------------------------------- |
| F8  | 1.3.0                                                                                          |
| F15 | 1.3.0                                                                                          |
| F16 | 1.3.0 (`--output-dir` is the existing `--workspace`)                                           |
| F19 | Done: opt-in `--deny-local` / `JOURILO_DENY_LOCAL` (fail-closed; refused with WebKit)          |
| F20 | Done: trailing slash kept, explicit start URL checked against robots.txt                       |
| F21 | 1.3.0, opt-in                                                                                  |
| F22 | `--pages 0` is a usage error (done); pages vs captures and the truncation signal in 1.3.0      |
| F23 | Redirect loop explained with its chain (done); long chains and start-independent trap in 1.3.0 |
| F24 | Done: boxless stops and dev-server overlays skipped                                            |
| F25 | Done: `aria-hidden` content left out of contrast review                                        |
| F26 | 1.3.0                                                                                          |
| F27 | Done: `aria-label` / `aria-labelledby` name a fieldset                                         |
| F28 | Done: redirect loop shows the status chain                                                     |
| F29 | 1.3.0                                                                                          |
| F30 | Done: dialog focus guard wait (about 4 frames, at most 250 ms)                                 |
| F31 | 1.3.0                                                                                          |
| F32 | Done: `--max-duration` bounded and kept near the limit                                         |
| F33 | Done: a used `--run-id` directory is refused                                                   |
| F34 | Done: unresolvable `*.test` names fail fast                                                    |
| F35 | 1.3.0                                                                                          |
| F36 | 1.3.0                                                                                          |
| F37 | Done: overflow without a located element is a needs-review item                                |
| F38 | 1.3.0                                                                                          |
| F39 | Done: `foldScreenshot` in `run.json`                                                           |
| F40 | Done: a second stop signal prints a line                                                       |
| F41 | Covered by `--setup-journey` and `--auth`                                                      |
| F42 | Triaged 2026-11-12; release not decided                                                        |
| F43 | Triaged 2026-11-12; release not decided                                                        |

## Status after 1.3.0

Done in 1.3.0 ([plan](superpowers/plans/2026-11-11-jourilo-1.3.0.md), [RELEASE-1.3.md](RELEASE-1.3.md)) unless a row
says otherwise. Earlier items are in the tables above; F10 stays declined (D3).

| #   | Status                                                                                    |
| --- | ----------------------------------------------------------------------------------------- |
| F8  | Done: contrast over images decided from rendered pixels (`jourilo/contrast-over-image`)   |
| F15 | Done: `--proxy` / `HTTPS_PROXY` behind the guard, `--allow-hosts`, `--block-hosts`        |
| F16 | Done: `--user-agent`, `--extra-header` (target origin only), `--ignore-https-errors`      |
| F21 | Done: opt-in `--chromium-sandbox`; `browser.pids` for cleanup                             |
| F22 | Done: `summary.urls` and `summary.captures`; `sample` and a limitation for left-out pages |
| F23 | Done: `jourilo/redirect-chain`; keyboard traps found wherever focus starts                |
| F26 | Done: `rules list --json`                                                                 |
| F29 | Done: `--budget`                                                                          |
| F31 | Done: `--wait-for` and `pages[].load`                                                     |
| F35 | Done: progress `phase` / `done` / `total`; versions and scope in `manifest.json`          |
| F36 | Done: one rounded evidence item per metric and viewport; CLS variance documented          |
| F38 | Done: screenshot names from path and query, not origin                                    |
| F42 | Open: intake for 1.4.0, not yet decided                                                   |
| F43 | Documented: `--workspace` outside the audited repository ([WORKFLOW.md](WORKFLOW.md))     |
| F44 | Open: intake for 1.4.0, not yet decided                                                   |

## Recurrence

Count each project that reports the same item again here; recurrence decides priority in each release plan.

| Item | Projects                              |
| ---- | ------------------------------------- |
| F1   | cihanca.com                           |
| F2   | cihanca.com, Frameva (`--timezone`)   |
| F3   | cihanca.com                           |
| F4   | cihanca.com                           |
| F5   | cihanca.com                           |
| F6   | cihanca.com                           |
| F7   | cihanca.com                           |
| F8   | cihanca.com                           |
| F9   | cihanca.com                           |
| F10  | cihanca.com                           |
| F11  | Frameva (planning, then measured)     |
| F12  | Frameva (planning, then measured)     |
| F13  | Frameva                               |
| F14  | Frameva                               |
| F15  | Frameva                               |
| F16  | Frameva                               |
| F17  | Frameva                               |
| F18  | Frameva (planning, then measured)     |
| F19  | Frameva (measured on 1.1.0 and 1.2.0) |
| F20  | Frameva (measured on 1.1.0 and 1.2.0) |
| F21  | Frameva (measured on 1.1.0 and 1.2.0) |
| F22  | Frameva (measured on 1.1.0 and 1.2.0) |
| F23  | Frameva (measured on 1.1.0 and 1.2.0) |
| F24  | Frameva (5 reports)                   |
| F25  | Frameva (2 reports)                   |
| F26  | Frameva                               |
| F27  | Frameva (2 reports; fix confirmed)    |
| F28  | Frameva                               |
| F29  | Frameva                               |
| F30  | Frameva                               |
| F31  | Frameva                               |
| F32  | Frameva                               |
| F33  | Frameva                               |
| F34  | Frameva                               |
| F35  | Frameva                               |
| F36  | Frameva                               |
| F37  | Frameva                               |
| F38  | Frameva                               |
| F39  | Frameva                               |
| F40  | Frameva                               |
| F41  | Frameva                               |
| F42  | Frameva                               |
| F43  | Frameva                               |
| F44  | Frameva (frameva.io, 1.2.1)           |
