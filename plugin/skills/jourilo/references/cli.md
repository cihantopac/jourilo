# Jourilo CLI reference

<!-- Generated from src/cli/registry.ts by scripts/build.mjs. Do not edit by hand. -->

Every command prints human-readable text, or JSON with `--json`. Errors go to stderr; with `--json` they are
`{"error":{"code","message","hint"}}` with a stable `code`. Exit codes: 0 ok, 1 failed gate or error, 2 usage,
3 blocked by a safety rule (unsafe URL/path, robots.txt, policy), 4 browser unavailable.

Global options: `--json`, `--workspace DIR` (default `.jourilo`, or `JOURILO_WORKSPACE`), `--quiet`.

## Understand

### `jourilo discover`

Product intelligence: map a repository (frameworks, routes, design system, i18n, auth, analytics) or a website (pages, conversion points, services).

```
jourilo discover <path|url> [--pages 10]
```

## Audit

### `jourilo audit`

Audit a website URL or a static build directory in a real browser (accessibility, UX, responsive, performance, reliability, conversion).

```
jourilo audit <url|dir> [--pages 6] [--viewports desktop,mobile] [--url /path ...] [--repo .] [--fail-on serious]
```

```
Options:
  --pages N            Pages to audit after discovery (default 6; 1 = only the target)
  --depth N            Link depth for discovery (default 3)
  --url PATH           Audit exactly these paths/URLs on the target origin (repeatable; skips discovery)
  --include PATH       Add pages to discovery (repeatable)
  --viewports LIST     desktop, laptop, tablet, mobile, reflow (320px) or WIDTHxHEIGHT (default desktop,mobile)
  --browser NAME       chromium (default), firefox, webkit, chrome, msedge
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Do not submit forms (by default, forms on local hosts are submitted empty to test validation)
  --allow-submit       Allow submitting forms on non-local hosts (authorized test environments only)
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
```

### `jourilo accessibility`

Accessibility-only audit: axe-core WCAG 2.2 rules, keyboard walk, focus visibility, target size, input purpose.

```
jourilo accessibility <url|dir> [audit options]
```

```
Options:
  --pages N            Pages to audit after discovery (default 6; 1 = only the target)
  --depth N            Link depth for discovery (default 3)
  --url PATH           Audit exactly these paths/URLs on the target origin (repeatable; skips discovery)
  --include PATH       Add pages to discovery (repeatable)
  --viewports LIST     desktop, laptop, tablet, mobile, reflow (320px) or WIDTHxHEIGHT (default desktop,mobile)
  --browser NAME       chromium (default), firefox, webkit, chrome, msedge
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Do not submit forms (by default, forms on local hosts are submitted empty to test validation)
  --allow-submit       Allow submitting forms on non-local hosts (authorized test environments only)
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
```

### `jourilo conversion`

Conversion-focused audit: CTAs, value proposition, trust signals, form friction, pricing clarity (as hypotheses).

```
jourilo conversion <url|dir> [audit options]
```

```
Options:
  --pages N            Pages to audit after discovery (default 6; 1 = only the target)
  --depth N            Link depth for discovery (default 3)
  --url PATH           Audit exactly these paths/URLs on the target origin (repeatable; skips discovery)
  --include PATH       Add pages to discovery (repeatable)
  --viewports LIST     desktop, laptop, tablet, mobile, reflow (320px) or WIDTHxHEIGHT (default desktop,mobile)
  --browser NAME       chromium (default), firefox, webkit, chrome, msedge
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Do not submit forms (by default, forms on local hosts are submitted empty to test validation)
  --allow-submit       Allow submitting forms on non-local hosts (authorized test environments only)
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
```

## Journeys

### `jourilo journeys`

Discover, list, validate and run user journeys (reusable scenarios with explicit success criteria).

```
jourilo journeys <suggest [url|dir|run]|list|validate [files]|run [ids] --base <url|dir>>
```

```
Subcommands:
  suggest [url|dir|run]  Derive journeys from a site (or an existing run) into .jourilo/journeys/*.json
  list                   List journey files
  validate [files]       Check journey files against the schema
  run [ids|files]        Run journeys against --base <url|dir>

Run options:
  --viewport LIST        desktop, mobile, … (default: the journey's own viewport or desktop)
  --var key=value        Test data for {{key}} placeholders (also JOURILO_VAR_KEY env vars)
  --allow-submit         Allow form submission on non-local hosts (authorized test environments only)
  --allow-destructive    Allow irreversible/payment actions — local hosts with sandbox data only
  --trace                Record a Playwright trace per journey (contains typed values; keep private)
  --auth FILE            Playwright storage state for signed-in journeys
  --fail-on-failure      Exit 1 when a journey fails

Safety: payment, purchase, delete and cancel actions are never performed on non-local hosts; form submission
on non-local hosts needs --allow-submit. Blocked steps are reported, not skipped silently.
```

## Experiment

### `jourilo experiment`

Plan and analyze experiments: sample size, plans from conversion hypotheses, significance and SRM checks on your data.

```
jourilo experiment <size|plan|analyze> …
```

```
Subcommands:
  size     --baseline 4% --mde 10% [--absolute] [--alpha 0.05] [--power 0.8] [--variants 2] [--daily-traffic N]
  plan     --finding <fingerprint> [--run latest] [--baseline 4%] [--mde 10%] [--daily-traffic N]
  analyze  --control 120/2400 --variant 150/2380 [--alpha 0.05] [--expected-share 0.5] [--planned N]

Jourilo never invents traffic, conversions or effects: every number comes from you or from the formulas.
```

## Improve

### `jourilo optimize`

Plan (and with --apply, make) minimal source fixes for located findings; shows diffs, checkpoints first.

```
jourilo optimize [run=latest] --repo <path> [--rule id ...] [--apply]
```

```
Deterministic fixers (others are reported with source candidates for a person or agent to fix):
  axe/html-has-lang, jourilo/missing-viewport-meta, jourilo/input-purpose, jourilo/focus-visible, jourilo/paste-blocked
Without --apply nothing is written. With --apply, a git checkpoint is created first (jourilo rollback undoes it).
Afterwards run `jourilo verify <run>` to repeat the audit and compare.
```

### `jourilo verify`

Repeat a run with the same scope (pages, viewports) after a change and compare: fixed, new, persisting, metric deltas.

```
jourilo verify <baseline-run> [--target url|dir] [--fail-on-regression]
```

### `jourilo checkpoint`

Record a git checkpoint of the working tree (no commits, branches or stash entries are created).

```
jourilo checkpoint [--repo .] [--note text] | checkpoint diff [id=latest]
```

### `jourilo rollback`

Restore tracked files to a checkpoint (requires --yes). Untracked files created since are listed, not deleted.

```
jourilo rollback <checkpoint-id|latest> --yes [--repo .]
```

## Results

### `jourilo report`

Re-render the report for a run (html, markdown, sarif or json) — default: latest run.

```
jourilo report [run-id|latest|path] [--format html|md|sarif|json] [--baseline run-id]
```

### `jourilo compare`

Compare two runs (before/after): fixed, new and persisting findings plus lab metric deltas.

```
jourilo compare <baseline-run> [head-run=latest] [--fail-on-regression]
```

### `jourilo runs`

List stored runs in the workspace (.jourilo/runs).

```
jourilo runs
```

### `jourilo finding`

Add a judgment (AI inference or user input) to a run, tied to evidence in that run; never mixed with measurements.

```
jourilo finding add --run <id> --title … --category usability --description … --evidence screenshots/x.jpg [--by agent|user]
```

## System

### `jourilo agent`

Install Jourilo instructions for other agents: bare /jourilo Claude skill, Codex (AGENTS.md), Cursor rule.

```
jourilo agent <list|install <claude-skill|codex|cursor>> [--project .] [--command "npx jourilo"] [--write]
```

```
Without --write the file content and destination are printed and nothing is written.
```

### `jourilo bench`

Benchmark detection quality on fixture sites with known defects (recall, false positives, source accuracy).

```
jourilo bench [fixtures-dir=fixtures/sites] [--only name] [--record docs/evaluation/bench-history.jsonl]
```

### `jourilo serve`

Serve a static build directory on 127.0.0.1 (for audits and journeys of static sites).

```
jourilo serve <dir> [--port 4173]
```

### `jourilo setup`

Download the Playwright browser build Jourilo drives (Chromium by default, ~150 MB, one time).

```
jourilo setup [--browser chromium|firefox|webkit]
```

### `jourilo doctor`

Check the toolchain: Node.js, playwright-core, browsers, axe-core.

```
jourilo doctor
```
