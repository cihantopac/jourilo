# Progress log and resume checkpoint

Use this file to resume work in a new session: read it, then `docs/ROADMAP.md` and `docs/LIMITATIONS.md`.

## State on 2026-10-30 (v0.1.0, unreleased)

Repository: https://github.com/cihantopac/jourilo (public), branch `main`. No tagged release, not on npm.
Build: `npm run ci` green on macOS.

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

1. Run CI on Linux/Windows (workflow exists, never executed).
2. Plugin icon (suggest designing with Markilo) — validator warns `ICON_MISSING`.
3. Comparative benchmark vs Lighthouse/Pa11y; independent fixtures.
4. Release: tag v0.1.0 and npm publish — **requires the maintainer's approval**.

### Conventions to keep

- Every rule: unit test + fixture `mustFind` + clean control stays clean.
- `npm run build` after any `src/` change; commit `plugin/dist` and generated `docs/CLI.md`.
- Findings: correct `kind` / `provenance` / `confidence`; conversion = hypothesis.
