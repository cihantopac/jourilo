# Contributing to Jourilo

Thanks for helping. Jourilo's value depends on its findings being right, so contributions are judged first on
evidence and correctness.

## Setup

```bash
npm install
node plugin/dist/jourilo.mjs setup     # Chromium for Playwright
npm run ci                             # lint, typecheck, build, all tests, dist check
```

`npm test` runs unit tests (fast) and browser tests (real Chromium against `fixtures/`). `npm run bench` prints the
detection benchmark.

## Ground rules

1. **No finding without evidence.** A rule must point at something measured or observed in the browser.
2. **Every rule ships with proof.** Add a fixture page in `fixtures/sites/<name>/` where it must fire (list it in
   `expected.json` → `mustFind`) and make sure the clean control (`fixtures/sites/clean-shop`) stays clean. Add unit
   tests with synthetic observations in `tests/unit/`.
3. **Label honestly.** Choose `kind` (defect / hypothesis / needs-review), `provenance` and `confidence` that a skeptical
   reviewer would accept. Conversion rules produce hypotheses only.
4. **Cite standards.** Use `wcag('x.y.z')`, `CWV.*` or `nielsen(n)` from `src/audit/standards.ts`; add sources to
   `docs/research/standards.md` for anything new.
5. **Fixers are minimal and idempotent** and covered by `tests/browser/repair.test.ts`.
6. **Keep `plugin/dist` in sync**: run `npm run build` and commit the result (`npm run check:dist` verifies it).
7. Code and docs in English; TypeScript strict; Biome formatting (`npm run format`).

## Pull requests

Describe the user-visible change, link the fixture and test that prove it, and paste `jourilo bench` before/after if
detection changed. Update `CHANGELOG.md` under "Unreleased".

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
