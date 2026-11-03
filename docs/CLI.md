# Jourilo CLI reference

<!-- Generated from src/cli/registry.ts by scripts/build.mjs. Do not edit by hand. -->

Every command prints human-readable text, or JSON with `--json`. Errors go to stderr; with `--json` they are
`{"error":{"code","message","hint"}}` with a stable `code`. Exit codes: 0 ok, 1 failed gate or error, 2 usage,
3 blocked by a safety rule (unsafe URL/path, robots.txt, policy), 4 browser unavailable, 5 no page could be loaded,
6 stopped early by SIGINT/SIGTERM or `--max-duration` (a partial run is still written; a second signal exits 130).

Global options: `--json`, `--workspace DIR` (default `.jourilo`, or `JOURILO_WORKSPACE`), `--quiet`. With `--json`,
progress lines on stderr are JSON too: `{"type":"progress","message":"…","at":"<ISO time>"}`.

## Understand

### `jourilo discover`

Product intelligence: map a repository (frameworks, routes, design system, i18n, auth, analytics) or a website (pages, conversion points, services).

```
jourilo discover <path|url> [--pages 10] [--ignore-robots] [--allow-private]
```

```
Options:
  --pages N         Pages to read when mapping a website (default 10)
  --ignore-robots   Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private   Allow private-network hosts (10.x, 192.168.x, ...)
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
  --headed             Show the browser window instead of running headless
  --locale TAG         Browser locale for every page (e.g. tr-TR); sets Accept-Language and navigator.language
  --timeout SECS       Per-page navigation timeout in seconds (default 30)
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --runs N             Visits per page and viewport for lab metrics; reports the median and range (default 1, max 9)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --timezone ZONE      IANA time zone for every page (e.g. Europe/Istanbul)
  --clock ISO          Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --setup-journey REF  Run this journey first (an id or a .json file) and audit the state it leaves, e.g. a chosen theme or
                       a dismissed banner; it follows the journeys safety policy and starts from --auth
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Skip the form validation probe
                       (by default, on local hosts, an empty submission is simulated: nothing that sends data
                       leaves the browser, so no database is written; server-side feedback is reported as untested)
  --allow-submit       Really send empty submissions to test server-side validation, on local or other hosts
                       (disposable/test environments you are authorized to use only; never to delete/payment URLs);
                       also lets a --setup-journey submit forms
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
  --evidence MODE      full (default) or minimal: keep first screens and only the full-page screenshots findings need; JPEG quality 55
  --run-id ID          Use this run id instead of a generated one (1-64 of A-Z a-z 0-9 _ -); refused if the run exists
  --max-duration SECS  Stop after this many seconds and write a partial run (exit 6), as SIGINT/SIGTERM do;
                       a second signal quits at once (exit 130)
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
  --headed             Show the browser window instead of running headless
  --locale TAG         Browser locale for every page (e.g. tr-TR); sets Accept-Language and navigator.language
  --timeout SECS       Per-page navigation timeout in seconds (default 30)
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --runs N             Visits per page and viewport for lab metrics; reports the median and range (default 1, max 9)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --timezone ZONE      IANA time zone for every page (e.g. Europe/Istanbul)
  --clock ISO          Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --setup-journey REF  Run this journey first (an id or a .json file) and audit the state it leaves, e.g. a chosen theme or
                       a dismissed banner; it follows the journeys safety policy and starts from --auth
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Skip the form validation probe
                       (by default, on local hosts, an empty submission is simulated: nothing that sends data
                       leaves the browser, so no database is written; server-side feedback is reported as untested)
  --allow-submit       Really send empty submissions to test server-side validation, on local or other hosts
                       (disposable/test environments you are authorized to use only; never to delete/payment URLs);
                       also lets a --setup-journey submit forms
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
  --evidence MODE      full (default) or minimal: keep first screens and only the full-page screenshots findings need; JPEG quality 55
  --run-id ID          Use this run id instead of a generated one (1-64 of A-Z a-z 0-9 _ -); refused if the run exists
  --max-duration SECS  Stop after this many seconds and write a partial run (exit 6), as SIGINT/SIGTERM do;
                       a second signal quits at once (exit 130)
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
  --headed             Show the browser window instead of running headless
  --locale TAG         Browser locale for every page (e.g. tr-TR); sets Accept-Language and navigator.language
  --timeout SECS       Per-page navigation timeout in seconds (default 30)
  --throttle           Simulate a mid-range phone network and 4x CPU slowdown (Chromium)
  --runs N             Visits per page and viewport for lab metrics; reports the median and range (default 1, max 9)
  --no-keyboard        Skip the keyboard-only walk
  --auth FILE          Playwright storage state for authenticated pages (see docs/PRIVACY.md)
  --timezone ZONE      IANA time zone for every page (e.g. Europe/Istanbul)
  --clock ISO          Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --setup-journey REF  Run this journey first (an id or a .json file) and audit the state it leaves, e.g. a chosen theme or
                       a dismissed banner; it follows the journeys safety policy and starts from --auth
  --mask SELECTOR      Extra elements to black out in screenshots (repeatable)
  --repo PATH          Map findings to likely source files in this repository (and read its brand/search context)
  --brand SLUG         Markilo brand to check design consistency against (default: master brand)
  --ignore-robots      Ignore robots.txt (only for sites you own or are authorized to test)
  --allow-private      Allow private-network hosts (10.x, 192.168.x, ...)
  --no-forms           Skip the form validation probe
                       (by default, on local hosts, an empty submission is simulated: nothing that sends data
                       leaves the browser, so no database is written; server-side feedback is reported as untested)
  --allow-submit       Really send empty submissions to test server-side validation, on local or other hosts
                       (disposable/test environments you are authorized to use only; never to delete/payment URLs);
                       also lets a --setup-journey submit forms
  --sarif              Also write report.sarif for code scanning
  --fail-on SEVERITY   Exit 1 if a defect at or above this severity exists (CI gate)
  --evidence MODE      full (default) or minimal: keep first screens and only the full-page screenshots findings need; JPEG quality 55
  --run-id ID          Use this run id instead of a generated one (1-64 of A-Z a-z 0-9 _ -); refused if the run exists
  --max-duration SECS  Stop after this many seconds and write a partial run (exit 6), as SIGINT/SIGTERM do;
                       a second signal quits at once (exit 130)
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

Suggest options:
  --pages N              Pages to read when deriving journeys from a site (default 8)
  --force                Overwrite journey files that already exist (by default existing files are kept)
  --allow-private        Allow private-network hosts (10.x, 192.168.x, ...)

Run options:
  --base URL|DIR         The site or static build to run against (required)
  --browser NAME         chromium (default), firefox, webkit, chrome, msedge
  --headed               Show the browser window instead of running headless
  --timeout SECS         Per-step timeout in seconds (default 10)
  --repo PATH            Map failed steps to likely source files in this repository (a directory --base implies it)
  --viewport LIST        desktop, mobile, … (default: the journey's own viewport or desktop)
  --var key=value        Test data for {{key}} placeholders (also JOURILO_VAR_KEY env vars)
  --allow-submit         Allow form submission on non-local hosts (authorized test environments only)
  --allow-destructive    Allow irreversible/payment actions — local hosts with sandbox data only
  --allow-origin ORIGIN  Let the page navigate to another origin you are authorized to test (e.g. a test IdP)
  --trace                Record a Playwright trace per journey (contains typed values; keep private)
  --auth FILE            Playwright storage state for signed-in journeys
  --save-auth FILE       After a passing sign-in journey (exactly one), save its session for --auth (test accounts only)
  --timezone ZONE        IANA time zone for the page (e.g. Europe/Istanbul)
  --clock ISO            Freeze the page's Date at this date-time (e.g. 2026-11-03T22:30:00+03:00); timers keep running
  --evidence MODE        full (default) or minimal: keep only the screenshots of the failed step, the step before it and the last step
  --repeat N             Run each journey N times (max 10); mixed outcomes are reported as flaky
  --allow-private        Allow private-network hosts (10.x, 192.168.x, ...)
  --fail-on-failure      Exit 1 when a journey fails

Safety: payment, purchase, delete and cancel actions are never performed on non-local hosts; form submission
on non-local hosts needs --allow-submit. The policy is checked twice: on the element about to be clicked or
pressed (its name, link target, form action and identifiers — icon-only buttons included), and on every request
the page then sends (form posts, DELETE, requests to delete/cancel/payment endpoints, navigation to other
origins). Blocked steps are reported, not skipped silently.
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

Plan (and with --apply, make) minimal source fixes for located findings; shows diffs, writes one reversible change.

```
jourilo optimize [run=latest] --repo <path> [--rule id ...] [--apply]
```

```
Deterministic fixers (others are reported with source candidates for a person or agent to fix):
  axe/html-has-lang, jourilo/missing-viewport-meta, jourilo/input-purpose, jourilo/focus-visible, jourilo/paste-blocked,
  jourilo/unsized-images, jourilo/placeholder-label
Options:
  --repo PATH      Repository to fix (default: the run's repo, else the current directory)
  --rule ID        Only fix findings of this rule (repeatable)
  --finding ID     Only fix this finding, by fingerprint (repeatable)
  --apply          Write the changes
Without --apply nothing is written. With --apply, all files are written as one change: each file must be unchanged
since the plan, writes are atomic, an interrupted apply is undone, and `jourilo rollback <id>` restores the files
(git is not required).
Afterwards run `jourilo verify <run>` to repeat the audit and compare.
```

### `jourilo verify`

Repeat a run with the same scope (pages, viewports) after a change and compare: fixed, new, persisting, metric deltas.

```
jourilo verify <baseline-run> [--target url|dir] [--fail-on-regression]
```

```
Options:
  --target URL|DIR       Where to repeat the audit (default: the baseline run's target)
  --repo PATH            Repository for source mapping (default: the baseline run's repo)
  --fail-on-regression   Exit 1 when new serious or critical defects appear
```

### `jourilo checkpoint`

Record a git checkpoint of the working tree (no commits, branches or stash entries are created).

```
jourilo checkpoint [--repo .] [--note text] | checkpoint diff [id=latest]
```

### `jourilo rollback`

Undo an applied fix (or restore a checkpoint) without overwriting later edits; requires --yes. The rollback can itself be undone.

```
jourilo rollback <id|latest> --yes [--repo .] [--file path ...] [--force]
```

```
For a change made by `optimize --apply` (or a previous rollback), a file is restored only while it still
holds exactly what Jourilo wrote. A file edited afterwards is reported as a conflict and left alone; --force restores
it anyway after saving the current bytes under .jourilo/checkpoints/<id>/conflicts/.
For a checkpoint made with `jourilo checkpoint`, every tracked file changed since then is restored (everything you
or an agent changed in the meantime); the current bytes are kept, and the printed id undoes the rollback.
Untracked files created after a checkpoint are listed, never deleted.
```

## Results

### `jourilo report`

Re-render the report for a run (html, markdown, sarif or json) — default: latest run.

```
jourilo report [run-id|latest|path] [--format html|md|sarif|json] [--baseline run-id]
```

```
Options:
  --format FMT     html (default), md, sarif or json; sarif and json print to stdout
  --baseline RUN   Include a comparison with this earlier run
  --stdout         With --format md, print the Markdown instead of only writing the file
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
jourilo finding add --run <id> --title … --category usability --description … --evidence screenshots/x.jpg [--by agent|user] | finding dismiss <id> --run <run> --reason "<text>" [--by user|agent] | finding undismiss <id> [--run <run>]
```

```
Subcommands:
  add                  Record a judgment tied to evidence in a run
  dismiss <id>         Mark a finding as not a problem; it is kept out of later runs and listed as dismissed
  undismiss <id>       Remove a dismissal; the next run reports the finding again

add options:
  --run ID             Run to add to (default latest)
  --title TEXT         Short title (required)
  --category NAME      accessibility, usability, responsive, performance, conversion, reliability, content or design-system (required)
  --description TEXT   What is wrong and why it matters (required)
  --evidence FILE      Screenshot or file inside the run, e.g. screenshots/home-desktop.jpg (required, repeatable)
  --kind KIND          defect, hypothesis or needs-review (default: hypothesis for conversion, else needs-review)
  --severity LEVEL     critical, serious, moderate, minor or info (default minor)
  --confidence LEVEL   low, medium or high (AI judgments are capped at medium)
  --impact TEXT        Who is affected and how
  --recommendation TEXT  What to change
  --url URL            Page the finding is about (default: the run's first page)
  --viewport NAME      Viewport the finding was seen in (e.g. desktop, mobile)
  --by WHO             agent (default) or user

dismiss options:
  --run ID             Run to apply it to now (default latest)
  --reason TEXT        Why this is not a problem (required)
  --by WHO             user (default) or agent

undismiss options:
  --run ID             Also bring the finding back into this run
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
