# Jourilo 1.3.0

## 1.3.0 (2026-11-13)

A minor release that closes the remaining field items from the portfolio site and the container adapter (F8, F15,
F16, F21, F22, F23, F26, F29, F31, F35, F36 and F38 in [FIELD-FEEDBACK.md](FIELD-FEEDBACK.md)). Details are in the
[changelog](../CHANGELOG.md).

- **Contrast over images is decided** from the rendered pixels inside the text's line boxes; the worst tile decides.
  A fail is `jourilo/contrast-over-image` (WCAG 1.4.3), a clear pass leaves the review list.
- **Corporate networks:** `--proxy` (or `HTTPS_PROXY` / `HTTP_PROXY`, with `NO_PROXY` per destination) behind the
  network guard, which gives the proxy only checked addresses; `--allow-hosts` and `--block-hosts`.
- **Request options:** `--user-agent`, `--extra-header` (target origin only, values never stored) and
  `--ignore-https-errors` (the guard still checks every destination).
- **Containers:** an opt-in Chromium sandbox (`--chromium-sandbox`) and `browser.pids` for cleanup after a `SIGKILL`.
- **Detection:** `jourilo/redirect-chain` for pages reached through 3 or more redirects; keyboard traps found wherever
  focus starts.
- **Automation:** `--budget`, `--wait-for`, `rules list --json`, progress lines with `phase` / `done` / `total`,
  versions and scope in `manifest.json`, distinct pages and captures with what a sample left out.
- **Stable evidence:** one rounded performance evidence item per metric and viewport; screenshot names that do not
  depend on the host or port.
- **Upgrade notes:** `rules list --json` prints `{ jourilo, axe, rules }`; screenshot names and performance evidence
  change once; redacted scope URLs make `verify` refuse such baselines; a broken proxy variable in the environment
  now fails browsing commands (exit 2); plain `http://` through a proxy needs `CONNECT` to port 80; a contrast review
  item may now be a decided defect. See the changelog.

`RUN_SCHEMA_VERSION` stays 1. No new runtime dependencies.

### Evidence (2026-11-13, macOS 27, Node 22.23, Playwright 1.64.1)

| Check                                                                           | Result |
| ------------------------------------------------------------------------------- | ------ |
| `npm run ci` (lint, typecheck, build, unit and browser tests, dist check)       | TBD    |
| Fixture benchmark (`npm run bench`)                                             | TBD    |
| Independent W3C ACT benchmark, precision / recall / false positives             | TBD    |
| `scripts/smoke-pack.mjs` (clean install from the packed tarball, every command) | TBD    |
| `claude plugin validate` (marketplace and plugin, strict)                       | TBD    |
| Real project (cihanca.com, read-only), F1                                       | TBD    |
| — F3                                                                            | TBD    |
| — F5                                                                            | TBD    |
| — F8: the inconclusive contrast nodes over images                               | TBD    |

No automated run shows WCAG conformance.

### Known limitations (1.3.0)

- Contrast sampling covers at most 30 nodes per capture; a light and dark pattern finer than one tile can be averaged
  into a pass, and text under a tint stays for review.
- The guard resolves every name itself, so a network where only the proxy can resolve names cannot be audited
  through it. Only `http://` proxies are supported; `NO_PROXY` has no CIDR ranges.
- A proxy that refuses tunnels to port 80 fails plain-HTTP requests: audit such targets at their `https://` URL.
- `--extra-header` requests are fetched by Jourilo without following redirects: a redirect loses the headers, a
  streaming response arrives only when it ends, `--throttle` does not slow those responses, and `verify` needs the
  headers again.
- `browser.pids` is a snapshot taken at launch and is left behind only by a `SIGKILL` or a crash; ids can be reused.
- `--wait-for` with a selector that never appears costs up to `--timeout` per capture.
- `verify` does not apply `--budget`, and refuses a baseline whose scope URLs had query values redacted.
- One cause seen on many pages is still reported once per page when its evidence differs by a volatile token such as
  a CSP nonce (F44, open for 1.4.0).
- The 1.2.1 limitations still apply, except the four items carried to 1.3.0, which are fixed. The full list is in
  [LIMITATIONS.md](LIMITATIONS.md).
