# Third-party notices

Jourilo is licensed under Apache-2.0. It uses the following third-party software.

## Bundled in `plugin/dist/jourilo.mjs`

| Package                                           | Version | License | Source                                                                      |
| ------------------------------------------------- | ------- | ------- | --------------------------------------------------------------------------- |
| [axe-core](https://github.com/dequelabs/axe-core) | 4.14.0  | MPL-2.0 | <https://github.com/dequelabs/axe-core/tree/v4.14.0>, npm `axe-core@4.14.0` |

axe-core is included unmodified as a whole file (its original copyright header is preserved inside the bundle). Its
license text is shipped at `plugin/dist/licenses/axe-core-LICENSE.txt`, and the notices for software axe-core itself
includes at `plugin/dist/licenses/axe-core-LICENSE-3RD-PARTY.txt`. Under MPL-2.0 the source code of axe-core is
available from the links above.

## Runtime dependency (installed, not bundled)

| Package                                                    | Version | License    | Source                       |
| ---------------------------------------------------------- | ------- | ---------- | ---------------------------- |
| [playwright-core](https://github.com/microsoft/playwright) | 1.64.1  | Apache-2.0 | npm `playwright-core@1.64.1` |

Browsers downloaded by `jourilo setup` (Chromium, Firefox, WebKit builds from the Playwright project) are subject to
their own licenses; see <https://playwright.dev/docs/browsers>.

## Development only (not distributed)

TypeScript, esbuild, Vitest, Biome, tsx and @types/node, each under its own license (Apache-2.0 or MIT).
