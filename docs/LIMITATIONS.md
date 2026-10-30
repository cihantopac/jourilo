# Known limitations

Stated so nobody mistakes silence for a pass.

## Platforms

| Platform                       | Status                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| macOS (Apple Silicon), Node 22 | tested: unit, browser, plugin, repair loop                                                       |
| Chromium                       | tested (primary)                                                                                 |
| Firefox, WebKit                | fixture audit tested; journeys and forms not separately tested                                   |
| Linux, Windows                 | CI matrix configured, **not yet run**; path handling uses Node APIs but is unverified on Windows |
| Node 20                        | declared minimum, **not tested**                                                                 |

## Accessibility

- Automated checks cover part of WCAG 2.2. Not covered automatically: 1.3.3 sensory characteristics, 2.5.7 dragging
  alternatives, 3.2.6 consistent help, 3.3.7 redundant entry, most of 3.3.8 (only paste blocking is checked), meaning
  of alt text, reading order, screen-reader announcements, captions quality, cognitive load. A run never certifies
  compliance.
- The keyboard walk visits up to 60 stops per page and only on keyboard (non-touch) viewports by default; it does not
  operate menus, dialogs or widgets with arrow keys.
- Focus-visible detection compares styles of the element and its parent; indicators drawn by other elements (e.g. a
  sibling) may be reported as missing.

## Performance

- Lab numbers from one visit; no repeated-run medians yet; local servers make LCP unrealistically fast. `--throttle`
  approximates Lighthouse's mobile profile in Chromium only.
- INP is approximated from scripted journey interactions; it is not field INP.

## Journeys and forms

- Suggested journeys are heuristics from page structure; they need review. No multi-tab, file upload, OAuth popup,
  CAPTCHA or e-mail verification support. Signed-in flows need a test account: run a sign-in journey with
  `--save-auth`, or provide a Playwright storage state.
- The keyboard walk steps past the first trap it finds; a second trap on the same page ends the walk.
- Form validation probing submits empty forms on local hosts by default; servers that accept empty submissions will
  create records in local/test databases.

## Conversion and experiments

- Conversion rules are text/structure heuristics (English-centric keyword lists for trust and pricing signals).
- Experiment statistics: two-proportion z-test with fixed horizon only; no sequential testing, no continuous metrics,
  no CUPED. Jourilo does not connect to analytics or flag providers yet; plans list detected tools only.

## Discovery and root causes

- Repository discovery is lexical (file patterns and regexes), not AST-based. Router configs written dynamically are
  missed. Website discovery crawls up to 30 pages, same origin only, sitemaps on other origins are ignored.
- Source location is lexical and can be wrong; each candidate states its reason and confidence. Five fix types are
  automated; everything else is done by a person or an agent and then verified.

## Reports

- No historical trend view across many runs yet (only pairwise comparison).
- Screenshots are capped at 12 000 px height.

## Other

- No icon/brand identity yet for the plugin listing.
- Not yet published to npm or a public GitHub repository.
