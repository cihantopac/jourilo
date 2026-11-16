# Jourilo 1.6.0

## 1.6.0 (2026-11-16)

A minor release that redesigns the report and rebuilds the README. What Jourilo finds is unchanged. Details are in the
[changelog](../CHANGELOG.md). One branch, one commit per task, no new dependency.

- **Visual system:** paper, ink and brass in a 60/30/10 split; severity is a dot plus a word; one neutral chip style.
- **Findings:** an open finding shows the evidence visual, up to three stat tiles and one fix line; the rest is under
  Details.
- **Overview:** a quiet hero that splits "served at" from the target, ink KPI numbers with a dot legend; limitations,
  dismissed findings, history and context are folded.
- **Tabs:** Journeys, Pages and Compare share the same scale and chips; journey steps wrap so the goal is never clipped.
- **Labels:** shorter English and Turkish text.
- **README and images:** rebuilt around the new report with 2x screenshots and a new social preview; `scripts/screenshot.mjs`
  gains `SCALE`, `LANG_UI`, `CLIP`, `PAD`, `HIDE`, `finding=<title>` and `prompt`.

`RUN_SCHEMA_VERSION` stays 1 and run data is unchanged; old runs render in the new report.

### Evidence (2026-11-16, macOS 27, Node 22, Playwright 1.64.1)

| Check                                                                           | Result                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)       | 53 files, 853/854 green; one stale selector in a browser test fixed and re-run; lint, typecheck, dist check and 705 unit tests re-run on the final head |
| Fixture benchmark (`npm run bench`)                                             | 91/91 found, 0 false positives, source location 10/10                                                                                                   |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command) | passed, 31 files, 1579 kB                                                                                                                               |
| `claude plugin validate` (marketplace and plugin, strict)                       | passed                                                                                                                                                  |

The report was checked visually in light and dark at 1280 px and 390 px, in English and Turkish. No automated run
shows WCAG conformance.

### Maintainer step

The GitHub social preview is not part of the repository. Upload `docs/assets/social-preview.png` once under
Settings, Social preview.

### Known limitations (1.6.0)

Unchanged; the full list is in [LIMITATIONS.md](LIMITATIONS.md). The items left open in 1.5.0 are listed under Next in
the [roadmap](ROADMAP.md).
