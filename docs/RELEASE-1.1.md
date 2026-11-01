# Jourilo 1.1.0 — release notes and evidence

**Walk every journey. Find the friction. Prove the fix.**

1.1.0 makes the results of Jourilo visual, understandable and actionable. The detection engine is unchanged from
1.0.0; everything here is about the report, the agent experience and the product presentation.

## What is new

- **A redesigned Experience Observatory** in the Daybook identity: compact counts, blocked journeys first, "Fix first"
  cards with the outlined element, verified defects, manual-review items and conversion hypotheses in separate lanes,
  short limitations with details folded away. No overall UX score, on purpose.
- **Root causes, not repetitions**: one card per cause, listing every page and finding id it explains.
- **Journey timelines** with the real screenshot of every step, the step that failed and the goal.
- **Before / after** crops of the same region for every fixed root cause, page pairs and metric verdicts.
- **Repair prompts**: select findings or root causes, then copy or download an editable Markdown prompt for a coding
  agent. It requires source revalidation, minimal changes, regression tests and a Jourilo before/after
  verification. Conversion hypotheses become experiment briefs. The report never executes anything.
- **Fix paths**: automatic fix, agent-assisted, manual review or experiment brief, filterable.
- **English and Turkish** interface and a **Light / Dark / System** theme, following the browser and remembered.
- **Short agent answers** (80–150 words) with the real report path and one next step.
- **README** as a visual product page; a GitHub social preview (`docs/assets/social-preview.png`).

## Evidence (2026-11-01, macOS 27, Node 22.23, Playwright 1.64.1)

| Check                                                                                        | Result                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)                    | pass, 24 files, 236 tests                                                                |
| Fixture benchmark (`npm run bench`)                                                          | 45 / 45 found, 0 false positives, root cause 9 / 9 (unchanged from 1.0.0)                |
| Report QA, 40 scripted checks each in Chromium, Firefox and WebKit                           | 40 / 40 in all three                                                                     |
| — axe-core WCAG 2.2 A/AA on the report (overview, findings, pages, journeys, compare)        | 0 violations, light and dark                                                             |
| — language and theme: browser default, switch, reload, other report                          | persist                                                                                  |
| — keyboard: skip link, arrow-key tabs, Space selects, dialog focus in and back, Escape       | pass                                                                                     |
| — repair prompt: filters, select shown, edit, clipboard (Chromium), Markdown download        | pass; the file contains the edited text                                                  |
| — offline and layout: network requests, page errors, horizontal scroll at 390 px             | none, none, none                                                                         |
| Untrusted content (unit tests)                                                               | page text cannot inject markup or close the data script; prompt markers cannot be forged |
| Demo loop on `fixtures/sites/acme-saas`: audit, journeys, optimize --apply, verify, rollback | 14 fixed, 0 new; rollback restored all 6 files byte-identical                            |
| Real project (maintainer's portfolio, static export, read-only)                              | 8 pages × 2 viewports; report checked in EN/TR, light/dark; repository untouched         |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command)              | pass                                                                                     |
| `claude plugin validate` (marketplace and plugin, strict)                                    | pass                                                                                     |
| Independent W3C ACT benchmark                                                                | not rerun (engine unchanged); 1.0.0 results stand: precision 93.9 %, recall 55.4 %       |

No automated run shows WCAG conformance; every report lists what still needs a person.

## Known limitations

- Finding texts come from the rules and stay in English in the Turkish interface.
- `journeys suggest` can take a toggle (for example a theme switch) for the main call to action; review suggested
  journeys before running them.
- "After" crops reuse the baseline element's position.
- The GitHub social preview has to be uploaded in the repository settings by the maintainer.

See [LIMITATIONS.md](LIMITATIONS.md) for the full list.
