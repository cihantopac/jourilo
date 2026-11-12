# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-11-13

The rest of the field feedback from the portfolio site and the container adapter (F8, F15, F16, F21, F22, F23, F26,
F29, F31, F35, F36 and F38 in [docs/FIELD-FEEDBACK.md](docs/FIELD-FEEDBACK.md)): contrast over images is decided,
runs work behind corporate proxies and with custom headers, and automation gets budgets, a rule registry, structured
progress and stable evidence. `RUN_SCHEMA_VERSION` stays 1; every new field is optional and old runs still load. No
new runtime dependencies. No run shows WCAG conformance.

### Upgrade notes

- `rules list --json` prints an object, `{ jourilo, axe, rules }`, with the Jourilo and axe-core versions; the rules
  are in `rules`. A rule's `kind` may be `varies`.
- Screenshot file names no longer contain the host or port, so the same page gets the same name on every origin.
  Existing runs keep their files; new runs use the new names once.
- Performance evidence has one item per metric and viewport, with values rounded (milliseconds to the nearest 10,
  CLS to 3 decimals). Snapshot consumers see changed evidence once; fingerprints are unchanged and the raw values
  stay in `run.pages[].metrics`.
- `run.json` `settings.scope.urls` is redacted like other URLs. `verify` refuses (exit 2) a baseline whose scope has
  redacted query values, and names the pages: audit them again and verify against the new run.
- Jourilo now reads `HTTPS_PROXY` / `HTTP_PROXY` (either case) and `NO_PROXY`. A variable that is not a usable
  `http://` proxy (for example `socks5://…`) fails every browsing command with exit 2, unless `NO_PROXY=*` is set or
  the variable is unset.
- Plain `http://` pages through an upstream proxy are tunnelled to port 80 (`CONNECT <ip>:80`); the proxy must allow
  that. A proxy that refuses it fails those requests with a message that asks for the target's `https://` URL.
- Contrast over an image, gradient or overlapping element that was a "needs review" item may now be a decided
  defect (`jourilo/contrast-over-image`, serious), so it can fail `--fail-on serious`.

### Added

- **Contrast over images (F8).** axe-core's undecided contrast nodes over an image, gradient or overlap are decided
  from the rendered pixels inside the text's line boxes (at most 30 per capture). The worst tile decides: a fail is
  `jourilo/contrast-over-image` (WCAG 1.4.3), a clear pass removes the review item, the rest stay for review.
- **Upstream proxy and host lists (F15).** `--proxy` (or `HTTPS_PROXY` / `HTTP_PROXY`) chains to an `http://` proxy
  behind the network guard, which still resolves and checks every destination and tunnels only to the checked
  address. `NO_PROXY` is decided per destination host. `--allow-hosts` and `--block-hosts` limit the hosts a run may
  reach; refused requests are listed in the limitations.
- **Request options (F16).** `--user-agent`, `--extra-header "Name: value"` (repeatable, sent only to the target's
  origin) and `--ignore-https-errors` (browser only; the guard still checks every destination).
- **Chromium sandbox (F21).** `--chromium-sandbox` / `JOURILO_CHROMIUM_SANDBOX=1` keeps Chromium's process sandbox
  (opt-in). A Chromium run writes `browser.pids` in its directory so an integrator can clean up after a `SIGKILL`.
- **Pages and captures (F22).** `summary.urls` and `summary.captures` next to `summary.pages` (which still counts
  captures); `sample` records how many discovered pages a run left out, and the report header shows pages and
  captures.
- **Redirect chains and keyboard traps (F23).** `jourilo/redirect-chain` (minor) for a page reached through 3 or more
  redirects. A keyboard trap is found wherever focus starts, also on a page where nothing else is focusable.
- **Rule registry (F26).** `jourilo rules list [--json]` lists every native, performance, axe and axe-review rule with
  its category, severity and kind.
- **Budgets (F29).** `--budget LCP=2000,CLS=0.05,TBT=300` exits 1 when the worst capture's value exceeds a limit; a
  metric no capture measured is "not measured", not a pass. Recorded as `budgets` in `run.json` and in `--json`.
- **Wait for an element (F31).** `--wait-for <selector>` captures each page once the element is visible; if it never
  appears, the page is still audited, with a limitation. Each capture records how it loaded (`pages[].load`).
- **Structured progress (F35).** With `--json`, audit progress lines carry `phase`, `done`, `total`, `url` and
  `viewport`. `manifest.json` names the Jourilo, browser and axe-core versions and the scope.

### Changed

- **Stable evidence (F36).** Performance evidence is keyed by metric and viewport with rounded values (see the
  upgrade notes). CLS includes font-swap shifts, which are real layout shift; the variance is documented.
- **Screenshot names (F38)** use the page's path and query, not its origin. A page on another origin than the run's
  first page adds an origin tag.

### Fixed

- Failed-navigation URLs are redacted with the URL redactor, so a token in a failing target URL no longer appears in
  `page-unreachable` text.
- Turkish capitals match in the in-page probe lexicon (form purpose, trust and pricing signals).
- The dialog focus-guard wait has a timer fallback, so its 250 ms cap holds when animation frames stall.
- The HTML report falls back to `foldScreenshot`, so a page under `--evidence minimal` does not show "no screenshot".
- Focus held by a `role="dialog"` or `role="alertdialog"` element is not reported as a keyboard trap (cookie walls).
- Network evidence is not repeated when desktop and mobile findings merge, and evidence that names its viewport is
  never dropped by the merge cap.
- The fixture server accepts only same-origin redirect paths without control characters.

### Security

- Proxy credentials stay in the guard: the run records the proxy as `http://host:port`, and only checked addresses
  reach the proxy (`CONNECT <ip>:<port>`, never a host name). A proxy's refusal, `407` or failure is the guard's own
  error, never shown as the page.
- `--extra-header` values go only to the target's origin and are never written to `run.json`, reports, progress
  lines or the manifest; `journeys run --trace` is refused with `--extra-header`.
- `settings.scope.urls` and failed-navigation URLs are redacted.
- The guard destroys tunnels that open after it closes, verifies an IP-literal HTTPS target against its own address
  inside a proxy tunnel, and keeps the framing of chunked request bodies.

### Docs

- `docs/RELEASE-1.3.md`, decisions D19 and D20, the new flags in `docs/WORKFLOW.md`, new limitations, the proxy,
  header and redaction changes in `docs/SECURITY-REVIEW.md` and `docs/PRIVACY.md`, and F44 in
  `docs/FIELD-FEEDBACK.md`.

## [1.2.1] - 2026-11-12

Field feedback from a second run of the container adapter (F19-F40 in
[docs/FIELD-FEEDBACK.md](docs/FIELD-FEEDBACK.md)) drove this release: fewer false positives on modern front ends,
safer behaviour when Jourilo audits on behalf of others, and sturdier automation edges. `RUN_SCHEMA_VERSION` stays 1;
the one new run field is optional and old runs still load. No run shows WCAG conformance.

### Upgrade note

- Fingerprints now use a slash-insensitive page path. Crawled links that end in a slash keep their 1.2.0
  fingerprints. Findings on explicitly requested slash URLs (`--url /x/`, single-page runs whose target path ends in
  `/`, journey step URLs ending in `/`) get new fingerprints once: dismissals and baselines for those need to be
  recorded again.
- `--pages 0`, an invalid `--max-duration`, a `--run-id` directory that already exists and a `verify --target` that
  is not a URL are now usage or input errors (exit 2) instead of being accepted or ending in an internal error.

### Added

- **`--deny-local` and `JOURILO_DENY_LOCAL`** (F19, opt-in) for integrations that audit on behalf of others: refuse
  targets, redirects and subresources that point at loopback, `*.localhost` and `*.test`. A directory target is
  served on 127.0.0.1 and may reach only its own port. Available on `audit`, `discover`, `journeys` and `verify`.
  The variable fails closed: `1`, `true`, `yes` and `on` enable it, `0`, `false`, `no`, `off` and empty disable it, and
  any other value enables it and prints a warning. It is refused together with `--browser webkit` (exit 3), because
  WebKit's HTTPS redirects bypass the proxy.
- `foldScreenshot` in `run.json` (optional): the file that is a page's first screen, so a consumer of
  `--evidence minimal` runs can tell it from the full-page file (F39).

### Fixed

- **Keyboard (F24).** Focus stops without a box and dev-server overlays such as `nextjs-portal` are no longer
  reported by `jourilo/focus-visible`; a hidden-while-focused control that has text or an accessible name is still
  reported. `aria-labelledby` ids are split on whitespace.
- **Contrast (F25).** `aria-hidden` content is left out of the manual contrast review.
- **Structure (F27).** A fieldset named by `aria-label` or `aria-labelledby` is not reported as lacking a legend.
- **Widgets (F30).** `dialog-focus-containment` waits for a dialog library's focus guard to wrap (about 4 frames, at
  most 250 ms) before judging containment; a guard that wraps later is treated as a sentinel.
- **Run outcome (F28, F23 part).** A redirect loop is explained with its status chain; hop URLs are redacted.
- **Layout (F37).** Sideways scrolling without a located element is reported as a low-confidence needs-review item,
  not a defect.
- **Merging.** When two sightings of one finding differ, the stronger one decides kind, confidence and text, so a
  located serious overflow cannot merge into a needs-review item and escape `--fail-on`.
- **Crawl (F20).** A trailing slash on the start URL is kept (`/staff/` is no longer audited as `/staff`), and an
  explicitly requested URL that robots.txt disallows is audited and the run says so.
- **Network (F34).** An unresolvable `*.test` name fails in seconds, not after the 30 s navigation timeout. The host
  reaches the resolver as data, not as an option.
- **Automation (F32, F33, F40, F22 part).** `--max-duration` is bounded and keeps the limit within a few seconds of
  the current page; a used `--run-id` directory is refused; a second stop signal prints a line (JSON with `--json`)
  before exiting 130; `--pages 0` is a usage error; duplicate `--url` values are audited once.
- **Evidence (F39).** `--evidence minimal` records the first-screen file; journeys keep per-attempt screenshots;
  setup-state removal no longer depends on the guard closing cleanly.
- **Turkish lexicon.** Capitals (`KARANLIK`, `DİL`, `SİL`) match the toggle, action and journey vocabularies.

### Docs

- `docs/RELEASE-1.2.md` (1.2.1 evidence), `docs/FIELD-FEEDBACK.md` (status after 1.2.1), new limitations and the
  roadmap with the 1.3.0 items.

## [1.2.0] - 2026-11-03

Field feedback from two real projects (a portfolio site and a container adapter, F1-F23 in
[docs/FIELD-FEEDBACK.md](docs/FIELD-FEEDBACK.md)) drove this release: fewer false positives, one missed defect found,
state you can set before an audit, and runs that automation can trust. `RUN_SCHEMA_VERSION` stays 1; every new field is
optional and old runs still load. No run shows WCAG conformance.

### Fixed

- **Focus hidden behind any opaque content** (WCAG 2.4.11) is reported, not only behind `fixed` or `sticky` elements,
  and focus stops hidden by an ancestor are skipped. A pointer-events overlay can still hide focus unreported (see
  limitations).
- **A disclosure is not a dialog.** A trigger with `aria-expanded` and `aria-controls` whose target toggles is no
  longer reported as a dialog without a name or focus trap, unless the opened element is a dialog.
- **State CSS rules are the source.** Findings about `:hover`, `:focus` and attribute states (`[aria-pressed]`,
  `[aria-expanded]`, `[data-state]`) point at the CSS rule, not the component that renders the element.
  Keyboard-walk findings now record the element's opening tag (class, id, role, state attributes) before its
  name, so a rule like `.tool[aria-pressed="true"] { outline: … }` is found even when the focus selector has no
  class.
- **Covered click targets in journeys** are explained (which element is on top) and worked around by clicking the
  visible part, instead of a bare timeout. Targets inside shadow roots are hit-tested correctly.
- **No page loaded is no longer a quiet success.** An unresolvable host or a refused connection ends the run with
  outcome `no-page-loaded` and exit 5; the reason is redacted and never contains an address.
- **`verify` against a page that did not load never reports "fixed"**, and `verify --target` is honored for static
  baselines.
- `journeys suggest` keeps real calls to action that mention a theme and lists only toggles that can make a journey.
- The setup journey's session state is removed after the audit, so saved cookies do not stay in the run directory.
- Dismissals are loaded before the browser starts, so a corrupt file fails fast.
- Journeys with `--evidence minimal` prune against the representative attempt.

### Added (options)

- `--timezone ZONE` and `--clock ISO` for `audit`, `journeys run` and `verify`: set the page's time zone and freeze
  `Date`, for example to audit night mode. Timers keep running.
- `--setup-journey REF` on `audit` and `verify`: run a journey first (a theme, a dismissed banner, a signed-in state)
  and audit the cookies and `localStorage` it leaves. It follows the journeys safety policy.
- `--evidence minimal`: first screens plus the screenshots findings and failed steps need, JPEG quality 55. On the
  fixture site this keeps 46 % of the full evidence size.
- `finding dismiss <id> --reason "<text>" [--by user|agent]` and `finding undismiss <id>`: mark a false positive once;
  later runs list it as dismissed and keep it out of the counts (DECISIONS D18).
- `journeys suggest` also suggests interaction journeys for disclosures (`aria-expanded`) and toggles
  (`aria-pressed`).

### Automation

- **Exit codes 5 and 6.** 5: no page could be loaded. 6: stopped early (SIGINT, SIGTERM or `--max-duration`); a
  second signal exits 130.
- **Partial runs.** A stop writes `run.json` with outcome `partial` and the pages finished so far, then exits 6.
- `--max-duration SECS` stops an audit after a time budget.
- **JSON progress.** With `--json`, progress lines on stderr are JSON: `{"type":"progress","message":"...","at":"..."}`.
- **`manifest.json`** with the size and sha256 of every artifact in the run directory.
- **`--run-id ID`** names the run (1-64 of `A-Z a-z 0-9 _ -`) so a job can be retried idempotently; an existing id is
  refused.
- **Run schema.** `schemas/run.schema.json` (JSON Schema draft 2020-12, shipped in the npm package) and the
  compatibility policy in [docs/RUN-FORMAT.md](docs/RUN-FORMAT.md): fields are only added, and optional.

### Docs

- `docs/CLI.md` documents every implemented flag (`--timeout`, `--locale`, `--headed`, `report --stdout`, the journeys
  flags) and both new exit codes; a test keeps the reference and the options in step.
- `docs/RELEASE-1.2.md` (evidence), `docs/FIELD-FEEDBACK.md` (status of F1-F23), new limitations, the roadmap with
  the deferred items, D18, and the new flags in `docs/WORKFLOW.md`.

## [1.1.0] - 2026-11-01

The detection engine is unchanged from 1.0.0 (fixture benchmark 45/45, 0 false positives); this release is about
seeing, understanding and acting on the results.

### Added

- **Repair prompts.** Select findings or whole root-cause groups in the HTML report and turn them into an editable
  Markdown prompt for Claude Code or any coding agent (copy, or download as `jourilo-repair-<run>.md`). It carries
  finding ids, pages, run-relative screenshot and evidence paths, likely source files and reproduction steps, and
  asks the agent to revalidate, make the smallest change, add regression tests and verify with `jourilo verify`.
  Page-derived text is flattened and fenced between nonce markers it cannot forge. The report never runs anything.
- **Fix paths.** Every finding is labelled automatic fix (a Jourilo fixer exists), agent-assisted, manual review or
  experiment brief; conversion hypotheses produce experiment or investigation briefs, never code changes.
- **English and Turkish report interface** and a **Light / Dark / System** theme selector. The browser's language and
  color scheme are used first; choices are remembered. Finding texts, code and screenshots stay in their original
  language.
- `docs/WORKFLOW.md`: the improvement loop, the report, repair prompts and the agent answer format.

### Changed

- **The report is redesigned** in the Daybook identity (paper, ink and brass, a book serif for headings, the
  wordmark's diamond as the recurring mark): compact counts, blocked journeys first with the step where they stopped,
  "Fix first" cards with the outlined element, three separate lanes for verified defects, manual review and
  conversion hypotheses, and short limitations with the rest folded away. Still no overall UX score.
- **Root-cause grouping** everywhere: the same rule on the same source line, or on the same element across pages, is
  one card listing every page and finding id. Filters for result type, severity, category, fix path and page.
- **Journey timelines** with the real screenshot of every step, the step that failed and the goal with its criteria;
  one blocked-journey card per journey across viewports.
- **Before / after**: the same region of the page from the baseline and the new run side by side for each fixed root
  cause, page screenshots in pairs, and metric verdicts.
- Accessibility of the report itself: a page heading, landmarks, a skip link, arrow-key tabs, keyboard-scrollable
  regions, named screenshot links, 24 px targets; axe-core finds no WCAG 2.2 A/AA violations in either theme.
- Claude Code skills and the other-agent instructions answer in 80–150 words: target, blocked journeys and key
  defects, three priorities, available fixes, the real report path and how to open it, one next step.
- The README is a visual product page; CLI examples, evaluation details and safety specifics moved to the docs.
  README images use absolute URLs so they also render on npm.

## [1.0.1] - 2026-11-01

### Added

- Brand identity "Daybook", made with Markilo: the Jourilo wordmark in the README and the report header, the J
  symbol as the report favicon, and a plugin icon (`plugin/.claude-plugin/icon.png`) for the Claude Code plugin
  directory. Masters are in `docs/assets/brand/`; the README credits Markilo.

### Changed

- The HTML report uses the brand palette (paper, ink and brass, with a matching dark theme); every text color keeps
  at least 4.5:1 contrast on its background.

## [1.0.0] - 2026-11-01

### Security

- Network guard: every browser request (subresources, redirects, iframes, WebSockets) goes through a local proxy
  that resolves names itself and connects only to allowed addresses, so an audited page can no longer reach
  loopback, LAN or cloud-metadata services, including through DNS rebinding. WebRTC and QUIC are disabled.
- Targets whose DNS answer mixes public and private addresses are refused; address classification covers IPv4/IPv6
  special-purpose ranges, embedded IPv4 and metadata endpoints. robots.txt and sitemap fetches check every redirect.
- Journey safety: key presses (with or without a target) are judged like clicks; icon-only buttons, link targets,
  `formaction` and form actions count; every request a journey triggers is checked (DELETE, destructive or payment
  endpoints, form posts on non-local hosts, navigation to other origins — `--allow-origin` for authorized ones).
- Audits never write data: the form probe simulates the empty submission by default (real only with
  `--allow-submit`), and keyboard/widget checks run read-only.
- The static server no longer serves hidden files (`.env`, `.git/`) and survives malformed URLs.
- A warning when `--save-auth` writes a session file that git would commit.

### Added

- Keyboard reachability of composite widgets: tab lists, radio groups, list boxes, menu bars and trees whose arrow
  keys do not reach the other items are reported (WCAG 2.1.1).
- `journeys run --repeat N`: flaky journeys (mixed outcomes) are reported for review.
- Lab metrics keep their range with `--runs`; `compare`/`verify` give every metric change a verdict (improved,
  regressed, within noise, unconfirmed), and `verify` repeats the baseline's number of visits.
- Reports: network guard refusals and security events, journey attempts and stopped requests, and the WCAG 2.2
  questions that still need a person.
- Laravel discovery follows included route files, groups and prefixes, Livewire/Inertia/Volt pages, Filament panels
  (nested resources, `$slug`) and guards.
- Independent benchmark on the W3C ACT Rules test cases (`benchmarks/act`); clean-install smoke test of the packed
  tarball on Linux, macOS and Windows (`scripts/smoke-pack.mjs`).

### Fixed (found on real applications)

- In-page anchors (skip links with non-English targets, section navigation) were operated as lightbox triggers and
  reported as broken dialogs.
- A layer that a dialog leaves on the page after closing made the dialog look "still open" after Escape.
- A local build with a production sitemap was crawled to 2 pages; a build without a page at `/` was reported as
  broken.
- A sign-up journey was suggested when only a dashboard route existed.

### Changed

- `optimize --apply` writes fixes as one transaction (backups and hashes first, atomic writes, automatic restore
  after a failure, recovery of interrupted applies) and no longer needs git. **`rollback` never overwrites edits made
  after a change**: such files are reported as conflicts (`--force` restores them after saving the current version).
  Checkpoint rollbacks keep the overwritten versions and can be undone. `rollback latest` skips rollbacks.
- `--allow-submit` in audits now means "really send the empty submission", on local hosts too.
- Writes cannot escape the repository through symlinked directories; files that are not UTF-8 are never rewritten.

## [0.1.0] - 2026-10-31

First working version.

### Added

- `audit` / `accessibility` / `conversion`: real-browser audits (Playwright; Chromium, Firefox, WebKit) of URLs and
  static builds with same-origin discovery (robots.txt, sitemap), desktop/mobile/reflow viewports, axe-core 4.14
  (WCAG 2.0–2.2 A/AA, `target-size` enabled), keyboard walk (focus visible, focus obscured, traps), target size,
  horizontal overflow, pointer-only controls, input purpose, placeholder-only labels, paste blocking, form validation
  feedback, lab Web Vitals, JavaScript errors and failed requests, conversion hypotheses, brand consistency.
- `journeys`: JSON scenarios with explicit success criteria; suggestion from evidence; runner with step screenshots,
  traces, generated test data and an element-level safety policy.
- `discover`: repository profiles (Next.js, Nuxt, SvelteKit, Astro, Remix, React/Vue Router, Laravel, Flutter web,
  static HTML, monorepos) and website profiles.
- `optimize`, `verify`, `checkpoint`, `rollback`: root-cause location, seven idempotent deterministic fixers with diff
  previews (html lang, viewport meta, autocomplete, focus ring, paste blocking, image dimensions, visible labels),
  byte-exact git checkpoints, before/after verification.
- `experiment`: sample size, plans from hypotheses, analysis with confidence intervals and SRM check.
- Reports: self-contained HTML Experience Observatory (root-cause-grouped "fix first", improvement roadmap lanes,
  run history for the target, journeys storyboard, before/after), Markdown, SARIF 2.1.0; `compare`.
- `jourilo.context/v1` integration contract with Markilo and Searvex adapters.
- Claude Code plugin (10 skills, `ux-reviewer` agent) and adapters for a bare `/jourilo` skill, `AGENTS.md` and Cursor.
- `bench` with fixture sites and recorded history.
- Keyboard-operated widget checks, including ARIA-less lightboxes (dialog focus, containment, Escape, focus return,
  dialog role; `aria-expanded` state); structure checks (fieldset legends, radio groups, header-less tables, empty
  alt with title); `--runs N` for median lab metrics with ranges. Metrics a browser cannot measure (CLS and TBT
  outside Chromium) are reported as not measured instead of 0.
- `benchmarks/compare`: reproducible comparison with Pa11y and Lighthouse on the GOV.UK accessibility tool audit.
- Multilingual lexicon (en, tr, de, es, fr) shared by the safety policy, conversion rules, form classification,
  error detection and field purposes. **Safety fix:** non-English payment and delete buttons ("Satın al",
  "Jetzt kaufen", "Supprimer le compte"…) were not blocked by name before.
- Cross-browser parity: identical journey, session, signed-in audit and form results in Chromium, Firefox, WebKit.
  WebKit on Windows cannot move keyboard focus to links; the report says so instead of skipping those checks silently.
- Signed-in testing: `journeys run --save-auth` stores a test-account session (mode 0600) for `--auth`; static builds
  are served with SPA fallback on a stable port per directory.
