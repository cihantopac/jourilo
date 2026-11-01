# Decisions

Short architecture decision records. Newest last.

## D1 · Playwright for browser automation (2026-10-30)

Evaluated Playwright, Puppeteer and Selenium/WebDriver BiDi ([research](research/landscape.md)). Playwright gives one
API for Chromium, Firefox and WebKit, user-facing locators (role, label), auto-waiting, tracing and device emulation,
and CDP access in Chromium for throttling. Puppeteer is Chromium-first; Selenium needs more glue for the same evidence.
We depend on `playwright-core` (no bundled browsers) and download browsers explicitly with `jourilo setup`.

## D2 · axe-core for automated WCAG checks, plus our own measured checks (2026-10-30)

axe-core is the de-facto open engine with documented low false-positive goals; its `incomplete` results become
_needs review_, never defects. Its `target-size` rule is disabled by default, so we enable it explicitly. Our own
checks cover behavior a static DOM scan cannot: real keyboard focus, obscured focus, traps, form error feedback, paste
blocking, overflow at real widths.

## D3 · No overall score (2026-10-30)

A single number hides which problems matter and invites gaming. Reports show counts by severity and kind and a
root-cause-grouped "fix first" list.

## D4 · Provenance and kind on every finding (2026-10-30)

`measured | observed | heuristic | inferred | user` and `defect | hypothesis | needs-review`. Conversion findings are
always hypotheses. AI judgments enter only through `finding add`, capped at medium confidence and tied to evidence.

## D5 · One bundled CLI, committed dist (2026-10-30)

Same approach as Markilo: the plugin works right after install without a build. `playwright-core` stays external and is
installed by Claude Code from `plugin/package.json` (exact pin). `scripts/check-dist.mjs` keeps dist and generated
docs in sync with `src/`. In-page scripts are plain JavaScript strings/files so bundlers cannot inject helpers.

## D6 · Lab metrics are labelled lab (2026-10-30)

Core Web Vitals thresholds apply to field data at the 75th percentile. Jourilo measures one scripted visit and says
so in every metric finding and in run limitations; INP is only reported from scripted interactions in journeys.

## D7 · Journeys as JSON files with explicit success criteria (2026-10-30)

Inspectable, diffable, editable by people and agents; validated by a schema; no DSL to learn. Suggestions are marked
`source: "suggested"` and lower confidence.

## D8 · Safety policy decided at the element, not the journey (2026-10-30)

Before a click or Enter, the accessible name and form context of the actual element are classified (destructive /
financial / submit). Non-local hosts: never destructive or financial; submit only with `--allow-submit`. A mislabelled
journey cannot bypass it.

## D9 · Root-cause location is lexical and explainable (2026-10-30)

Each candidate says why it matched and with what confidence. Rule-specific root-cause patterns (CSS `outline: none`,
color tokens, `<html>` without `lang`) outrank element matches; route files are boosted; docs are excluded.

## D10 · Git checkpoints without touching user state (2026-10-30)

`git stash create` + a private ref (`refs/jourilo/checkpoints/<id>`) capture the working tree without changing
branches, index or the stash list. Rollback restores tracked files and lists (never deletes) new untracked files.

## D13 · Fix transactions instead of whole-tree rollback (2026-10-31)

0.1.0 rolled back by restoring every file that differed from the checkpoint, which also overwrote edits made after
it. A fix is now a transaction: exact backups and hashes are recorded before anything is written; rollback restores a
file only while it still holds the bytes Jourilo wrote, and reports any other state as a conflict. Writes are atomic
and an interrupted apply is recoverable. Git is no longer required for `optimize --apply`. Checkpoint rollbacks
(for agent edits) restore everything since the checkpoint, but run as a transaction that keeps the overwritten
versions, so they can be undone.

## D14 · Network guard proxy for all browser traffic (2026-10-31)

Checking the target URL is not enough: a page can make the browser reach loopback, LAN or metadata services through
subrequests, redirects, iframes and WebSockets, and DNS can change between a check and the browser's own lookup.
Route interception does not see redirect hops, so every request goes through a local proxy that resolves names
itself and connects only to the address it checked. WebRTC and QUIC are disabled so traffic cannot bypass it.

## D15 · Audits and form probes are read-only on every host (2026-10-31)

Local hosts often have persistent databases. Audits now intercept every request that would send data while keys are
pressed, widgets operated and forms probed; the form probe simulates the empty submission and reports server-side
feedback as untested. A real submission needs `--allow-submit`.

## D16 · Brand identity "Daybook" (2026-11-01)

The identity was made with Markilo after two rounds of symbol-led concepts failed the critic's gate. It is
wordmark-led: "Jourilo" in a book serif (Newsreader 500, outlined) whose J hangs below the line like a dateline
entry; the J alone is the symbol and the plugin icon. Ink `#1c1a17`, paper `#f4efe4`, brass accent `#a8762b` (the
report uses the darker `#875802` for text, which keeps 4.5:1). The report inlines the outlined paths so it stays one
file with no font. Originality: low visual similarity to the collected competitor marks (highest 38 %), but no
trademark-register search was done; the maintainer accepted that risk. This is not trademark clearance.

## D17 · An actionable report that never acts itself (2026-11-01)

The report stays one offline HTML file rendered on the server, so it reads without JavaScript; a small inline script
adds language, theme, filters, selection and the repair prompt, and reads only a JSON payload whose `<` is escaped.
Repair prompts follow the Relivaro and Searvex pattern (selection → editable Markdown → copy or download) without
their client-side rendering: the report writes text for an agent and a person to review, never runs or sends
anything, and says so. Findings are grouped by root cause (same rule and confident source line, else the same
specific selector), and every finding has a fix path: automatic only when a Jourilo fixer exists, manual for
needs-review items, experiment briefs for hypotheses. Interface strings are translated (English, Turkish);
finding texts come from rules and pages and are not, so evidence is never paraphrased. The decision not to show an
overall UX score (D3) is kept.

## D11 · Integration contract `jourilo.context/v1` (2026-10-30)

Markilo and Searvex are read through adapters into a neutral shape (brand: colors, fonts, locked; search: findings by
URL). A project can provide `jourilo.context.json` directly. Nothing is required and nothing is written back.

## D12 · Reports show paths relative to the working directory (2026-10-30)

Absolute home paths leaked the user name into shareable reports and screenshots; targets are now shown relative or
with `~`.
