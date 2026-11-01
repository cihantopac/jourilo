# Progress log and resume checkpoint

Use this file to resume work in a new session: read it, then [RELEASE-1.0.md](RELEASE-1.0.md) (plan, checklist,
evidence), [LIMITATIONS.md](LIMITATIONS.md) and [ROADMAP.md](ROADMAP.md).

## State on 2026-11-01 (1.0.0 release candidate in progress)

Repository: https://github.com/cihantopac/jourilo (public). 0.1.0 is on npm and GitHub (2026-10-31). The 1.0 work
lives on branch `release/1.0` until the release checklist in RELEASE-1.0.md is complete.

### Done for 1.0 (each with tests and a real run)

| Milestone                                                                                 | Evidence                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Network guard, mixed-DNS refusal, guarded robots/sitemap fetches                          | `net-guard.test.ts` (3 engines), `unit/net-guard.test.ts`    |
| Fix transactions, conflict-safe and reversible rollback, no git requirement               | `unit/git.test.ts`, `repair.test.ts`                         |
| Journey action guard (keys, signals, request backstop), read-only audits, simulated forms | `action-safety.test.ts`, `unit/journeys.test.ts`             |
| Security review with residual risks                                                       | [SECURITY-REVIEW.md](SECURITY-REVIEW.md)                     |
| Laravel discovery; real-application fixes (anchors, launcher dialogs, local sitemaps)     | EVALUATION.md §3b; fixtures `widgets-lab`, `multilang-build` |
| Composite keyboard reachability, `--repeat` flake detection, noise-aware verify verdicts  | `widgets-lab/composite-*`, `flaky.test.ts`, `report.test.ts` |
| Clean install from the packed tarball (CI on 3 platforms); marketplace install verified   | `scripts/smoke-pack.mjs`; RELEASE-1.0.md evidence log        |

### How to verify quickly

```bash
npm install && node plugin/dist/jourilo.mjs setup
npm run ci                      # lint, typecheck, build, unit + browser tests, dist check
npm run bench                   # detection benchmark on the fixtures
node scripts/smoke-pack.mjs     # every command from the packed tarball
node benchmarks/act/fetch.mjs && node benchmarks/act/run.mjs   # independent ACT benchmark (about 90 minutes)
```

### Conventions to keep

- Every rule: unit test + fixture `mustFind` + clean control stays clean.
- Every engine defect found on a real site: a fixture that fails on the old code and passes on the new one.
- `npm run build` after any `src/` change; commit `plugin/dist` and generated `docs/CLI.md`.
- Findings: correct `kind` / `provenance` / `confidence`; conversion = hypothesis.
- Real-application evidence stays outside this repository; only a summary without private details goes into docs.
