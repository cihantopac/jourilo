# Jourilo 1.2.0 — release notes and evidence

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
