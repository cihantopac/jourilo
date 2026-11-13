<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/brand/jourilo-wordmark-reversed.svg">
    <img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/brand/jourilo-wordmark.svg" alt="Jourilo" width="260">
  </picture>
</p>

<h3 align="center">Walk every journey. Find the friction. Prove the fix.</h3>

<p align="center">
  Jourilo uses your product in a real browser, shows where people get stuck with screenshot evidence,<br>
  traces each problem to its root cause and proves every fix with a before/after run.<br>
  A CLI and a Claude Code plugin. Local-first, open source.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/jourilo"><img alt="npm" src="https://img.shields.io/npm/v/jourilo?color=875802&label=npm"></a>
  <a href="https://github.com/cihantopac/jourilo/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/cihantopac/jourilo/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-1c1a17"></a>
  <img alt="Node.js ≥ 20.10" src="https://img.shields.io/badge/node-%E2%89%A5%2020.10-1c1a17">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#in-claude-code">Claude Code</a> ·
  <a href="#audit--understand--fix--verify">How it works</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="docs/WORKFLOW.md">Guide</a> ·
  <a href="docs/">Docs</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-overview-dark.png">
  <img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-overview.png" alt="The Jourilo report: verified defects, root causes, automatic fixes, manual review and conversion hypotheses as separate counts, then the highest-impact root causes with their screenshots">
</picture>

## It walks the journey, step by step

Jourilo signs up, checks out and follows calls to action like a person would, with a real screenshot of every step.
When a journey breaks, you see exactly where.

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-journeys.png" alt="A sign-up journey on mobile: the form is filled in, Submit is clicked, the page resets, and the goal 'leaves the form page' is not met">

## Evidence you can see

Every finding comes with the element outlined on its screenshot, the measured values, the WCAG criterion, reproduction
steps and the likely source line. Findings with one cause are grouped into one fix. Verified defects, items that need a
person and conversion hypotheses are always kept apart, and there is no made-up overall score.

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-finding.png" alt="A finding: the page scrolls sideways at 390 px, with the measured widths, WCAG 1.4.10, the CSS rule that causes it and the element highlighted on the mobile screenshot">

## Audit → Understand → Fix → Verify

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/workflow.png" alt="Four steps: audit in a real browser, understand by root cause, fix with approved patches or a repair prompt, verify with a before/after run">

## Fix it yourself, automatically or with your agent

- **Automatic fixes** for mechanical defects (missing `lang`, viewport, autocomplete, focus styles, paste blocking,
  image sizes, placeholder labels): `jourilo optimize` previews minimal diffs and writes them only with `--apply`, as
  one reversible change.
- **Repair prompts** for everything else: select findings or root causes in the report and copy or download an
  editable Markdown prompt for Claude Code or any coding agent. It carries ids, pages, screenshots, likely source files
  and reproduction steps, and asks the agent to revalidate, change as little as possible, add regression tests and
  verify with Jourilo.
- **Experiment briefs** for conversion hypotheses, never code changes or promised lifts.

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-prompt.png" alt="The repair prompt dialog: an editable Markdown brief with copy and download buttons, generated from three selected findings">

## Prove it

`jourilo verify` repeats the same pages, viewports and journeys and shows what is fixed, new or still present, with the
same region of the page before and after.

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-before-after.png" alt="Before / after: 14 fixed, 0 new, 18 still present, with before and after crops of each fixed problem">

## One file, any screen, two languages

The report is a single offline HTML file. It follows the browser's language and theme, and you can switch between
English and Turkish and between light, dark and system appearance.

<img src="https://raw.githubusercontent.com/cihantopac/jourilo/v1.4.0/docs/assets/report-mobile.png" alt="The report on two phones: English in the light theme and Turkish in the dark theme">

## Install

Requires Node.js ≥ 20.10.

```bash
npm install -g jourilo
```

```bash
jourilo setup
```

```bash
jourilo audit http://localhost:3000 --repo .
```

`setup` downloads Playwright's Chromium once. The report is written to `.jourilo/runs/<run-id>/report.html`.
More commands and the full loop: [docs/WORKFLOW.md](docs/WORKFLOW.md) and the [CLI reference](docs/CLI.md).

## In Claude Code

```text
/plugin marketplace add cihantopac/jourilo
/plugin install jourilo@jourilo
```

Then `/jourilo:jourilo https://your-site.dev` or `/jourilo:jourilo .` for a repository. Claude answers in a few lines
(blocked journeys, three priorities, the fixes available, the report path and one next step) and keeps the evidence in
the report. All commands: [docs/PLUGIN.md](docs/PLUGIN.md).

## Benchmarks

On the 955 [W3C ACT Rules](https://www.w3.org/WAI/standards-guidelines/act/rules/) test cases that map to WCAG criteria,
written by the ACT Rules Community Group and not for Jourilo (measured again on 2026-11-13 for 1.3.0):

|                       | Precision | Recall | False positives |
| --------------------- | --------- | ------ | --------------- |
| Jourilo 1.3.0         | 93.4 %    | 56.1 % | 12              |
| axe-core 4.14.0 alone | 93.6 %    | 53.5 % | 11              |

Jourilo runs axe-core and adds its own keyboard-trap and focus-indicator checks. Many misses are criteria only a person
can judge, which every report lists. No automated run shows WCAG conformance. Method, fixture benchmark and a
comparison with Pa11y and Lighthouse: [docs/EVALUATION.md](docs/EVALUATION.md).

## Safe by default

Audits are read-only, respect robots.txt and run behind a network guard that keeps audited pages away from your
machine and network. Journeys never pay, delete or cancel on non-local hosts. Secrets are masked in screenshots and
redacted from reports. Details: [docs/PRIVACY.md](docs/PRIVACY.md) · [SECURITY.md](SECURITY.md).

## The family

Jourilo works on its own and pairs with its siblings through a small, optional contract
([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)):

- [**Relivaro**](https://github.com/cihantopac/relivaro) — code quality, security and release readiness.
- [**Searvex**](https://github.com/cihantopac/searvex) — SEO and AI-search findings; Jourilo shows them for the same pages.
- [**Markilo**](https://github.com/cihantopac/markilo) — brand identity; Jourilo checks against its tokens and never
  changes a locked brand. Jourilo's own logo was made with Markilo.

## Documentation

[Guide](docs/WORKFLOW.md) · [CLI](docs/CLI.md) · [Plugin](docs/PLUGIN.md) · [Journeys](docs/JOURNEYS.md) · [Run format](docs/RUN-FORMAT.md) ·
[Evaluation](docs/EVALUATION.md) · [Limitations](docs/LIMITATIONS.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Decisions](docs/DECISIONS.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md) · [1.3 release notes](docs/RELEASE-1.3.md) · [1.2 release notes](docs/RELEASE-1.2.md)

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Every rule needs a fixture that proves it fires and a
control that proves it does not.

## License

[Apache-2.0](LICENSE). Bundled third-party code: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
