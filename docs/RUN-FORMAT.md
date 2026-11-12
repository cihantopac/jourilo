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
  stated in `limitations`. It is absent for `--url` lists and when every discovered page was audited.

## Budgets

`--budget LCP=2000,CLS=0.05` records `budgets`: one entry per metric with the `limit`, the `worst` value and the
`url` and `viewport` of the capture that had it, and `ok`. The comparison uses each capture's value (the median with
`--runs N`); the worst capture decides, and a value equal to the limit is met. `ok` is `null` when no capture
measured the metric (for example INP, which a scripted visit does not produce): that is neither a pass nor a fail,
and `limitations` says so. A failed budget exits 1, like `--fail-on`; exit 5 and 6 keep their codes.

## Validating

Use any draft 2020-12 validator against `schemas/run.schema.json`. Only the required keys are guaranteed; treat
everything else as optional.
