# Security and data-safety review (v1.0.0)

Review of the 0.1.0 code base on 2026-10-31, the fixes made for 1.0.0, the tests that hold them in place, and the
risks that remain. It covers what Jourilo itself does on the user's machine and network; it is not a review of the
sites Jourilo audits.

## Threat model

Jourilo drives a real browser against sites that may be hostile, and it can write to the user's repository.

| Asset                                      | Threat                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Services on the user's machine and network | An audited page makes the browser call loopback, LAN or cloud-metadata endpoints (SSRF through the browser). |
| The user's source code                     | A fix or rollback overwrites or loses work; a write escapes the repository.                                  |
| Data in the audited application            | Journeys or probes delete, pay, cancel or create records the user did not intend.                            |
| Secrets                                    | Sessions, tokens and typed values leak into reports, screenshots, traces, git or third parties.              |
| The agent using Jourilo                    | Page content carries instructions (prompt injection).                                                        |

## Findings and fixes

| ID  | Finding in 0.1.0                                                                                                          | Fix in 1.0.0                                                                                                                                                                                                                                     | Regression tests                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| S-1 | A host whose DNS answer mixed public and private addresses was accepted as a target.                                      | Any non-public answer refuses the target without `--allow-private`; metadata and reserved answers are refused always.                                                                                                                            | `security.test.ts` (mixed answers, metadata, DNS failure)                            |
| S-2 | Only the target URL was checked; subrequests, redirects, iframes, WebSockets and DNS rebinding reached any address.       | Network guard (`core/net-guard.ts`): a local proxy for all browser traffic that resolves names itself and connects to the checked address (no second lookup to rebind). WebRTC and QUIC are disabled so traffic cannot bypass it.                | `net-guard.test.ts` in Chromium, Firefox and WebKit; `unit/net-guard.test.ts`        |
| S-3 | robots.txt/sitemap fetches followed redirects to any host before checking the origin.                                     | Manual redirects, same origin only, every hop resolved and checked before connecting.                                                                                                                                                            | `unit/net-guard.test.ts` (redirect to a private address is never requested)          |
| S-4 | Address classes missed 0.0.0.0/8 variants, IPv6 site-local/multicast, NAT64/6to4/IPv4-compatible forms, reserved ranges.  | `classifyIp` covers the IANA special-purpose registries in use, embedded IPv4 in IPv6, and known metadata endpoints (AWS, GCP, Azure, Alibaba, ECS).                                                                                             | `security.test.ts` (40 addresses, numeric host forms)                                |
| D-1 | `rollback` restored every file changed since the checkpoint, overwriting later user edits silently.                       | Fix transactions: a file is restored only while it holds exactly the bytes Jourilo wrote; otherwise it is a conflict and left alone (`--force` saves the current bytes first). Checkpoint rollbacks are transactions too, so they can be undone. | `unit/git.test.ts` (later edits, deleted files, forced restore, undo of a rollback)  |
| D-2 | Non-atomic writes, no recovery after a partial failure, no rollback outside git.                                          | Backups and a record are written before any file; writes are temp-file + fsync + rename; a failure part-way restores what was written; an interrupted apply blocks new ones until rolled back. Git is not required.                              | `unit/git.test.ts` (failure on the third file, killed process, non-git directory)    |
| D-3 | A write could escape the repository through a symlinked parent directory of a new file.                                   | `resolveInside` resolves the deepest existing ancestor; transactions refuse to write through symlinks.                                                                                                                                           | `unit/git.test.ts` (symlinked file and directory)                                    |
| D-4 | Apply did not check that a file was unchanged since the plan.                                                             | Preflight compares exact bytes; nothing is written if any file changed. Files that are not valid UTF-8 are never rewritten.                                                                                                                      | `unit/git.test.ts`                                                                   |
| J-1 | A key press without a target bypassed the safety policy.                                                                  | The focused element is judged like a click target.                                                                                                                                                                                               | `action-safety.test.ts`                                                              |
| J-2 | Enter/Space on a "Delete" button ignored its name.                                                                        | `keyEffect` maps keys to activation or submission and applies the same policy.                                                                                                                                                                   | `unit/journeys.test.ts`, `action-safety.test.ts`                                     |
| J-3 | Only visible text was judged; icon buttons, `formaction`, form `action`, link `href`, scripts and other origins were not. | Element signals (identifiers, icon names, link and form targets) plus a request-level backstop: every request during a journey is checked (DELETE, destructive/payment endpoints, form posts on non-local hosts, navigation to other origins).   | 10 adversarial journeys in `action-safety.test.ts`; multilingual cases in unit tests |
| J-4 | The element was checked through one locator resolution and clicked through another.                                       | One element handle is checked and activated.                                                                                                                                                                                                     | `action-safety.test.ts`                                                              |
| F-1 | Audits submitted empty forms to local servers, writing to local databases.                                                | Simulated by default: submit handlers and native validation run, every request that would send data is intercepted. Real submission only with `--allow-submit`. Keyboard and widget checks run read-only too.                                    | `action-safety.test.ts` (persistent store unchanged; positive control)               |
| P-1 | The static server served hidden files (`.env`, `.git/`) to the audited page, and a malformed URL escape could crash it.   | Hidden path segments are refused (except `.well-known`); malformed escapes return 400.                                                                                                                                                           | `security.test.ts`                                                                   |
| P-2 | A saved session (`--save-auth`) could be written inside a repository and committed.                                       | Warning in the run and on the console when git would commit the file.                                                                                                                                                                            | `unit/git.test.ts`                                                                   |

## Controls confirmed without change

- Reports: all page-derived strings are HTML-escaped; the report has a restrictive Content-Security-Policy
  (`report.test.ts`).
- Redaction of URLs and text (tokens, keys, e-mail addresses, card numbers) before anything is written
  (`security.test.ts`); screenshots mask password, card and `[data-private]` fields.
- Saved sessions are written with owner-only permissions after a passing journey only.
- Commands run with argument arrays (git, Playwright's installer); no shell is involved.
- Plugin skills and the agent adapters tell agents to treat page content as untrusted data.

## Residual risks (not claimed as solved)

1. **WebKit and HTTPS redirects to loopback.** WebKit on macOS sends a redirect to `127.0.0.1`/`localhost` directly
   instead of through the proxy. Over plain HTTP the guard refuses such redirects; over HTTPS it cannot see them. The
   run detects the escaped request and reports it as a security event, but cannot prevent that first request. Use
   Chromium (the default) or Firefox for sites you do not trust.
2. **Keyword-based action classification.** Destructive and payment actions are recognized from names, identifiers
   and URLs in five languages plus HTTP methods. An endpoint named neutrally (`POST /api/x` that deletes data) on a
   local host with a journey that is allowed to submit is not recognized. Use disposable data for journeys that
   submit.
3. **Background requests on public hosts.** During journeys without `--allow-submit`, first-party POSTs (including
   telemetry) are blocked; a site that needs them may behave differently, and the report says how many were stopped.
4. **Screenshots and traces** show whatever the page shows outside the masked fields; traces contain typed values.
   They stay in `.jourilo/` (git-ignored) and must not be shared when real data was visible.
5. **Proxy overhead.** Lab timings include one local proxy hop per connection on the same machine.
