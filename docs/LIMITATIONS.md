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
  disclosures that declare `aria-haspopup`/`aria-expanded` are operated with Enter/Escape; arrow-key patterns
  (menus, tabs, listboxes, grids) are not tested yet.
- Focus-visible detection compares styles of the element and its parent; indicators drawn by other elements (e.g. a
  sibling) may be reported as missing.

## Performance

- Lab numbers come from one visit unless `--runs N` is used (median and range of N cold-cache visits); local servers
  make LCP unrealistically fast. `--throttle`
  approximates Lighthouse's mobile profile in Chromium only. Measured on a local fixture it slowed rendering and
  subresources (LCP 16 → 200 ms, load 13 → 342 ms) but did **not** delay the main document from 127.0.0.1 (TTFB
  unchanged), so TTFB under `--throttle` is not meaningful for local targets.
- INP is approximated from scripted journey interactions; it is not field INP.

## Journeys and forms

- Suggested journeys are heuristics from page structure; they need review. No multi-tab, file upload, OAuth popup,
  CAPTCHA or e-mail verification support. Signed-in flows need a test account: run a sign-in journey with
  `--save-auth`, or provide a Playwright storage state.
- The keyboard walk steps past the first trap it finds; a second trap on the same page ends the walk.
- Form validation probing submits empty forms on local hosts by default; servers that accept empty submissions will
  create records in local/test databases.

## Conversion and experiments

- Conversion rules are text/structure heuristics. Vocabulary (calls to action, trust and pricing signals, form
  purposes, error messages, field names, and the safety policy's destructive/financial actions) covers English,
  Turkish, German, Spanish and French; other languages fall back to structure-only signals.
- Experiment statistics: two-proportion z-test with fixed horizon only; no sequential testing, no continuous metrics,
  no CUPED. Jourilo does not connect to analytics or flag providers yet; plans list detected tools only.

## Discovery and root causes

- Repository discovery is lexical (file patterns and regexes), not AST-based. Router configs written dynamically are
  missed. Website discovery crawls up to 30 pages, same origin only, sitemaps on other origins are ignored.
- Source location is lexical and can be wrong; each candidate states its reason and confidence. Five fix types are
  automated; everything else is done by a person or an agent and then verified.

## Reports

- History in the report lists earlier runs of the same target with defect counts; it does not normalize for different
  page sets or viewports (use `verify` for like-for-like comparisons).
- Screenshots are capped at 12 000 px height.

## Other

- No icon/brand identity yet for the plugin listing.
