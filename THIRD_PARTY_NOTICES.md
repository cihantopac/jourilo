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

## Bundled in `plugin/dist/ts-parser.mjs`

| Package                                               | Version | License    | Source                                                                        |
| ----------------------------------------------------- | ------- | ---------- | ----------------------------------------------------------------------------- |
| [TypeScript](https://github.com/microsoft/TypeScript) | 6.0.3   | Apache-2.0 | <https://github.com/microsoft/TypeScript/tree/v6.0.3>, npm `typescript@6.0.3` |

The TypeScript compiler (installed as the npm alias `typescript-js`) is bundled, minified, into this separate chunk,
which `jourilo discover` loads only when a repository has routes declared in code. Its copyright notice is preserved
at the end of the chunk. Its license text is shipped at `plugin/dist/licenses/typescript-LICENSE.txt`, and the
notices for software TypeScript itself includes at `plugin/dist/licenses/typescript-ThirdPartyNoticeText.txt`.

## Runtime dependency (installed, not bundled)

| Package                                                    | Version | License    | Source                       |
| ---------------------------------------------------------- | ------- | ---------- | ---------------------------- |
| [playwright-core](https://github.com/microsoft/playwright) | 1.64.1  | Apache-2.0 | npm `playwright-core@1.64.1` |

Browsers downloaded by `jourilo setup` (Chromium, Firefox, WebKit builds from the Playwright project) are subject to
their own licenses; see <https://playwright.dev/docs/browsers>.

## Development only (not distributed)

TypeScript 7 (type checking), esbuild, Vitest, Biome, tsx and @types/node, each under its own license (Apache-2.0 or MIT).
