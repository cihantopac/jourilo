# Name check and plugin directory readiness

Accessed: 2026-10-30. This is a desk check by the maintainers, **not legal advice** and not a trademark clearance
search. Before investing in the brand (or registering it), have a trademark attorney run a full clearance search.

## Name: "Jourilo"

| Source                                                                                                               | Query                                | Result                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| [TMview](https://www.tmdn.org/tmview/) (EUIPO; covers EU offices, TÜRKPATENT, USPTO and other participating offices) | trade mark name contains `jourilo`   | no records                                                              |
| TMview                                                                                                               | contains `jourlo` (closest spelling) | no records                                                              |
| TMview (control query to confirm the search works)                                                                   | contains `journi`                    | 153 records (59 USPTO, plus TÜRKPATENT records for other control terms) |
| npm registry                                                                                                         | package `jourilo`                    | not taken (HTTP 404)                                                    |
| GitHub                                                                                                               | repository search `jourilo`          | no repositories before ours                                             |
| Web search                                                                                                           | `"Jourilo"`                          | no product or company; one person's surname in a UK directory           |

### Similar names worth knowing about

| Name    | What it is                                                             | Source                                                                                                        |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Jourlo  | Journaling app ("Write to Know Yourself")                              | [jourlo.space](https://www.jourlo.space/), [mergeek listing](https://www.mergeek.com/latest/d9YjemZ4ex5ALP5Z) |
| JOURNI  | Trademarks in several offices, incl. software (class 9) by Journi GmbH | [Justia](https://trademark.justia.com/owners/journi-gmbh-3533553), TMview                                     |
| journoo | US application for AI journaling software                              | [trademarkdir](https://trademarkdir.com/trademark/journoo-99384979)                                           |
| JOURFUL | US mark for mobile application software                                | [Justia](https://trademarks.justia.com/owners/jourful-inc-5445963)                                            |

These products serve different purposes (personal journaling), but they share the "jour-" prefix and software classes.
Low apparent conflict at this level of checking; a professional search should look at phonetic similarity in classes 9
and 42.

## Claude Code plugin directory readiness

`claude plugin validate plugin --strict --profile directory`:

| Check                                                            | Status                                    |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Manifest, skills, agent                                          | pass                                      |
| README at the repository root                                    | pass (taken from the repository root)     |
| Icon (`.claude-plugin/icon.png`, square PNG 512–2048 px, < 2 MB) | pass (1024 px appmark, added after 1.0.0) |

The validator notes that the icon becomes the listing icon only the first time the plugin is saved or submitted,
so the plugin should **not be submitted before the final icon exists**. The final icon now exists and the validator
reports nothing. The directory also runs a safety scan and a
policy review that the local validator does not. Submission is a maintainer decision.
