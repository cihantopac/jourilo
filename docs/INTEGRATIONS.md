# Integrations: `jourilo.context/v1`

Jourilo is independent. When a project contains brand or search data, Jourilo reads it through a small, versioned,
tool-neutral contract and uses it to make better recommendations. Nothing is required and nothing is written back.

## Contract

```json
{
  "schema": "jourilo.context/v1",
  "brand": {
    "source": "markilo",
    "file": "branding/brands/acme/exports/tokens/tokens.json",
    "name": "Acme",
    "locked": true,
    "colors": [{ "name": "color.brand.primary.600", "value": "#166534" }],
    "fonts": ["DM Sans"]
  },
  "search": {
    "source": "searvex",
    "file": ".searvex/runs/<id>/report.json",
    "findings": [
      {
        "ruleId": "meta/description-missing",
        "title": "…",
        "severity": "medium",
        "url": "https://…/",
        "message": "…"
      }
    ]
  },
  "notes": []
}
```

Resolution order: an explicit `jourilo.context.json` in the project root (must declare `"schema": "jourilo.context/v1"`),
then the Markilo adapter for `brand`, then the Searvex adapter for `search`. Any tool can integrate by writing this file.

## Markilo adapter

Reads `branding/markilo.json` (or `brand/markilo.json`), picks the requested brand (`--brand <slug>`), else the master
brand, else the first, and flattens `brands/<slug>/exports/tokens/tokens.json` (W3C Design Tokens: `$type` color /
fontFamily). `locked: true` in the manifest marks the brand as locked.

Effects in audits:

- `design/off-brand-cta-color`: a primary button background farther than ΔE 10 (CIE76) from every brand color.
- `design/off-brand-font`: body or heading computed font family not among the brand fonts (often a failed web-font load).
- Locked brand: if a contrast failure's text color is a brand token (ΔE < 2.3), the recommendation says to keep the token
  and fix contrast another way (background, size/weight, an existing darker step).

## Searvex adapter

Reads the newest `.searvex/runs/<id>/report.json` and keeps rule id, title, severity, message and the first evidence
URL. The HTML report lists search findings for pages that the run also audited, next to the experience findings.

## Analytics adapters (read-only)

`jourilo experiment analyze --from <adapter>:<id>` reads an experiment's exposures and conversions from PostHog,
GrowthBook or Amplitude and runs the same analysis as `--control/--variant`, sequential by default: a live experiment
is checked repeatedly, so the always-valid mSPRT p-value and confidence sequence are reported
([standards §4.4](research/standards.md#44-sequential-testing-msprt-with-always-valid-p-values)); `--fixed` gives the
fixed-horizon test instead. The adapters only read: GET requests, plus
PostHog's documented read-only query endpoint (`POST /api/projects/:project/query/`, which uses POST to carry the query).
Every request goes through Jourilo's guarded fetch (`guardedFetch` in `src/core/net-guard.ts`): the host is resolved and
checked like every other outbound request (no LAN or metadata addresses; loopback only for a local self-hosted
instance), HTTPS_PROXY / NO_PROXY apply, GET redirects stay on the same origin, and plain `http://` is refused except to
a local host. No SDK and no new dependency is used.

| Adapter                                 | Keys (environment only)                                                                                                                                                  | Endpoints                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `posthog:<id or flag key>`              | `POSTHOG_API_KEY` (personal key, `experiment:read`, `query:read`); optional `POSTHOG_HOST` (default `https://us.posthog.com`), `POSTHOG_PROJECT_ID` (default `@current`) | `GET /api/projects/:project/experiments/:id/`, `GET …/experiments/?limit=100` (follows `next`), `POST …/query/` with an `ExperimentQuery`            |
| `growthbook:<exp_… id or tracking key>` | `GROWTHBOOK_API_KEY`; optional `GROWTHBOOK_HOST` (default `https://api.growthbook.io`)                                                                                   | `GET /api/v1/experiments/:id`, `GET /api/v1/experiments?limit=100&offset=N` (follows `hasMore`/`nextOffset`), `GET /api/v1/experiments/:id/results`  |
| `amplitude:<flag key>`                  | `AMPLITUDE_API_KEY`, `AMPLITUDE_SECRET_KEY` (Basic auth); optional `AMPLITUDE_HOST` (default `https://amplitude.com`)                                                    | `GET /api/2/funnels`: `$exposure` for the flag → the `--metric` event, grouped by the `[Experiment] <flag>` user property, from `--start` to `--end` |

Only conversion metrics are read: PostHog funnel metrics, GrowthBook `binomial` metrics and `proportion` fact metrics
(the type is read from the metric definition), and an Amplitude two-step funnel. Another metric type is refused with
a usage error that names the metrics to pick from. `--start`, `--end` and `--control-key` apply only to Amplitude.
Amplitude's funnel endpoint does not list the flag's variants: the control is `--control-key` (default `control`), a
missing control or a single arm is incomplete data, but a missing third arm of a multi-arm experiment cannot be
detected.
A key never appears in output, errors or progress lines; a refused key names its variable. A rate limit (429), a failed
page (5xx), an unreachable host or a missing variant marks the data incomplete, and `analyze` refuses to compute and
lists the reasons. Amplitude's funnel endpoint has no pages: an answer with as many groups as the limit (1000) is
treated as cut off.

The test recordings in `tests/fixtures/analytics/` are synthesized from each vendor's documented response shapes, not
recorded from live accounts; their README names the endpoint and documentation page behind each file.

## What Jourilo offers back

`run.json` (versioned, `schemaVersion: 1`), `report.sarif` and `report.md` are stable outputs other tools can read.
