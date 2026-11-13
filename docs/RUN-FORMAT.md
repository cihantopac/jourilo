# run.json format and compatibility

Every audit writes `run.json` (and `manifest.json`) into its run directory. The machine-readable description is
[`schemas/run.schema.json`](../schemas/run.schema.json) (JSON Schema draft 2020-12, shipped in the npm package). The
manifest is described there as `#/$defs/manifest`. The TypeScript source of truth is `src/core/types.ts`.

## Compatibility policy

- `schemaVersion` is `1`.
- Within a `schemaVersion`, fields are only **added**, and an added field is always **optional**. Old runs stay valid.
- Removing a field, renaming it or changing its meaning increments `schemaVersion`.
- `loadRun` (and every command that reads a run) refuses a run with another `schemaVersion` with the error
  `SCHEMA_MISMATCH`.
- Readers must **ignore unknown fields**. The schema never sets `additionalProperties: false`, so a run from a newer
  1.x release still validates against an older schema.
- Absent optional fields mean "not recorded": for example a run without `outcome` was written before that field existed.

## Pages, captures and samples

- `summary.pages` counts **captures** (page URL × viewport), not distinct URLs; its meaning cannot change within
  schema version 1. `summary.captures` repeats it, and `summary.urls` is the number of distinct audited URLs. A run of
  3 URLs in 2 viewports has `urls` 3, `captures` 6 and `pages` 6.
- `sample` is present when discovery found more pages than were audited: `{ discovered, audited, leftOut }`, where
  `leftOut` lists at most 20 of the discovered URLs that were not audited (redacted like other URLs). The same fact is
  stated in `limitations`. It is absent for `--url` lists, with `--pages 1` (no discovery runs), and when every
  discovered page was audited.
- `pages[].load` records how a capture was taken: `networkIdle` (the network went idle within the settle window) and,
  with `--wait-for <selector>`, `waitedFor` and `found`. `found: false` means the element was not visible within
  `--timeout`; the page was still audited in the state it was in, and `limitations` says so. `settings.waitFor` holds
  the selector, and `jourilo verify` replays it. The field is absent in runs made before 1.3.0.

## Budgets

`--budget LCP=2000,CLS=0.05` records `budgets`: one entry per metric with the `limit`, the `worst` value and the
`url` and `viewport` of the capture that had it, and `ok`. The comparison uses each capture's value (the median with
`--runs N`); the worst capture decides, and a value equal to the limit is met. `ok` is `null` when no capture
measured the metric (for example INP, which a scripted visit does not produce): that is neither a pass nor a fail,
and `limitations` says so. A failed budget exits 1, like `--fail-on`; exit 5 and 6 keep their codes.

## manifest.json

`manifest.json` lists every artifact of the run (`files`: `path`, `bytes`, `sha256`; the browser's transient
`browser.pids` is never listed) and, since 1.3.0, what produced them:

- `tool`: `{ name: "jourilo", version }`, the release that made the run.
- `browser`: `{ name, version }`, as in `run.json`.
- `axe`: `{ version }`, the axe-core version the pages were checked with (`settings.axe`), or the bundled axe-core when
  no page was checked (for example `discover`).
- `scope`: `{ target, urls, viewports }`: the redacted target, the audited URLs (`settings.scope.urls`, or the captured
  pages for journey runs), redacted like other URLs, and the viewport names.

The manifest is rewritten whenever the reports are (`report`, `compare`, `finding`), and these fields are taken from
the run.
No secret (proxy credentials, `--extra-header` values) is ever written to it.

## Progress lines

With `--json`, every progress line on stderr is one JSON object:
`{"type":"progress","phase":…,"message":…,"done"?,"total"?,"url"?,"viewport"?,"at":"<ISO time>"}`. `message` is the
text of the plain line (trimmed). Lines from the audit pipeline carry `phase`; other lines (stop notices, warnings,
`journeys run` steps) may carry only `message`.

- `phase` is one of `launch`, `discover`, `setup`, `capture`, `metrics`, `forms` or `report`. `rules` is reserved:
  no line uses it yet.
- `done` is the number of steps of that phase finished **before** this line's step started, and `total` the number of
  steps the phase will take. The last line of a phase therefore has `done` = `total` − 1. No line says that a step
  finished: a phase is over when the next phase's first line arrives, or when the run ends (the JSON result on stdout).
- The plan line of the capture phase (`Auditing N page(s) × M viewport(s) …`) and the first capture line both carry
  `done: 0`.
- `done` and `total` are left out where Jourilo cannot count exactly (launch, setup, discovery, report); a total is
  never estimated.
- `url` (the page the step works on) is redacted like the message, and `viewport` is the viewport name. No secret
  (proxy credentials, `--extra-header` values) is ever part of a progress line.

## Validating

Use any draft 2020-12 validator against `schemas/run.schema.json`. Only the required keys are guaranteed; treat
everything else as optional.
