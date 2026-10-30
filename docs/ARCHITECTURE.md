# Architecture

Jourilo is a TypeScript/Node.js CLI bundled into one file (`plugin/dist/jourilo.mjs`) that the Claude Code plugin and
other agents call. The design separates five layers so each can be tested on its own and so AI judgment never
masquerades as measurement.

```
                ┌──────────────────────── agents ─────────────────────────┐
                │ Claude Code plugin (skills, ux-reviewer agent)          │
                │ AGENTS.md / Cursor rule / personal skill (adapters)     │   ← AI research, reasoning, design
                └──────────────┬──────────────────────────────────────────┘     criticism, code edits
                               │ jourilo <command> --json
┌──────────────────────────────▼─────────────────────────────────────────────────────────────┐
│ CLI (src/cli): commands, registry (→ docs/CLI.md), stable JSON errors and exit codes        │
├───────────────┬──────────────────┬──────────────────┬──────────────────┬───────────────────┤
│ discovery     │ audit            │ journeys         │ repair           │ report            │
│ repo.ts       │ engine.ts        │ schema / runner  │ locate.ts        │ html / md / sarif │
│ site.ts       │ rules/*          │ suggest / forms  │ fixes / diff     │ compare.ts        │
│ crawl/robots  │ conversion/      │ safety.ts        │ git.ts           │                   │
│               │ integrations/    │                  │                  │ experiment/       │
├───────────────┴──────────────────┴──────────────────┴──────────────────┴───────────────────┤
│ browser (src/browser): runtime (lazy Playwright), capture, in-page probe, keyboard walk,     │
│ vitals, viewports                                    ← deterministic measurement & execution│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ core (src/core): types (versioned Run schema), redaction, URL/path safety, static server,    │
│ workspace (.jourilo/runs/<id>/)                                                              │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data flow of an audit

1. **Target check** (`core/url-safety`): http(s) only; private-network hosts refused without `--allow-private`;
   a local directory is served on 127.0.0.1 (`core/static-server`, path-traversal safe).
2. **Discovery** (`discovery/crawl`): robots.txt (RFC 9309 subset), sitemap, same-origin links from the rendered DOM,
   ranked by journey importance (pricing, signup, checkout…) with role diversity.
3. **Capture** (`browser/capture`), per page × viewport, in this order so measurements do not disturb each other:
   navigation → settle → lab vitals → in-page probe (inventory, target size, overflow, small text, pointer-only
   controls, paste blocking, style samples, technology hints) → axe-core → masked screenshots (full page + first
   screen) → keyboard walk (real Tab presses; focus styles compared focused vs. unfocused; elementFromPoint for
   obscured focus; cycle analysis for traps). Console errors, page errors and failed requests are recorded throughout.
4. **Form probe** (`journeys/forms`, local hosts or `--allow-submit`): empty submission, then error text, aria-invalid,
   describedby/live-region association and focus are measured.
5. **Rules** (`audit/rules/*`, `conversion/rules`, `integrations/design-rules`): pure functions
   `PageObservation → Finding[]`, unit-tested with synthetic observations. Findings carry kind (defect / hypothesis /
   needs-review), provenance, confidence, standards, evidence and reproduction steps.
6. **Merge** (`audit/finding`): one fingerprint per rule + page + target, so the same defect at two widths is one
   finding and runs can be compared.
7. **Root cause** (`repair/locate`): lexical, explainable matching of evidence (ids, test ids, attributes, text,
   colors, color tokens, rule-specific patterns such as `outline: none`) to source lines, boosted for files that
   render the route.
8. **Storage and reports**: `run.json` (schema v1), `report.html`, `report.md`, optional `report.sarif`.

## Why the layers matter

| Layer          | May decide                                              | May not                                                                               |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| browser, rules | what was measured or observed; deterministic heuristics | interpret intent or business value                                                    |
| AI agent       | design critique, prioritization, code edits             | create _measured_ or _observed_ findings (`finding add` labels its output _inferred_) |
| repair         | mechanical, unambiguous edits behind `--apply`          | redesign, rename, touch unrelated code                                                |
| report         | presentation                                            | change data                                                                           |

## Extending

- **A rule**: add a function to `src/audit/rules` (or `conversion/`), register it in `PAGE_RULES`, add a unit test with
  a synthetic observation and a fixture that proves it fires plus a control that proves it does not
  (`fixtures/sites/*/expected.json`).
- **A fixer**: add to `FIXERS` in `src/repair/fixes.ts`; it must be idempotent and covered by `tests/browser/repair.test.ts`.
- **A framework**: add a file-route rule or code-route pattern in `src/discovery/repo.ts` and a fixture repo in
  `fixtures/repos`.
- **An agent**: add an adapter to `src/agents/adapters.ts`; all adapters share one instruction body.
