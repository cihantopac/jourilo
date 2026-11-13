# Journeys

A journey is a JSON file in `.jourilo/journeys/` (or anywhere, passed by path) describing what a person tries to do
and how to tell whether they succeeded. Schema: [`schemas/journey.schema.json`](../schemas/journey.schema.json).

```json
{
  "$schema": "https://raw.githubusercontent.com/cihantopac/jourilo/main/schemas/journey.schema.json",
  "version": 1,
  "id": "signup-to-dashboard",
  "name": "Create an account and reach the dashboard",
  "goal": "start using the product",
  "persona": "First-time visitor on a phone",
  "start": "/",
  "viewport": "mobile",
  "steps": [
    { "action": "click", "target": { "role": "link", "name": "Start free trial" } },
    { "action": "fill", "target": { "label": "Work email" }, "value": "{{email}}" },
    { "action": "fill", "target": { "label": "Password" }, "value": "{{password}}" },
    { "action": "click", "target": { "role": "button", "name": "Create account" } },
    { "action": "expect", "visible": { "role": "heading", "name": "Welcome" } }
  ],
  "success": [
    { "description": "Lands on the dashboard", "url": "/dashboard" },
    { "description": "No uncaught exceptions", "noPageErrors": true }
  ],
  "safety": { "submitsForms": true, "destructive": false }
}
```

## Steps

`goto` (url), `click`, `fill` (value), `select` (value), `check`, `press` (key, optional target), `hover`,
`wait` (ms or target), `back`, `expect` (url, visible, hidden, title), `screenshot`, `waitForPopup` (optional
`urlMatch`), `switchTab` (`index` or `urlMatch`), `closeTab`.

Targets, in order of preference: `{ "role", "name" }`, `{ "label" }`, `{ "placeholder" }`, `{ "text" }`,
`{ "testId" }`, `{ "css" }`. Add `"exact": true` for exact name/label/text matching.

URL matching (`url`, `urlNot`, `expect.url`): `"/path"` compares the path exactly (trailing slash and `.html`
ignored), `"re:<regex>"` tests the full URL, anything else is a substring of the full URL.

## Tabs and popups

Steps act on the current tab. A click that opens a popup or a `target="_blank"` tab does not change it:

- `waitForPopup` makes the next popup or new tab the page opened (the first one whose URL matches `urlMatch`, if
  given) the current tab, and waits for it to load.
- `switchTab` makes another open tab current: `index` counts the open tabs in the order they were opened (0 is the
  journey's first tab), `urlMatch` picks the first open tab whose URL matches.
- `closeTab` closes the current tab. It refuses to close the last one.

When the current tab closes (a sign-in popup that closes itself, or `closeTab`), the tab that opened it becomes
current again. Each step's screenshot and URL come from the tab that is current after it.

The safety policy holds in every tab. A popup or tab may only load the journey's own origin or an origin given with
`--allow-origin`; any other navigation is stopped before the request leaves the browser and the step is `blocked`.
This includes a popup the page opens on its own, without a step asking for it. Clicks and key presses in a tab on
another origin are judged by that origin's host: on a non-local identity provider, submitting needs `--allow-submit`,
and payments or deletions never run.

A sign-in through an OAuth popup, against a test identity provider you are authorized to use:

```json
"steps": [
  { "action": "click", "target": { "role": "button", "name": "Sign in with Test IdP" } },
  { "action": "waitForPopup", "urlMatch": "/oauth/idp" },
  { "action": "fill", "target": { "label": "Email" }, "value": "{{email}}" },
  { "action": "click", "target": { "role": "button", "name": "Sign in", "exact": true } },
  { "action": "switchTab", "index": 0 },
  { "action": "expect", "visible": { "text": "Signed in" } }
]
```

Run it with `--allow-origin <the IdP's origin>`. Never point a journey at a real identity provider or a real account.

## Success criteria

Each journey needs at least one: `url`, `urlNot`, `visible` (a target), `noPageErrors`, `noFailedRequests`. Criteria are
evaluated even after a failed step so the report shows which goals were missed.

## Test data

`{{email}}` (unique per run, `@example.test`), `{{password}}`, `{{name}}`, `{{firstName}}`, `{{lastName}}`,
`{{phone}}`, `{{company}}`, `{{search}}`, `{{zip}}`, `{{testCard}}` (Stripe's published test card, only meaningful in a
provider's test mode). Override or add with `--var key=value` or `JOURILO_VAR_KEY`. Password and card values never
appear in step descriptions, logs or reports.

## Safety policy

| Action                                                                   | Local host (localhost, 127.0.0.1, *.localhost, *.test) | Any other host             |
| ------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------- |
| Navigation, typing, non-submitting clicks                                | allowed                                                | allowed                    |
| Submitting a form                                                        | allowed                                                | only with `--allow-submit` |
| Destructive (delete, cancel subscription, close account, unsubscribe…)   | only with `--allow-destructive`                        | never                      |
| Financial (pay, buy, place order, any submit of a form with card fields) | only with `--allow-destructive`                        | never                      |

The decision uses the accessible name and form context of the element actually being activated. A blocked step
stops the journey with status `blocked` and is reported.

## Signed-in journeys

Create a Playwright storage state for a **test account** (for example with `npx playwright codegen --save-storage=auth.json <url>`),
keep it out of git, and pass `--auth auth.json`. Jourilo never logs in with real credentials on its own.
