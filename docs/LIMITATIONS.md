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

## Performance

- Lab numbers come from one visit unless `--runs N` is used (median and range of N cold-cache visits); `verify` only
  calls a change "improved" or "regressed" when the ranges of repeated visits do not overlap. Local servers make LCP
  unrealistically fast. `--throttle`
  approximates Lighthouse's mobile profile in Chromium only. Measured on a local fixture it slowed rendering and
  subresources (LCP 16 → 200 ms, load 13 → 342 ms) but did **not** delay the main document from 127.0.0.1 (TTFB
  unchanged), so TTFB under `--throttle` is not meaningful for local targets.
- INP is approximated from scripted journey interactions; it is not field INP.

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
- Experiment statistics: two-proportion z-test with fixed horizon only; no sequential testing, no continuous metrics,
  no CUPED. Jourilo does not connect to analytics or flag providers yet; plans list detected tools only.

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
- `--proxy` (or `HTTPS_PROXY` / `HTTP_PROXY`, skipped when `NO_PROXY` matches the target) chains to an upstream HTTP
  proxy behind the guard. The guard still resolves and checks every destination, then asks the proxy for a tunnel to
  the checked address (`CONNECT 93.184.216.34:443`), never to the name: a proxy that allows destinations by host name
  sees only addresses. Only `http://` proxies are supported; loopback addresses are reached directly. The run records
  the proxy as `http://host:port` without its credentials. `NO_PROXY` is matched against the target only, not each
  request.
- `--allow-hosts` and `--block-hosts` refuse hosts by name (`*.example.com` matches its subdomains, not
  `example.com`); the target's own host is always allowed. Refused requests are listed in the run's limitations.
- Lab timings include one local proxy hop per connection.
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
  `--auth` for cookies. `jourilo verify` cannot replay headers it never stored: give them again.
- `--ignore-https-errors` changes certificate checking in the browser only. The guard still checks every destination
  (it sees each CONNECT before any TLS), and the run lists the setting in its limitations. `robots.txt` and sitemaps
  are still fetched with certificate checking, so on a self-signed site they are treated as missing.
- `--user-agent` replaces the browser's User-Agent header and `navigator.userAgent`. `robots.txt` is still read and
  matched as Jourilo's own user agent.

## Reports

- The report interface is in English and Turkish; finding titles, descriptions and recommendations come from the
  rules and stay in English, and page text stays as captured.
- Repair prompts are text. Whether a coding agent follows them is outside Jourilo's control; `jourilo verify` is
  what shows whether a fix worked.
- Before/after crops reuse the baseline element's position on the new screenshot; if the layout moved, the "after"
  crop shows the same place, not necessarily the same element. Baseline images load from the sibling run folder, so
  moving a run folder elsewhere breaks them (the report still renders).
- Root-cause grouping is lexical (rule + source line or selector), not a semantic judgment.
- History in the report lists earlier runs of the same target with defect counts; it does not normalize for different
  page sets or viewports (use `verify` for like-for-like comparisons).
- Screenshots are capped at 12 000 px height.
