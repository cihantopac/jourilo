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

## What Jourilo offers back

`run.json` (versioned, `schemaVersion: 1`), `report.sarif` and `report.md` are stable outputs other tools can read.
