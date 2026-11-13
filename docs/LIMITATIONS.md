# Known limitations

Stated so nobody mistakes silence for a pass.

## Platforms

| Platform                       | Status                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Node 20 and 22          | GitHub Actions: all tests pass (unit, Chromium/Firefox/WebKit browser tests, repair loop); also tested locally on Apple Silicon                             |
| Linux (Ubuntu), Node 20 and 22 | GitHub Actions: all tests pass; detection benchmark passes                                                                                                  |
| Windows, Node 20 and 22        | GitHub Actions: all tests pass (after making rollback byte-exact under `core.autocrlf=true`)                                                                |
| Chromium, Firefox, WebKit      | fixture audits, journeys, signed-in audits and form checks give identical results in all three (tested on every CI platform)                                |
| WebKit on Windows              | neither Tab nor Alt+Tab focuses links, so link focus checks are not run; the report states this as a limitation                                             |
| Stopping early on Windows      | Windows has no POSIX signals: a SIGTERM from another process ends Jourilo at once, with no partial run. Use `--max-duration`, which works on every platform |

## Accessibility

- Automated checks cover part of WCAG 2.2. Not covered automatically: 1.3.3 sensory characteristics, 2.5.7 dragging
  alternatives, 3.2.6 consistent help, 3.3.7 redundant entry, most of 3.3.8 (only paste blocking is checked), meaning
  of alt text, reading order, screen-reader announcements, captions quality, cognitive load. A run never certifies
  compliance.
- The keyboard walk visits up to 60 stops per page and only on keyboard (non-touch) viewports by default. Dialogs and
  disclosures that declare `aria-haspopup`/`aria-expanded` are operated with Enter/Escape. Composite widgets (tabs,
  radio groups, list boxes, menu bars, trees) are tested for keyboard reachability (do the arrow keys reach the other
  items?); the full arrow-key patterns (Home/End, typeahead, menus opening submenus, grids) are not.
- Focus-visible detection compares the styles of the element and its parent, then the pixels around the element with
  and without focus, so indicators drawn by a sibling are seen; an indicator drawn far away from the element is not.
- Focus hidden by other content is found when an opaque, hit-testable element covers the focused element at the
  sample points. Not found: an overlay with `pointer-events: none` (it is invisible to hit-testing), a cover that is
  only translucent, an iframe or embedded object painting over the element, `oklch()`/`lab()` backgrounds with
  alpha, and a cover that reaches the element only outside the five sampled points.
- A dialog's focus containment is judged after a short wait for focus guards (about 4 frames, at most 250 ms). A
  guard that wraps later than that is treated as a sentinel: an empty, hidden element that holds focus is not a
  stop, so a very slow library can still be misjudged in either direction.
- Sideways scrolling is reported as a defect only when an element that causes it is located. Overflow without a
  located element is a needs-review item with low confidence, so it never fails `--fail-on`.
- A keyboard trap whose page explains a way out ("Press Ctrl+M to exit") is tested with that key; if it works the
  trap is listed for review (WCAG 2.1.2 allows it), not as a defect. Whether the explanation is announced before
  focus is held needs a person.
- A trap is also found where nothing else is focusable, wherever focus starts: focus that never returns to the page
  and stays among at most 10 elements through 12 presses each of Tab, Shift+Tab and Tab after Escape. A set that lets
  focus go only after more presses, or a larger set, is not reported. Firefox keeps focus on the last element of the
  tab order while it moves to the browser's own interface, so there a single element that holds focus at the end of
  the order cannot be told from a normal end and is not reported. Focus held inside a dialog (`aria-modal="true"`, an
  open `<dialog>`, or `role="dialog"` / `role="alertdialog"`, which cookie walls often use without `aria-modal`) is
  not a trap, so a non-modal widget that wrongly declares a dialog role and holds focus is not reported.
- Contrast over an image, a gradient or an overlapping element (left to manual review by axe-core) is decided from
  the rendered pixels: the text's line boxes are cut into tiles of about one font size, and in each tile that holds
  the text color the 20 % of pixels farthest from it count as its background. The worst tile decides, so text over a
  busy photo that fails somewhere is not passed. At most 30 such nodes are sampled per capture; the rest stay
  manual-review items. A decided pass removes the review item. A light and dark pattern finer than one tile can be
  averaged into a pass, and text not rendered in its computed color (under a tint) stays for review. Pieces of a
  line box narrower than 16 px are not sampled. Sampling scrolls to each node, which can start lazy loading or
  scroll-triggered animations before the later checks of that capture, and on a page with many such nodes it adds
  noticeable time to the capture.

## Performance

- Lab numbers come from one visit unless `--runs N` is used (median and range of N cold-cache visits); `verify` only
  calls a change "improved" or "regressed" when the ranges of repeated visits do not overlap. Local servers make LCP
  unrealistically fast. `--throttle`
  approximates Lighthouse's mobile profile in Chromium only. Measured on a local fixture it slowed rendering and
  subresources (LCP 16 → 200 ms, load 13 → 342 ms) but did **not** delay the main document from 127.0.0.1 (TTFB
  unchanged), so TTFB under `--throttle` is not meaningful for local targets.
- INP is approximated from scripted journey interactions; it is not field INP.
- A redirect chain is counted from the HTTP redirects (3xx) of the navigation to the page, at most 10 of them. A
  redirect made by a script or a `<meta http-equiv="refresh">` is not counted. With `--extra-header`, redirects
  from the target's origin are handed to the browser by Jourilo and may not be counted, so `jourilo/redirect-chain`
  can be missed (never reported wrongly).
- `--wait-for SELECTOR` costs time: a capture whose element never appears waits up to `--timeout` before it is
  audited as it is, and the extra lab visits of `--runs N` wait for the element only where the capture found it.
- With `--throttle` and `--extra-header`, the target-origin responses Jourilo fetches itself and hands to the browser
  are not network-throttled (the CPU slowdown still applies); the run says so in its limitations.

## Journeys and forms

- `journeys suggest` picks the most emphasized control as the main call to action; on a real site (1.1.0 validation)
  that was a theme toggle. Review suggested journeys before running them.
- Suggested journeys are heuristics from page structure; they need review. `--repeat N` detects flaky journeys but
  cannot tell a product race from a fragile journey definition; the report says which attempts failed. No multi-tab, file upload, OAuth popup,
  CAPTCHA or e-mail verification support. Signed-in flows need a test account: run a sign-in journey with
  `--save-auth`, or provide a Playwright storage state.
- A setup journey (`--setup-journey`) carries over cookies and `localStorage` only. State kept in memory (a
  single-page app's store, `sessionStorage`, an open dialog, a service worker's cache) is gone when each page loads
  in its own context, so the audited page can differ from the page the journey left. Check the first screenshot.
- `--clock` freezes only `Date`; `performance.now()`, timers, animations and CSS keep real time. A page that reads
  the time from a timer or a server still shows the real one. `--timezone` changes the zone only.
- With `journeys run --repeat N`, the step screenshots and other step files carry the attempt index in their names
  (`-a1`, `-a2`, …), so a kept file always belongs to its own attempt.
- The keyboard walk steps past the first trap it finds; a second trap on the same page ends the walk.
- Form validation is probed on local hosts by simulating an empty submission: requests that would send data are
  intercepted, so validation that only the server performs is reported as not tested. `--allow-submit` sends the
  submission for real (disposable environments only).
- The journey safety policy recognizes destructive and payment actions from names, identifiers and URLs in five
  languages and from HTTP methods. A neutrally named endpoint that deletes data (`POST /api/x`) is not recognized;
  journeys that submit should use disposable data.
- Without `--allow-submit`, journeys on non-local hosts cannot send first-party POST requests (including some
  telemetry); the journey result lists what was stopped.

## Evidence size

- `--evidence minimal` keeps the first screen of a page that has no finding on the full page; the rest of that page
  is not kept, so a reviewer cannot look below the first screen afterwards. Pages with a finding keep the full-page
  screenshot, and a page shorter than the viewport is stored once. Use full evidence when a person will review the
  whole page. Under `audit --evidence minimal`, the screenshots of a setup journey's steps are all kept.

## Conversion and experiments

- Conversion rules are text/structure heuristics. Vocabulary (calls to action, trust and pricing signals, form
  purposes, error messages, field names, and the safety policy's destructive/financial actions) covers English,
  Turkish, German, Spanish and French; other languages fall back to structure-only signals.
- Experiment statistics: conversion (two-proportion) metrics only, with a fixed-horizon z-test or a sequential mSPRT
  (always-valid p-value and confidence sequence, normal approximation); no continuous metrics, no CUPED. The CLI keeps
  no history between `analyze` runs, so each run is one look. `--from` reads results read-only from PostHog,
  GrowthBook and Amplitude; Jourilo does not create or change experiments or flags, and plans list the detected
  tools only.

## Discovery and root causes

- Repository discovery is lexical (file patterns and regexes), not AST-based. Laravel route files, groups and
  Filament panels are followed; router configs built dynamically at runtime are missed, and a configurable route
  prefix is shown with its local default. Website discovery crawls up to 30 pages, same origin only; on a local
  target, a sitemap that lists production URLs is mapped onto the local server, otherwise sitemaps on other origins
  are ignored.
- Source location is lexical and can be wrong; each candidate states its reason and confidence. Seven fix types are
  automated; everything else is done by a person or an agent and then verified.

## Network safety

- Every browser request goes through Jourilo's local network guard, which refuses loopback, LAN and cloud-metadata
  addresses for public targets. WebKit on macOS follows HTTPS redirects to `127.0.0.1`/`localhost` outside the
  guard: such a request is detected and reported as a security event, but not prevented. Use Chromium (default) or
  Firefox for untrusted sites. See [SECURITY-REVIEW.md](SECURITY-REVIEW.md).
- `--deny-local` (and `JOURILO_DENY_LOCAL`) refuses targets, redirects and subresources that point at loopback,
  `*.localhost` and `*.test`, and a name that resolves to loopback; a directory target is served on 127.0.0.1 and may
  reach only its own port. It does not cover other private ranges (use the default guard for public targets), and it
  is refused with `--browser webkit` because WebKit's HTTPS redirects bypass the proxy. A blocked request appears in
  the run's limitations and can show as an error page for that URL.
- `--proxy` (or `HTTPS_PROXY` / `HTTP_PROXY`) chains to an upstream HTTP proxy behind the guard. The guard still
  resolves and checks every destination, then asks the proxy for a tunnel to the checked address, never to the name:
  `CONNECT 93.184.216.34:443` for HTTPS and WebSockets, and `CONNECT 93.184.216.34:80` for plain HTTP, whose request
  (with its original `Host` header) is sent inside the tunnel. A proxy that allows destinations by host name therefore
  sees only addresses. Many proxies refuse tunnels to port 80 (or to any port but 443): plain-HTTP requests then fail
  with "the upstream proxy refuses tunnels to port 80; give the target's https:// URL", so audit the target at its
  `https://` URL. A proxy that answers the tunnel with a 5xx could not reach the site; that request fails with "the
  upstream proxy could not open the connection" instead. A proxy's refusal, its `407` or an unreachable proxy is
  reported as a failed request, never as a page. Only `http://` proxies are supported; loopback addresses are reached
  directly. `NO_PROXY` is decided per destination host, as curl and browsers do (`NO_PROXY=*` means no proxy; CIDR
  ranges are not supported). The run records the proxy as `http://host:port` without its credentials. A tunnel
  is accepted only when the proxy answers `200`. Jourilo reads `HTTPS_PROXY` / `HTTP_PROXY` from the environment: a
  value that is not a usable `http://` proxy (for example `socks5://…`) fails every browsing command with exit 2;
  set `NO_PROXY=*` or unset the variable to go direct.
- Because the guard resolves every name itself (so that it can check the address), a network where only the proxy can
  resolve external names cannot be audited through the proxy. Command-line arguments show in `ps` and in shell
  history: give proxy credentials through `HTTPS_PROXY` / `HTTP_PROXY` rather than `--proxy`, and keep an
  `--extra-header` value in a variable the shell expands (`--extra-header "Authorization: $TOKEN"`), which keeps it
  out of the history, though not out of `ps` while the run lasts.
- `--allow-hosts` and `--block-hosts` refuse hosts by name (`*.example.com` matches its subdomains, not
  `example.com`); the target's own host is always allowed. Refused requests are listed in the run's limitations.
  Only the host given as the target is added to `--allow-hosts`, not the hosts it redirects to: a target that
  redirects to `www.` (or another host) needs that host in the list too, or is best given at its final URL.
  `jourilo verify` uses the baseline's lists again when none are given and cannot drop them: to verify without a
  list, audit again without it.
- Lab timings include one local proxy hop per connection.
- Layout shift (CLS) includes shifts caused by font swaps, so it varies with font caching and font loading. That is
  real layout shift for a visitor, so it stays in the metric. Performance evidence in findings has one item per metric
  and viewport, with milliseconds rounded to the nearest 10 and CLS to 3 decimals, so snapshots change less often (a
  value close to a rounding boundary can still flip between runs), and up to five layout-shift items per viewport; the raw values are in `run.pages[].metrics`, which `--budget` reads.
- `--extra-header "Name: value"` is sent only with requests to the target's origin (scheme, host and port), never to
  another origin. Playwright would carry an overridden header along every hop of a redirect chain, so Jourilo makes
  each request to the target's origin itself (through the guard) without following redirects and hands the response
  to the browser: a redirect, even within the origin, is followed without the headers and listed in the limitations,
  and the lab timings of those requests include that step. A target that redirects (for example `http://` to
  `https://`, or `/` to `/en/`) is best given at its final URL. WebSockets, `robots.txt` and sitemaps are requested
  without the headers; in WebKit a redirect from the target's origin fails. Header values are never written to
  `run.json`, reports, progress lines or the manifest (only the names are kept), and `journeys run --trace` is refused
  with `--extra-header` because a trace records header values. `Cookie`, `Host`, `Content-Length` and hop-by-hop
  headers (`Connection`, `Keep-Alive`, `Proxy-*`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`) are refused; use
  `--auth` for cookies. `jourilo verify` cannot replay headers it never stored: give them again. Because Jourilo
  fetches those responses whole before handing them to the browser, a streaming response from the target's origin
  (server-sent events, long polling) reaches the page only when it ends, and fails once `--timeout` passes; a large
  response is held in memory. A header value must be Latin-1 text (a usage error otherwise). A certificate or
  connection error on one of those requests is listed as a failed request without its reason.
- `--ignore-https-errors` changes certificate checking in the browser only. The guard still checks every destination
  (it sees each CONNECT before any TLS), and the run lists the setting in its limitations. `robots.txt` and sitemaps
  are still fetched with certificate checking, so on a self-signed site they are treated as missing.
- `--user-agent` replaces the browser's User-Agent header and `navigator.userAgent`. `robots.txt` is still read and
  matched as Jourilo's own user agent.

## Browser sandbox and cleanup

- Playwright starts Chromium with its process sandbox off (`--no-sandbox`), which is what makes it start in containers
  and CI. `--chromium-sandbox` (or `JOURILO_CHROMIUM_SANDBOX=1`) keeps the sandbox on for Chromium, Chrome and Edge. It
  is a usage error with `--browser firefox` or `webkit`; the environment variable is ignored there with a warning. A
  system that denies the sandbox cannot start the browser: in a container without the needed privileges, or on a Linux
  kernel that denies unprivileged user namespaces (some CI runners), the run ends with "browser unavailable" (exit 4).
  Jourilo's own test for the flag skips itself on such a kernel and on Windows, where it cannot inspect the process
  command line.
- While a Chromium run is going, its directory holds `browser.pids`: a snapshot, taken when the browser launched, of
  the process ids of the browser, GPU and network service processes, one per line (renderers and utility processes
  started later are not listed). The file is removed when the browser closes and on Jourilo's own exit, including
  after Ctrl-C, SIGTERM, a second signal (exit 130) and `--max-duration`, and is not listed in `manifest.json`. A
  `SIGKILL` of Jourilo (or a crashed machine) leaves the file and may leave the browser running: an integrator can
  clean up with `kill $(cat <run dir>/browser.pids)` (on Windows, `taskkill /F /PID` for each id). Check first that
  the ids still belong to Chromium, since ids are reused.
  Firefox and WebKit write no `browser.pids`.

## Reports

- The report interface is in English and Turkish. In a Turkish report, Jourilo's own rules show a Turkish title,
  impact and recommendation. These are fixed per rule, so they leave out values the English text names (a width, a
  journey name, a measured time, suggested autocomplete tokens, the nearest brand colors); the English description,
  the viewport and the journey shown with the finding still give most of them. Descriptions, reproduction steps and
  sources stay in English, and page text stays as captured.
- axe-core rule help stays English in Turkish reports, because axe-core ships no Turkish locale.
- Repair prompts are text. Whether a coding agent follows them is outside Jourilo's control; `jourilo verify` is
  what shows whether a fix worked.
- Before/after crops reuse the baseline element's position on the new screenshot; if the layout moved, the "after"
  crop shows the same place, not necessarily the same element. Baseline images load from the sibling run folder, so
  moving a run folder elsewhere breaks them (the report still renders).
- Root-cause grouping is lexical (rule + source line or selector), not a semantic judgment.
- History in the report lists earlier runs of the same target with defect counts; it does not normalize for different
  page sets or viewports (use `verify` for like-for-like comparisons).
- Screenshots are capped at 12 000 px height.
- Screenshot names come from the page's path and query, so `--url /a?x=1` and `--url /a?x=1#top` write the same file.
  A form-probe screenshot is named from the page's final URL, so a start URL that redirects to another host gets a
  name with an origin tag.
- Before/after pairs in `compare` and `verify` reports need the full-page screenshot; a page kept only as a first
  screen (`--evidence minimal`) has no pair image.
- One cause seen on many pages is reported once per page when the evidence differs between pages, for example by a
  CSP nonce in a console message (F44 in [FIELD-FEEDBACK.md](FIELD-FEEDBACK.md)).
- On a partial run (stopped early, exit 6), `sample.audited` and the manifest's `scope.urls` count the pages that
  were planned, not only those that finished; `pages` lists what finished.
- `jourilo verify` does not apply the baseline's `--budget`; it compares metrics with their ranges. Give `--budget`
  to a new `audit` to gate on it.
- `jourilo verify` cannot replay a baseline whose scope URLs had query values redacted (`?access_token=…`, `?code=…`): it refuses with exit 2; audit those pages again and verify against the new run.
