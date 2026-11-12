# Jourilo 1.2.1 and 1.2.0

## 1.2.1 (2026-11-12)

A patch release from a second field report on the container adapter (F19-F40 in [FIELD-FEEDBACK.md](FIELD-FEEDBACK.md)).
Details are in the [changelog](../CHANGELOG.md).

- **Fewer false positives** on modern front ends: dev-server overlays and boxless focus stops, `aria-hidden` contrast
  glyphs, fieldsets named by ARIA, dialog focus guards, overflow without a located element (now a review item).
- **`--deny-local` / `JOURILO_DENY_LOCAL`** refuses local targets, redirects and subresources for integrations that
  audit on behalf of others. It fails closed and is refused with WebKit.
- **Automation edges:** bounded `--max-duration`, a used `--run-id` directory is refused, a second stop signal leaves
  a line, `--pages 0` and a non-URL `verify --target` are usage errors, unresolvable `*.test` names fail fast.
- **Crawl:** the start URL keeps its trailing slash and is checked against robots.txt.
- **Upgrade note:** findings on explicitly requested slash URLs get new fingerprints once (see the changelog).

`RUN_SCHEMA_VERSION` stays 1. No new runtime dependencies.

### Evidence (2026-11-12, macOS 27, Node 22.23, Playwright 1.64.1)

| Check                                                                              | Result                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)          | pass, 32 files, 357 tests (1.2.0: 31 files, 295 tests)                                                                       |
| Fixture benchmark (`npm run bench`)                                                | 52 / 52 found (1.2.0: 47 / 47; 5 new must-find items from the new fixture pages), 0 false positives, source location 10 / 10 |
| Independent W3C ACT benchmark, precision / recall / false positives                | 93.9 % / 55.4 % / 11 (1.2.0: 93.9 % / 55.4 % / 11), measured on a8a0a6e, `evaluation/act-2026-11-12.md`                      |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command)    | pass                                                                                                                         |
| `claude plugin validate` (marketplace and plugin, strict)                          | pass                                                                                                                         |
| Real project (cihanca.com a49b46a, read-only, day clock, `--evidence minimal`), F1 | still found: `jourilo/focus-obscured`, covered by `#kepenk`                                                                  |
| — F3                                                                               | still gone: 0 dialog findings                                                                                                |
| — F5                                                                               | still locates `app/globals.css:351`                                                                                          |
| — fingerprints compared with the 1.2.0 notes                                       | identical                                                                                                                    |
| — F24 under `next dev`                                                             | 1.2.1 reports no `nextjs-portal` stop; 1.2.0 on the same server did                                                          |

No automated run shows WCAG conformance.

### Known limitations (1.2.1)

- WebKit HTTPS redirects to loopback are still only detected, not prevented; `--deny-local` is refused with WebKit.
- The dialog focus-guard wait is about 4 frames and at most 250 ms; the cap is checked inside `requestAnimationFrame`.
- Failed-navigation URLs are redacted as text, not as URLs: a token in a failing target URL can appear in the
  `page-unreachable` text. Planned for 1.3.0, with the Turkish capitals in the in-page probe lexicon and the report
  falling back to `foldScreenshot`.
- The 1.2.0 limitations below still apply, except the 1.2.x parked items, which are fixed.

---

## 1.2.0

**Walk every journey. Find the friction. Prove the fix.**

1.2.0 is the first release driven by field feedback: a portfolio site audited with 1.1.0 and a container adapter
(Frameva) that ran it as a job. It finds a defect 1.1.0 missed, drops three false positives, lets you set the state
before an audit, and makes runs predictable for automation. The items are F1–F23 in
[FIELD-FEEDBACK.md](FIELD-FEEDBACK.md); what is not in this release is on the [roadmap](ROADMAP.md).

## What is new

- **Fewer misses and false positives.** Focus hidden behind any opaque content is reported (WCAG 2.4.11); an
  `aria-expanded` + `aria-controls` disclosure is no longer reported as a dialog; findings about states point at the
  CSS rule that styles the state.
- **Set the state before an audit.** `--timezone`, `--clock` (freezes `Date`) and `--setup-journey` (a journey runs
  first, the audit starts from its cookies and `localStorage`). `verify` replays all three.
- **Triage.** `finding dismiss <id> --reason …` keeps a false positive out of later runs without deleting evidence
  (D18).
- **Journeys.** Covered click targets are explained and worked around; `journeys suggest` also suggests disclosure
  and toggle journeys.
- **Lighter evidence.** `--evidence minimal` keeps first screens and the screenshots findings need.
- **Automation.** Exit 5 (no page loaded) and exit 6 (stopped early, partial run), `--max-duration`, JSON progress,
  `manifest.json` with sha256 per artifact, `--run-id`, a published run schema and a compatibility policy.
- **Docs.** Every implemented flag is in the CLI reference.

`RUN_SCHEMA_VERSION` stays 1; new fields are optional and old runs still load. No new runtime dependencies.

## Evidence (2026-11-03, macOS 27, Node 22.23, Playwright 1.64.1)

Measured on release/1.2.0 on 2026-11-03; the ACT run is on the 1.2.0 engine before the version bump (`docs/evaluation/act-2026-11-03.md`).

| Check                                                                              | Result                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)          | pass, 31 files, 295 tests (1.1.0: 24 files, 236 tests)                                                      |
| Fixture benchmark (`npm run bench`)                                                | 47 / 47 found (1.1.0: 45 / 45; new: overlay-lab, pressed tools), 0 false positives, source location 10 / 10 |
| Independent W3C ACT benchmark, precision                                           | 93.9 % (1.0.0: 93.9 %)                                                                                      |
| Independent W3C ACT benchmark, recall                                              | 55.4 % (1.0.0: 55.4 %)                                                                                      |
| Independent W3C ACT benchmark, false positives                                     | 11 (1.0.0: 11)                                                                                              |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command)    | pass                                                                                                        |
| `claude plugin validate` (marketplace and plugin, strict)                          | pass                                                                                                        |
| Real project (cihanca.com, read-only), F1: focus hidden behind the shutter         | found: `jourilo/focus-obscured` on the three `.goods` links, "covered by `#kepenk`" (day clock)             |
| — F3: the three disclosure false positives                                         | gone: no dialog findings by day, by night or with minimal evidence                                          |
| — F5: contrast and state findings locate `globals.css`                             | yes: the pressed-tool focus finding lists `app/globals.css:351` first (high)                                |
| — evidence size, `--evidence minimal` vs the 1.1.0 runs (about 38 MB for two runs) | 1.24 MB → 0.72 MB per run (−41 %; one page × two viewports, not comparable with the 1.1.0 runs)             |
| Frameva adapter checks (F11–F13)                                                   | not yet; the measured 1.1.0 report confirmed F11 and F12, both fixed here                                   |

No automated run shows WCAG conformance; every report lists what still needs a person.

## Known limitations

- In-memory state left by a setup journey does not carry over; only cookies and `localStorage` do.
- `--clock` freezes only `Date`; timers keep running.
- A `pointer-events: none` overlay can still hide focus without being reported.
- `--evidence minimal` keeps only the first screen of pages with no finding on the full page.
- With `journeys run --repeat`, step files are shared across attempts.
- Parked for 1.2.x: the `verify --target` typo error, setup-state removal when the browser guard fails to close,
  the attempt index in `--repeat` file names, Turkish uppercase folding in the toggle lexicon, and a `--run-id`
  directory left by a crashed run.

See [LIMITATIONS.md](LIMITATIONS.md) for the full list.
