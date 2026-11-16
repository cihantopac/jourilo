# Report redesign and README refresh (1.6.0)

Agreed with Cihan on 2026-11-16.

## Intent

The HTML report reads as a wall of text: every finding opens into a flat label/value table (why, fix, basis, standards,
reproduce, source, same cause, evidence) with many coloured chips. Cihan wants a calmer, more visual and ordered report
in the spirit of apple.com and stripe.com, and the GitHub README (the project's shop window) rebuilt around new
screenshots of it.

## Goals

- **One three-colour system, 60/30/10, from the Jourilo identity:**
  - 60 % paper (`--paper`, `--sheet`): backgrounds and surfaces.
  - 30 % ink (`--ink` and its tints): text, lines and secondary surfaces.
  - 10 % brass (`--brass`): buttons, links, hover, the selected tab and focus.
  - Dark theme: the same roles, inverted.
- **Severity as a dot plus one word** ("● Serious"). Severity colour appears only in that dot and nowhere else: no
  red/orange borders, tinted card backgrounds or coloured KPI tiles. The same goes for fix-path and status chips: one
  neutral style, with text that says what they are.
- **Say it in three words, not ten.** Every visible label and line is as short as it can be. The detail stays in the
  report but is folded away: whoever wants it opens it.
- **Finding anatomy** (Findings tab and overview cards):
  1. A title row: severity dot, title, where (page · viewport), and a selection checkbox.
  2. The open state, which shows:
     - the evidence visual first and large;
     - 2–3 measured values as small stat tiles (e.g. "640 px document · 390 px viewport");
     - one "Fix" sentence.
  3. A "Details" disclosure holding why it matters, basis and confidence, standards, reproduction, rule/id, likely
     source with its excerpt, same-root-cause instances, affected pages and the full evidence list.
- **Overview:**
  - A short hero: target, date and one line.
  - Quiet KPI tiles: a number and a short label, no coloured backgrounds.
  - "Fix first" cards: visual, dot plus title, where.
  - Lanes, limits, history and context are folded or compact.
- **Generous whitespace, one type scale, fewer borders.** Hierarchy comes from size and weight, not colour.
- **README:**
  - A hero: wordmark, one line, one large report image (light/dark `<picture>`).
  - 3–4 short sections (journeys, evidence, fix and prove, install), each with two sentences and one image.
  - Benchmarks, safety and the family come last and briefly.
  - Every image is re-shot from the new report and pinned to the release tag.

## Non-goals and anti-goals

- No rewrite of the report engine or its data; `Run`, the run schema and `RUN_SCHEMA_VERSION` stay unchanged.
- Nothing is dropped from the report, only folded away.
- No new runtime dependency or external font/CDN: the report stays one offline file under its CSP.
- It is a failure if contrast drops below 4.5:1 for text, if keyboard or screen-reader use gets worse, or if the
  EN/TR toggle or the light/dark/system theme breaks.
- No overall UX score; never imply WCAG conformance (D3).

## Constraints

- Code in `src/report/html.ts`, `html-style.ts`, `html-client.ts` and `html-i18n.ts` (every new or shortened label in
  both EN and TR).
- The repair-prompt selection, filters, tabs, compare view and `jourilo report` behaviour keep working; tests that pin
  HTML structure are updated, not deleted.
- Screenshots come from `scripts/screenshot.mjs` on the acme fixture (and the existing journey/compare runs).

## Approaches

1. **CSS and copy only:** cheapest, but it keeps the flat label/value table that is the actual complaint.
2. **Rebuild the components on the same renderer (chosen):** a new finding and card anatomy, a new token set and
   shorter copy, inside the existing `html.ts` string renderer. It changes what people see without touching data or
   risking the engine.
3. **A new report engine:** cleanest, but several days of work and a new class of bugs, against the lighter release
   process.

Cihan chose 2, with severity shown as a dot.

## Left to the builder

Exact spacing, the type scale, icons (inline SVG only), how stat tiles are drawn from `evidence.data`, the mobile
layout and the order of folded sections. These must stay within the rules above.
