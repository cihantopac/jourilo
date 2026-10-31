# v1.0.0 release plan, backlog and checklist

Working document for taking Jourilo from 0.1.0 to 1.0.0. Every item has an acceptance criterion that is checked by a
test or a recorded run; the evidence column links to it. Nothing here is "done" because a version number changed.

Status keys: ☐ open · ◐ in progress · ☑ done (evidence linked) · ✗ excluded from 1.0 (documented as future work)

## Review findings that block 1.0 (2026-10-31)

| ID  | Area           | Finding (0.1.0 behaviour)                                                                                                                                                                                                    | Severity |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| S-1 | Network        | `checkTarget` accepts a host whose DNS answer mixes public and private addresses (only an all-private answer is refused).                                                                                                    | high     |
| S-2 | Network        | The browser itself is unguarded: subrequests, redirects, iframes and WebSockets from an audited public page can reach loopback, LAN and cloud-metadata addresses; DNS can rebind between the check and the browser's lookup. | high     |
| S-3 | Network        | robots.txt/sitemap fetches follow redirects to any host (including private addresses) before the origin is checked.                                                                                                          | medium   |
| S-4 | Network        | Address classification misses 0.0.0.0/8 variants, IPv6 site-local, multicast, NAT64/6to4/IPv4-compatible embeddings, hex IPv4-mapped forms and reserved ranges.                                                              | medium   |
| D-1 | Rollback       | `rollback` restores every file that differs from the snapshot, silently overwriting edits the user made after the checkpoint, also in files Jourilo never touched.                                                           | critical |
| D-2 | Rollback       | `optimize --apply` writes non-atomically, has no recovery after a partial failure, and applies changes in non-git directories without any rollback.                                                                          | high     |
| D-3 | Filesystem     | `resolveInside` does not resolve symlinked parent directories of a non-existent path, so a write can escape the repository through a directory symlink.                                                                      | high     |
| D-4 | Repair         | Apply does not check that a file is unchanged since the plan was computed.                                                                                                                                                   | medium   |
| J-1 | Journey safety | A `press` step without a target (e.g. Enter) is never checked by the safety policy.                                                                                                                                          | high     |
| J-2 | Journey safety | `press` on a target ignores the element's name, so Enter/Space on a "Delete account" button bypasses the destructive check.                                                                                                  | high     |
| J-3 | Journey safety | The policy only reads visible text/aria-label: icon-only buttons, `formaction`, form `action`, link `href` and request method are ignored; links to destructive GET endpoints and cross-origin navigations are not blocked.  | high     |
| J-4 | Journey safety | The element is checked through one locator resolution and clicked through another (time-of-check/time-of-use on dynamic pages).                                                                                              | medium   |
| F-1 | Form probe     | Audits submit empty forms on local hosts by default; local servers often have persistent databases.                                                                                                                          | high     |

## Plan

### P0 — security, safety and data integrity

| ID   | Work                                                                                                                                                                                 | Acceptance                                                                                                                                                        | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P0.1 | Complete address classification (IPv4/IPv6 special-purpose registries, embedded IPv4, metadata endpoints); refuse mixed DNS answers for targets.                                     | Unit tests for every range in the IANA special-purpose registries that matter; mixed answer refused without `--allow-private`.                                    | ☑      |
| P0.2 | Network guard: every browser request goes through a local guard proxy that resolves DNS itself and connects only to allowed addresses (no rebinding window).                         | Browser tests in Chromium, Firefox and WebKit: a public page cannot load loopback/LAN resources by literal IP, hostname, redirect or WebSocket; legit pages load. | ☑      |
| P0.3 | Node-side fetches (robots, sitemaps) use the same address policy per redirect hop.                                                                                                   | Unit test: redirect to a private address is not requested.                                                                                                        | ☑      |
| P0.4 | Fix transactions: preflight (unchanged since plan, no symlink escape), byte-exact backups, atomic writes, recovery of interrupted applies, no git required.                          | Tests: staged/unstaged/untracked changes, symlinks, CRLF, several fixes in one file, simulated crash mid-apply, edits after apply.                                | ☑      |
| P0.5 | Conflict-safe rollback: a file changed after the fix is never overwritten without `--force`, and `--force` saves the current bytes first.                                            | Tests: user edit after apply → conflict reported, file untouched; checkpoint rollback keeps a pre-rollback copy of every overwritten file.                        | ☑      |
| P0.6 | Journey action guard: one policy for clicks, keyboard (targeted or not), Enter submissions, and a network backstop for form posts, DELETE, destructive URLs, off-origin navigations. | Adversarial tests (icon-only, `formaction`, destructive GET link, JS-triggered DELETE, Enter in a field, multilingual names, element swap) all blocked.           | ☑      |
| P0.7 | Form probe without side effects by default: submission is simulated and any outgoing mutation is intercepted; real submission only with `--allow-submit`.                            | Test against a local app with a persistent store: audit leaves the store unchanged; findings still produced from client-side feedback.                            | ☑      |
| P0.8 | Privacy review: secrets, storage states, traces, screenshots, reports, command execution, prompt-injection boundary.                                                                 | Review notes in `docs/SECURITY-REVIEW.md` with residual risks; regression tests for each defect found.                                                            | ☑      |

### P1 — product completeness

| ID   | Work                                                                                                  | Acceptance                                                                          | Status |
| ---- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------ |
| P1.1 | Arrow-key patterns for composite widgets (menus, tabs, listboxes): Escape closes, focus returns.      | Fixture with broken and correct widgets; Chromium/Firefox/WebKit agree.             | ☐      |
| P1.2 | Journey flake detection (`--repeat N`) and stability report.                                          | Fixture with a deliberately flaky step is flagged; stable journeys report 0 flakes. | ☐      |
| P1.3 | Lab-metric stability: repeated-run medians in `verify`, spread shown, unmeasured conditions stated.   | Report shows median and range; verify does not call noise a regression.             | ☐      |
| P1.4 | Report polish: blocked requests/actions, measured vs. unmeasured conditions, manual-review checklist. | Report tests assert the sections; HTML/MD/JSON/SARIF consistent.                    | ☐      |
| P1.5 | Discovery accuracy on real repositories (AST where lexical is wrong).                                 | Real-repo validation table in EVALUATION.md with errors found and fixed.            | ◐      |

### Validation, distribution and release

| ID  | Work                                                                                       | Acceptance                                                                            | Status |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------ |
| V.1 | Independent benchmark (cases not designed with the rules), precision/recall per category.  | Results and method in EVALUATION.md; every engine defect found has a regression test. | ☐      |
| V.2 | Real local applications (read-only, disposable copies for repairs).                        | Evidence kept outside the public repo; summary without private data in EVALUATION.md. | ☐      |
| V.3 | Clean-install test of the packed tarball: every advertised command works from the package. | Script `scripts/smoke-pack.mjs` passes in CI on Linux, macOS, Windows.                | ☐      |
| V.4 | Claude Code marketplace install and `/jourilo:jourilo` flow; icon.                         | Headless plugin run recorded; validator has no warnings.                              | ☐      |
| R.1 | Versions, changelog, docs, limitations synchronized; no stale "unsupported" statements.    | Release workflow checks pass; doc review checklist below ticked.                      | ☐      |
| R.2 | CI green on all platforms and Node versions.                                               | Link to the run.                                                                      | ☐      |

## Release checklist (final gate)

- [ ] All advertised core functionality works end to end (V.3, V.4).
- [ ] No open critical/high defects (table above all ☑).
- [ ] Security and rollback protections verified (P0.\*).
- [ ] Clean install works (V.3).
- [ ] CLI and plugin both work (V.3, V.4).
- [ ] Cross-platform CI passes (R.2).
- [ ] Independent real-world validation completed (V.1, V.2).
- [ ] Known false positives and unstable journeys addressed (P1.2, V.\*).
- [ ] Safe repairs verified without unexplained regressions (P0.4, P0.5, repair test).
- [ ] Reports state measured and unmeasured conditions (P1.4).
- [ ] Documentation matches the product (R.1).
- [ ] Maintainer approval for npm publish and GitHub release.

## Evidence log

Newest first. Each entry: date, what was run, result, link.

- **2026-10-31 · Laravel discovery on a private Laravel 12 + Livewire + Filament 4 application (read-only).**
  Before: 6 routes (only `routes/web.php`), no auth, no panel. Defects found: included route files
  (`require __DIR__…`, bootstrap `then:` groups) not followed; `Route::livewire` not recognized; dynamic group
  prefixes ignored; Filament panels, nested Filament 4 resources and `$slug` overrides unknown; guards in
  `config/auth.php` unread. After: 50 routes matching the source by hand count, guards, panel login and 17
  auth-protected routes reported. Regression fixture: `fixtures/repos/laravel-portal` (generic, written for this),
  tests in `tests/unit/discovery.test.ts`.
- **2026-10-31 · P0 security and data-safety work.** Full local suite on macOS (Node 22, Chromium/Firefox/WebKit):
  212 of 214 passed before the last fix; the two failures were the cross-browser fixture audit expecting a real
  empty submission (now explicit with `--allow-submit`, as the benchmark does). New tests: `net-guard` (3 engines),
  `action-safety` (12 adversarial journeys + 2 form-probe tests against a persistent store), `unit/net-guard`,
  rollback/transaction scenarios in `unit/git.test.ts`, 40-address classification in `security.test.ts`.
  Defects and fixes: [SECURITY-REVIEW.md](SECURITY-REVIEW.md).
