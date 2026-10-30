# Evaluation

All numbers below come from real runs on 2026-10-30 (macOS 27, Apple Silicon, Node 22.23, Playwright 1.64.1,
Chromium 156.0.8078.4 unless stated). Raw benchmark records: [`evaluation/bench-history.jsonl`](evaluation/bench-history.jsonl).

## 1. Fixture benchmark (`jourilo bench`)

Fixture sites contain seeded problems with a ground truth in `expected.json` (`mustFind`, `mustNotFind`, expected
root-cause files, required recommendation text). The clean control must have no defect of moderate severity or worse.

| Fixture                                          | Pages × viewports     | Found   | False positives | Root-cause file | Time   |
| ------------------------------------------------ | --------------------- | ------- | --------------- | --------------- | ------ |
| acme-saas                                        | 6 × 2 (+ form probes) | 22 / 22 | 0               | 9 / 9           | 32.9 s |
| brand-site (locked Markilo brand + Searvex data) | 2 × 2                 | 3 / 3   | 0               | —               | 5.3 s  |
| clean-shop (control)                             | 4 × 2                 | —       | 0               | —               | 11.1 s |

Cross-browser (same acme-saas ground truth): Firefox 22/22, WebKit 22/22 (after the WebKit Option+Tab fix below).

**Caveat.** The fixtures were built by the same team as the rules. They prove that each rule detects what it is
designed to detect and stays quiet on a clean page; they do not measure coverage of real-world problems or compare
Jourilo with other tools.

### Defects found by this process and fixed

| Iteration | Symptom                                                                     | Root cause                                                                                       | Fix                                                                                                                                 | Regression test                        |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1         | Mobile horizontal overflow missed                                           | Chromium mobile emulation zooms out to fit wide content, so `innerWidth` grows with the overflow | measure against the configured CSS viewport width                                                                                   | `fixtures.test.ts` (overflow mustFind) |
| 1         | Slow-loading hero not reported as LCP                                       | Chromium ignores low-entropy images (flat SVG) for LCP                                           | fixture uses a realistic slow render-blocking script; documented                                                                    | `perf/lcp` mustFind                    |
| 1         | Error page reported as 4 accessibility defects                              | rules ran on a 404 template                                                                      | only reliability rules on HTTP ≥ 400                                                                                                | `mustNotFind` for /old-features        |
| 1         | Duplicate console + network errors                                          | Chromium logs every failed resource to the console                                               | console "Failed to load resource" dropped (kept as network evidence)                                                                | same                                   |
| 1         | `#signup` matched `href="/signup"` in other files                           | id tokens matched plain text                                                                     | attribute-aware matching for id/name/href/src; route-file boost                                                                     | `locate.test.ts`                       |
| 1         | Focus/contrast root cause ranked below element matches                      | element matches outweighed the CSS cause                                                         | rule-specific root-cause patterns are primary                                                                                       | bench `sources`                        |
| 2         | `optimize --apply` twice duplicated the `:focus-visible` rule               | idempotency check required `selector {`                                                          | check any existing `:focus-visible` selector                                                                                        | `repair.test.ts` (idempotent)          |
| 2         | Viewport meta inserted before `<meta charset>`                              | insertion anchored at `<head>`                                                                   | insert after charset when present                                                                                                   | `repair.test.ts`                       |
| 3         | Real site: contrast cause pointed at random files                           | Tailwind v4 colors come from `--color-*` tokens, not hex values in CSS                           | map `text-*`/`bg-*` utilities to their token definitions                                                                            | `locate.test.ts`                       |
| 3         | Real site: docs/*.md ranked as sources                                      | documentation mentions UI text                                                                   | exclude project `docs/` and root Markdown                                                                                           | `locate.test.ts`                       |
| 3         | Real site: `[href$="#x"]` treated as id `x`; escaped Tailwind classes split | naive selector parsing                                                                           | strip unescaped attribute selectors, unescape class names                                                                           | `locate.test.ts`                       |
| 3         | Shared reports leaked `/Users/<name>/…`                                     | absolute paths in targets                                                                        | `displayPath` (relative or `~`)                                                                                                     | manual check of report HTML            |
| 4         | WebKit missed focus problems                                                | WebKit follows Safari: Tab skips links and buttons                                               | keyboard walk uses Option+Tab in WebKit                                                                                             | `cross-browser.test.ts`                |
| 6         | Windows CI: rollback left files modified                                    | `git restore` applies `core.autocrlf=true` and rewrote LF files as CRLF                          | `optimize --apply` backs up exact bytes; rollback writes backups or the raw blob (keeping CRLF only where the working copy used it) | `git.test.ts` (autocrlf on and off)    |

## 1b. Signed-in single-page app (`fixtures/apps/pulse-dashboard`, `tests/browser/auth-spa.test.ts`)

A History-API dashboard with a fake session. A user-written sign-in journey with the fixture's test account passes and
saves the session (`--save-auth`, file mode 0600). Without the session the audit only reaches the sign-in page; with it,
Jourilo finds the Tab trap in the range picker, three focus stops hidden under the fixed help bar (found after stepping
past the trap) and, in the refresh journey, a 680 ms interaction (lab INP). No false form finding on the prefilled
settings form.

## 2. Repair loop (`tests/browser/repair.test.ts`)

On a disposable git copy of acme-saas: `optimize` (dry run) proposed 5 deterministic fixes and wrote nothing;
`optimize --apply` created a checkpoint and edited 5 files; `verify` reported **10 findings fixed, 0 new**
(lang on /de, focus visible on 5 pages, viewport meta and the resulting sideways scroll on /pricing, paste blocking,
autocomplete); re-applying changed nothing; `rollback --yes` restored all 5 files.

## 3. Real application (authorized, read-only)

The maintainer's own Next.js portfolio site (static export, served locally, source mapped with `--repo`), 4 pages × 2
viewports, 13 s:

- Confirmed real defects: text contrast 2.42:1 on a dark section (axe, 6 elements), a horizontal scroll list that is
  not keyboard-focusable on mobile (axe `scrollable-region-focusable`), and a design-comparison widget outside any
  landmark on every page.
- After iteration 3, the contrast root cause points at the color token definitions in `app/globals.css` (high
  confidence) instead of unrelated files.
- No keyboard focus problems were found (the site has focus styles); lab LCP < 0.1 s locally (not representative of
  production).
- 6 "needs review" items (axe `incomplete`: text over images/gradients, video captions) were left for a person.

## 4. Claude Code plugin (headless)

`claude -p "/jourilo:discover fixtures/repos/next-saas" --plugin-dir ./plugin` loaded the plugin, ran the real
toolchain (`discover --json`) and produced a summary separating observed facts (with files) from questions for the
user. Both manifests pass `claude plugin validate --strict` (one warning: no icon).

## 5. Continuous integration

First GitHub Actions run of the public repository (2026-10-30): Linux and macOS with Node 20 and 22 pass all tests,
including Firefox and WebKit; the detection benchmark, plugin validation and dependency audit pass. Windows passed
99 of 100 tests; the failure (rollback under `core.autocrlf=true`) was reproduced on macOS, fixed and covered by a
regression test. The next run passed on all nine jobs (Linux, macOS and Windows × Node 20/22, benchmark, plugin
validation, dependency audit).

## 6. Not evaluated yet

Comparison with Lighthouse / Pa11y / axe DevTools on the same pages; real-world recall on independently built
fixtures; long-running authenticated SaaS flows; performance under CPU/network throttling on real
devices. See [LIMITATIONS.md](LIMITATIONS.md) and [ROADMAP.md](ROADMAP.md).
