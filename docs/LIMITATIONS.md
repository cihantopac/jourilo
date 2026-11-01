# Known limitations

Stated so nobody mistakes silence for a pass.

## Platforms

| Platform                       | Status                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| macOS, Node 20 and 22          | GitHub Actions: all tests pass (unit, Chromium/Firefox/WebKit browser tests, repair loop); also tested locally on Apple Silicon |
| Linux (Ubuntu), Node 20 and 22 | GitHub Actions: all tests pass; detection benchmark passes                                                                      |
| Windows, Node 20 and 22        | GitHub Actions: all tests pass (after making rollback byte-exact under `core.autocrlf=true`)                                    |
| Chromium, Firefox, WebKit      | fixture audits, journeys, signed-in audits and form checks give identical results in all three (tested on every CI platform)    |
| WebKit on Windows              | neither Tab nor Alt+Tab focuses links, so link focus checks are not run; the report states this as a limitation                 |

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

- Suggested journeys are heuristics from page structure; they need review. `--repeat N` detects flaky journeys but
  cannot tell a product race from a fragile journey definition; the report says which attempts failed. No multi-tab, file upload, OAuth popup,
  CAPTCHA or e-mail verification support. Signed-in flows need a test account: run a sign-in journey with
  `--save-auth`, or provide a Playwright storage state.
- The keyboard walk steps past the first trap it finds; a second trap on the same page ends the walk.
- Form validation is probed on local hosts by simulating an empty submission: requests that would send data are
  intercepted, so validation that only the server performs is reported as not tested. `--allow-submit` sends the
  submission for real (disposable environments only).
- The journey safety policy recognizes destructive and payment actions from names, identifiers and URLs in five
  languages and from HTTP methods. A neutrally named endpoint that deletes data (`POST /api/x`) is not recognized;
  journeys that submit should use disposable data.
- Without `--allow-submit`, journeys on non-local hosts cannot send first-party POST requests (including some
  telemetry); the journey result lists what was stopped.

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
- Lab timings include one local proxy hop per connection.

## Reports

- History in the report lists earlier runs of the same target with defect counts; it does not normalize for different
  page sets or viewports (use `verify` for like-for-like comparisons).
- Screenshots are capped at 12 000 px height.
