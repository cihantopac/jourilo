# Progress log and resume checkpoint

Use this file to resume work in a new session: read it, then `docs/ROADMAP.md` and `docs/LIMITATIONS.md`.

## State on 2026-10-31 (v0.1.0 released)

Repository: https://github.com/cihantopac/jourilo (public), branch `main`. Tag `v0.1.0`, GitHub release and npm
package `jourilo@0.1.0` published on 2026-10-31. CI green on Linux, macOS and Windows (Node 20 and 22).

### Done (each with tests and a real run)

| Milestone                                                                                  | Commit message prefix  | Evidence                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------------------------------------- |
| Vertical slice: discovery → browser capture → rules → report → bench                       | "Vertical slice"       | bench 19/19 at the time                                         |
| Journey engine, safety policy, form validation probe, paste blocking                       | "Journey engine"       | journeys.test.ts; bench 22/22                                   |
| Product intelligence (repo + site), experiments, `jourilo.context/v1` with Markilo/Searvex | "Product intelligence" | discovery/experiment/integration tests; brand-site fixture      |
| Repair engine: fixers, checkpoints, verify, rollback                                       | "Repair engine"        | repair.test.ts: 10 fixed, 0 new                                 |
| Claude Code plugin, agent adapters, generated CLI docs                                     | "Claude Code plugin"   | `claude plugin validate --strict`; headless `/jourilo:discover` |
| Real-site iteration, WebKit fix, docs, CI                                                  | "Docs, CI"             | EVALUATION.md §1, §3                                            |

### How to verify quickly

```bash
npm install && node plugin/dist/jourilo.mjs setup
npm run ci            # lint, typecheck, build, unit + browser tests, dist check
npm run bench         # detection benchmark
```

### Open items (in priority order)

1. Keep Windows CI green (Linux and macOS pass on GitHub Actions; Windows rollback fixed on 2026-10-30).
2. Plugin icon (suggest designing with Markilo) — validator warns `ICON_MISSING`.
3. Independent fixtures (the GOV.UK comparison has influenced the rules); W3C BAD before/after comparison.
4. Release: tag v0.1.0 and npm publish — **requires the maintainer's approval**.

### Conventions to keep

- Every rule: unit test + fixture `mustFind` + clean control stays clean.
- `npm run build` after any `src/` change; commit `plugin/dist` and generated `docs/CLI.md`.
- Findings: correct `kind` / `provenance` / `confidence`; conversion = hypothesis.
