# Jourilo — Standards Reference

Accessed: 2026-10-30

A source-backed quick reference for the standards Jourilo audits against. Every factual line links to its source. **unverified** marks claims we could not confirm from a primary source. Columns labelled "Jourilo assessment" are our own engineering judgement, not normative text.

---

## 1. WCAG 2.2 (Level A + AA)

- WCAG 2.2 is a W3C Recommendation, current version dated **12 December 2024** ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).
- WCAG 2.2 **removed 4.1.1 Parsing** ("obsolete and removed") ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).
- Nine SC are new in 2.2. Six of them are at A/AA: 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8. The other three are AAA: 2.4.12, 2.4.13, 3.3.9 ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)).
- An AA target means satisfying all **31 Level A + 24 Level AA** SC listed below. Counts are derived from the SC list in [WCAG 2.2](https://www.w3.org/TR/WCAG22/), excluding 4.1.1.

### 1.1 New in WCAG 2.2 at A/AA

| SC     | Name                                | Level | Requirement (paraphrased)                                                                                                                                                                     | Source                                    |
| ------ | ----------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 2.4.11 | Focus Not Obscured (Minimum)        | AA    | A focused component is not entirely hidden by author-created content                                                                                                                          | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| 2.5.7  | Dragging Movements                  | AA    | Anything done by dragging can also be done with a single pointer without dragging, unless dragging is essential or user-agent controlled                                                      | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| 2.5.8  | Target Size (Minimum)               | AA    | Pointer targets are **at least 24 × 24 CSS px**. Exceptions: Spacing, Equivalent, Inline, User Agent Control, Essential                                                                       | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| 3.2.6  | Consistent Help                     | A     | Help mechanisms repeated across pages appear in the same relative order                                                                                                                       | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| 3.3.7  | Redundant Entry                     | A     | Information already entered in a process is auto-populated or selectable when asked again, unless re-entry is essential, needed for security, or no longer valid                              | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |
| 3.3.8  | Accessible Authentication (Minimum) | AA    | No cognitive function test (e.g., remembering a password, solving a puzzle) unless an alternative, an assisting mechanism, object recognition, or personal-content identification is provided | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) |

**2.5.8 spacing test.** For an undersized target, center a 24 CSS px diameter circle on its bounding box. It passes the spacing exception if that circle does not intersect another target or another undersized target's circle ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). 2.5.5 Target Size (Enhanced) is AAA and requires 44 × 44 CSS px ([Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)).

### 1.2 Contrast thresholds

| SC                            | Level | Threshold                                                                                                                       | Source                                                                                   |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1.4.3 Contrast (Minimum)      | AA    | **4.5:1** for text and images of text. **3:1** for large-scale text                                                             | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                |
| Large-scale text (definition) | —     | At least **18 point**, or **14 point bold**, or the equivalent for CJK fonts                                                    | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                |
| 1.4.11 Non-text Contrast      | AA    | **3:1** against adjacent colors for visual information needed to identify UI components and states, and for meaningful graphics | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                |
| 1.4.6 Contrast (Enhanced)     | AAA   | Out of AA scope. axe's `color-contrast-enhanced` is disabled by default                                                         | [axe rules](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md) |

Implementation note (Jourilo assessment): 18pt ≈ 24 CSS px and 14pt ≈ 18.67 CSS px at the CSS 1pt = 1.333px ratio. Verify the conversion against the "large scale" note in Understanding 1.4.3 before hard-coding it (**unverified** here).

### 1.3 All Level A and AA success criteria

Legend for "Check type" (Jourilo assessment): **Auto** = largely machine-checkable; **Auto+Review** = machine can flag, human must confirm; **Journey** = needs scripted interaction such as keyboard, zoom, forms or auth; **Manual** = needs human judgement. The axe rule column lists only mappings confirmed in axe's [rule-descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md). Blank does not mean "no rule exists".

| SC     | Name                                                 | Lvl | 2.2 new | Check type                    | axe rule(s) (verified tag)                                                                                                                                 |
| ------ | ---------------------------------------------------- | --- | ------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1.1  | Non-text Content                                     | A   |         | Auto+Review                   | `image-alt`                                                                                                                                                |
| 1.2.1  | Audio-only and Video-only (Prerecorded)              | A   |         | Manual                        |                                                                                                                                                            |
| 1.2.2  | Captions (Prerecorded)                               | A   |         | Auto+Review                   | `video-caption`                                                                                                                                            |
| 1.2.3  | Audio Description or Media Alternative (Prerecorded) | A   |         | Manual                        |                                                                                                                                                            |
| 1.2.4  | Captions (Live)                                      | AA  |         | Manual                        |                                                                                                                                                            |
| 1.2.5  | Audio Description (Prerecorded)                      | AA  |         | Manual                        |                                                                                                                                                            |
| 1.3.1  | Info and Relationships                               | A   |         | Auto+Review                   | `list`                                                                                                                                                     |
| 1.3.2  | Meaningful Sequence                                  | A   |         | Manual                        |                                                                                                                                                            |
| 1.3.3  | Sensory Characteristics                              | A   |         | Manual                        |                                                                                                                                                            |
| 1.3.4  | Orientation                                          | AA  |         | Journey                       | `css-orientation-lock` (experimental, off by default)                                                                                                      |
| 1.3.5  | Identify Input Purpose                               | AA  |         | Auto+Review                   | `autocomplete-valid`                                                                                                                                       |
| 1.4.1  | Use of Color                                         | A   |         | Auto+Review                   | `link-in-text-block`                                                                                                                                       |
| 1.4.2  | Audio Control                                        | A   |         | Auto+Review                   | `no-autoplay-audio`                                                                                                                                        |
| 1.4.3  | Contrast (Minimum)                                   | AA  |         | Auto+Review                   | `color-contrast`                                                                                                                                           |
| 1.4.4  | Resize Text                                          | AA  |         | Journey                       | `meta-viewport`                                                                                                                                            |
| 1.4.5  | Images of Text                                       | AA  |         | Manual                        |                                                                                                                                                            |
| 1.4.10 | Reflow                                               | AA  |         | Journey (320 CSS px viewport) |                                                                                                                                                            |
| 1.4.11 | Non-text Contrast                                    | AA  |         | Auto+Review                   |                                                                                                                                                            |
| 1.4.12 | Text Spacing                                         | AA  |         | Journey                       | `avoid-inline-spacing`                                                                                                                                     |
| 1.4.13 | Content on Hover or Focus                            | AA  |         | Journey                       |                                                                                                                                                            |
| 2.1.1  | Keyboard                                             | A   |         | Journey                       | `scrollable-region-focusable`, `server-side-image-map`                                                                                                     |
| 2.1.2  | No Keyboard Trap                                     | A   |         | Journey                       |                                                                                                                                                            |
| 2.1.4  | Character Key Shortcuts                              | A   |         | Manual                        |                                                                                                                                                            |
| 2.2.1  | Timing Adjustable                                    | A   |         | Auto+Review                   | `meta-refresh`                                                                                                                                             |
| 2.2.2  | Pause, Stop, Hide                                    | A   |         | Auto+Review                   | `blink`, `marquee`                                                                                                                                         |
| 2.3.1  | Three Flashes or Below Threshold                     | A   |         | Manual                        |                                                                                                                                                            |
| 2.4.1  | Bypass Blocks                                        | A   |         | Auto+Review                   | `bypass`                                                                                                                                                   |
| 2.4.2  | Page Titled                                          | A   |         | Auto+Review                   | `document-title`                                                                                                                                           |
| 2.4.3  | Focus Order                                          | A   |         | Journey                       |                                                                                                                                                            |
| 2.4.4  | Link Purpose (In Context)                            | A   |         | Auto+Review                   | `link-name`                                                                                                                                                |
| 2.4.5  | Multiple Ways                                        | AA  |         | Manual                        |                                                                                                                                                            |
| 2.4.6  | Headings and Labels                                  | AA  |         | Manual                        |                                                                                                                                                            |
| 2.4.7  | Focus Visible                                        | AA  |         | Journey                       |                                                                                                                                                            |
| 2.4.11 | Focus Not Obscured (Minimum)                         | AA  | ✔       | Journey                       |                                                                                                                                                            |
| 2.5.1  | Pointer Gestures                                     | A   |         | Manual                        |                                                                                                                                                            |
| 2.5.2  | Pointer Cancellation                                 | A   |         | Journey                       |                                                                                                                                                            |
| 2.5.3  | Label in Name                                        | A   |         | Auto+Review                   | `label-content-name-mismatch` (on by default since 4.14.0)                                                                                                 |
| 2.5.4  | Motion Actuation                                     | A   |         | Manual                        |                                                                                                                                                            |
| 2.5.7  | Dragging Movements                                   | AA  | ✔       | Manual                        |                                                                                                                                                            |
| 2.5.8  | Target Size (Minimum)                                | AA  | ✔       | Auto+Review                   | `target-size` (**disabled by default**)                                                                                                                    |
| 3.1.1  | Language of Page                                     | A   |         | Auto                          | `html-has-lang`                                                                                                                                            |
| 3.1.2  | Language of Parts                                    | AA  |         | Auto+Review                   | `valid-lang`                                                                                                                                               |
| 3.2.1  | On Focus                                             | A   |         | Journey                       |                                                                                                                                                            |
| 3.2.2  | On Input                                             | A   |         | Journey                       |                                                                                                                                                            |
| 3.2.3  | Consistent Navigation                                | AA  |         | Journey (multi-page)          |                                                                                                                                                            |
| 3.2.4  | Consistent Identification                            | AA  |         | Manual                        |                                                                                                                                                            |
| 3.2.6  | Consistent Help                                      | A   | ✔       | Journey (multi-page)          |                                                                                                                                                            |
| 3.3.1  | Error Identification                                 | A   |         | Journey (submit invalid form) |                                                                                                                                                            |
| 3.3.2  | Labels or Instructions                               | A   |         | Auto+Review                   | (axe `label` is tagged 4.1.2, not 3.3.2)                                                                                                                   |
| 3.3.3  | Error Suggestion                                     | AA  |         | Journey + Manual              |                                                                                                                                                            |
| 3.3.4  | Error Prevention (Legal, Financial, Data)            | AA  |         | Manual                        |                                                                                                                                                            |
| 3.3.7  | Redundant Entry                                      | A   | ✔       | Journey (multi-step form)     |                                                                                                                                                            |
| 3.3.8  | Accessible Authentication (Minimum)                  | AA  | ✔       | Journey + Manual              |                                                                                                                                                            |
| 4.1.2  | Name, Role, Value                                    | A   |         | Auto+Review                   | `button-name`, `link-name`, `label`, `select-name`, `input-button-name`, `frame-title`, `nested-interactive`, `aria-hidden-focus`, `aria-valid-attr-value` |
| 4.1.3  | Status Messages                                      | AA  |         | Journey + Manual              |                                                                                                                                                            |

SC names and levels: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). axe rule ↔ SC tags: [rule-descriptions](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md). The 4.14.0 default for `label-content-name-mismatch` comes from the [axe-core releases](https://github.com/dequelabs/axe-core/releases).

### 1.4 Limits of automation

- axe-core: "on average 57% of WCAG issues" found automatically ([axe-core README](https://github.com/dequelabs/axe-core)). Deque's dataset gives 57.38% **by issue volume**. Deque attributes the commonly quoted 20–30% to counting **by success criterion** ([Deque study](https://www.deque.com/automated-accessibility-testing-coverage/)).
- `incomplete` results are "review items" that need manual testing ([axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)).
- Playwright's docs say automated testing "cannot detect all types of WCAG violations" and recommend adding manual assessment and inclusive user testing ([Playwright a11y](https://playwright.dev/docs/accessibility-testing)).
- Lighthouse's a11y score excludes its manual audits (focus traps, tab order, landmarks) ([Lighthouse scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring)).

---

## 2. Core Web Vitals

### 2.1 Current metrics and thresholds

| Metric                            | Measures                   | Good     | Needs improvement | Poor     | CWV?                                  | Source                                                                                                                |
| --------------------------------- | -------------------------- | -------- | ----------------- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **LCP** Largest Contentful Paint  | Loading                    | ≤ 2.5 s  | 2.5–4.0 s         | > 4.0 s  | Yes                                   | [vitals](https://web.dev/articles/vitals), [thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) |
| **INP** Interaction to Next Paint | Responsiveness             | ≤ 200 ms | 200–500 ms        | > 500 ms | Yes                                   | [inp](https://web.dev/articles/inp)                                                                                   |
| **CLS** Cumulative Layout Shift   | Visual stability           | ≤ 0.1    | 0.1–0.25          | > 0.25   | Yes                                   | [thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)                                            |
| FCP First Contentful Paint        | Perceived load             | ≤ 1.8 s  | 1.8–3.0 s         | > 3.0 s  | No (supporting)                       | [fcp](https://web.dev/articles/fcp)                                                                                   |
| TTFB Time to First Byte           | Server / connection        | ≤ 0.8 s  | 0.8–1.8 s         | > 1.8 s  | No ("isn't a Core Web Vitals metric") | [ttfb](https://web.dev/articles/ttfb)                                                                                 |
| TBT Total Blocking Time           | Main-thread blocking (lab) | —        | —                 | —        | No; lab proxy for INP                 | [vitals](https://web.dev/articles/vitals)                                                                             |

- **Assessment rule:** use the **75th percentile** of page loads, segmented by mobile and desktop. A page passes only if all three CWV meet "good" at p75 ([vitals](https://web.dev/articles/vitals)). The p75 was chosen to balance covering most visits against outlier sensitivity ([thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds)).
- **Stability:** stable CWV change at most once per year. Pending metrics spend at least 6 months in that phase ([vitals](https://web.dev/articles/vitals)). The vitals page was last updated 2024-10-31, and the thresholds above have **not changed** since INP's promotion.
- **INP replaced FID on 12 March 2024** ([web.dev blog](https://web.dev/blog/inp-cwv-march-12), [launch post](https://web.dev/blog/inp-cwv-launch)). FID is gone from the `web-vitals` library since v5.0.0 ([CHANGELOG](https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/CHANGELOG.md)).

### 2.2 Lab vs field

|            | Lab                                                                                         | Field (RUM, e.g. CrUX)                                       |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Conditions | Fixed device, network, location; reproducible                                               | Real users, devices, networks, caches                        |
| Best for   | Debugging, regression detection                                                             | Deciding what to fix; the CWV verdict                        |
| LCP        | Measurable. Often cold-cache; may pick a different LCP element                              | Varies by viewport, login, A/B variant, cache state, bfcache |
| INP        | **Not measurable without real interactions.** Only to the extent interactions are simulated | Measured across actual interactions                          |
| CLS        | Usually only load-time, above-the-fold shifts                                               | Includes shifts after scroll and interaction                 |

Source for this table: [lab vs field](https://web.dev/articles/lab-and-field-data-differences), [inp](https://web.dev/articles/inp).

- **TBT ≠ INP.** TBT is a load-time diagnostic. A page can have high TBT and low INP (if users interact after scripts finish), or good TBT and poor INP (e.g., mobile tap delay counts toward INP but not TBT) ([lab vs field](https://web.dev/articles/lab-and-field-data-differences)).
- Lighthouse cannot measure INP because there is no user input, so it uses TBT as a proxy ([vitals](https://web.dev/articles/vitals)). Lighthouse **timespan** mode measures layout shifts and JS execution during interactions but reports no LCP and no overall perf score ([user flows](https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md)).
- DevTools' Performance panel shows local LCP/CLS live, adds INP after you interact, and can compare against CrUX field data ([DevTools Performance](https://developer.chrome.com/docs/devtools/performance/overview)).
- **Jourilo implication (assessment):** Playwright-driven interactions can produce _lab_ interaction latencies. Report them as "lab INP-like measurements", never as a CWV pass or fail.

### 2.3 `web-vitals` library

| Item                | Detail                                                                                                                                                                                                                                                                 | Source                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Measures Web Vitals "on real users" (field)                                                                                                                                                                                                                            | [repo](https://github.com/GoogleChrome/web-vitals)                                                                                     |
| API                 | `onLCP`, `onINP`, `onCLS` (CWV); `onFCP`, `onTTFB`                                                                                                                                                                                                                     | [repo](https://github.com/GoogleChrome/web-vitals)                                                                                     |
| Attribution build   | `web-vitals/attribution` adds an `attribution` object with diagnostics. About 1.5K larger (brotli)                                                                                                                                                                     | [repo](https://github.com/GoogleChrome/web-vitals)                                                                                     |
| Size / license      | ~3K brotli; Apache-2.0                                                                                                                                                                                                                                                 | [repo](https://github.com/GoogleChrome/web-vitals)                                                                                     |
| Latest              | **6.2.3** (2026-10-05)                                                                                                                                                                                                                                                 | [CHANGELOG](https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/CHANGELOG.md), [npm](https://registry.npmjs.org/web-vitals) |
| v6.0.0 (2026-07-21) | Adds **soft-navigation** support where the browser supports it. **BREAKING:** module changes under `verbatimModuleSyntax`. `includeProcessedEventEntries` now defaults to `false`. requestIdleCallback wait capped at 1 s. bfcache reporting of small INP interactions | [CHANGELOG](https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/CHANGELOG.md)                                               |
| v5.0.0 (2025-05-07) | **Removed `onFID()`**. Browser support policy moved to Baseline Widely available                                                                                                                                                                                       | [CHANGELOG](https://raw.githubusercontent.com/GoogleChrome/web-vitals/main/CHANGELOG.md)                                               |
| Caveats             | INP is not reported if the user never interacts. CLS/FCP/LCP are not reported for pages loaded in the background. Callbacks may fire multiple times, e.g. on hide or bfcache restore. CWV for soft navigations require Chromium 151+                                   | [repo](https://github.com/GoogleChrome/web-vitals)                                                                                     |

---

## 3. Nielsen's 10 usability heuristics

Source: Jakob Nielsen, NN/g, originally 1994, last reviewed 2024-01-30 ([nngroup.com](https://www.nngroup.com/articles/ten-usability-heuristics/)).

1. Visibility of System Status
2. Match Between the System and the Real World
3. User Control and Freedom
4. Consistency and Standards
5. Error Prevention
6. Recognition Rather than Recall
7. Flexibility and Efficiency of Use
8. Aesthetic and Minimalist Design
9. Help Users Recognize, Diagnose, and Recover from Errors
10. Help and Documentation

Jourilo assessment: these are heuristics for expert review, not pass/fail rules. Machine-detected signals (e.g., no loading indicator, no inline error message) can be tagged with a heuristic as a _hint for human review_.

---

## 4. Experimentation statistics basics

### 4.1 Sample size for two proportions (A/B conversion test)

Per-group sample size for a two-sided test at significance α and power 1−β:

```
n = [ z(1−α/2) · sqrt(2 · p̄ · (1 − p̄)) + z(1−β) · sqrt(p1(1−p1) + p2(1−p2)) ]²  /  (p1 − p2)²
p̄ = (p1 + p2) / 2
```

This is the standard normal-approximation (pooled-null) form. It follows from solving the two-proportion power function documented by [OriginLab](https://docs.originlab.com/origin-help/pss-two-prop-algorithm/) for n, dropping the negligible opposite tail. Calculators differ slightly by approximation and continuity correction. Evan Miller's calculator takes baseline rate, MDE (absolute or relative), power and α as inputs ([Evan Miller calculator](https://www.evanmiller.org/ab-testing/sample-size.html)).

**Rule of thumb** (≈80% power, α = 0.05): `n ≈ 16 · σ² / δ²` with `σ² = p(1−p)` ([Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)).

Worked examples (α = 0.05 two-sided, power = 0.80; computed with the formula above):

| Baseline p1 | Target p2 | Relative MDE | n per group (formula) | n per group (16σ²/δ²) |
| ----------- | --------- | ------------ | --------------------- | --------------------- |
| 5%          | 5.5%      | +10%         | 31,234                | 30,400                |
| 5%          | 6%        | +20%         | 8,158                 | 7,600                 |
| 10%         | 11%       | +10%         | 14,751                | 14,400                |

### 4.2 Key concepts

| Concept                             | Definition / guidance                                                                                                                                                                                                                                                      | Source                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Minimum detectable effect (MDE)** | The smallest effect the test is powered to detect. Effects in the "gray area" are indistinguishable from baseline. Required n scales with 1/δ², so halving the MDE roughly quadruples n                                                                                    | [Evan Miller calculator](https://www.evanmiller.org/ab-testing/sample-size.html), [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)                                                                             |
| **Peeking problem**                 | Repeatedly checking significance and stopping on the first "significant" result inflates false positives. In Evan Miller's example a nominal 5% test reaches **~26.1%**. Remedies: fix n in advance, or use sequential or Bayesian designs built for continuous monitoring | [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)                                                                                                                                                               |
| Peeking in practice                 | Microsoft ExP requires stronger significance for early results and recommends running to the planned end unless movements are highly certain                                                                                                                               | [MS ExP during-experiment](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/)                                                                                         |
| **Sample ratio mismatch (SRM)**     | The observed split between variants differs from the configured split. A data-quality red flag that "typically invalidate[s]" results                                                                                                                                      | [Fabijan et al., KDD 2019](https://dl.acm.org/doi/10.1145/3292500.3330722), [MS ExP](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/)                               |
| SRM check                           | Chi-square test of observed vs expected counts. Microsoft ExP uses **p < 0.0005** (deliberately conservative) and blocks results until the check passes. Causes include bucketing bugs, redirects in one arm, logging and join issues, and biased triggering               | [MS ExP SRM](https://www.microsoft.com/en-us/research/articles/diagnosing-sample-ratio-mismatch-in-a-b-testing/)                                                                                                                       |
| SRM prevalence                      | ~6% of Microsoft experiments in one year, per a summary of the KDD 2019 paper (**unverified** against the paper's full text)                                                                                                                                               | [slide summary](https://www.slideshare.net/slideshow/detecting-incorrectly-implemented-experiments/236489000)                                                                                                                          |
| **Guardrail metrics**               | Metrics for things "we don't want to degrade but won't necessarily improve", such as page load time and error rates. Set alerts on them, and include them in the core metric set for every experiment                                                                      | [MS ExP during-experiment](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/)                                                                                         |
| Sequential / always-valid methods   | Vendor stats engines (Optimizely Stats Engine; Wingify/VWO; GrowthBook) offer sequential testing to allow monitoring. The claims are vendor-documented                                                                                                                     | [Optimizely](https://www.optimizely.com/insights/blog/statistics-for-the-internet-age-the-story-behind-optimizelys-new-stats-engine/), [Wingify](https://wingify.com/pricing/), [GrowthBook](https://github.com/growthbook/growthbook) |

### 4.3 Jourilo implications (assessment)

- Provide an MDE and sample-size feasibility helper with these inputs and the same caveats. Do not compute live significance.
- Offer local guardrail checks: each variant must meet the same a11y, CWV-lab and error thresholds as control before traffic is allocated.
- SRM detection belongs to the experimentation platform. Jourilo can only link to the concept.

---

## 5. Source index

- W3C: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- axe-core: [README](https://github.com/dequelabs/axe-core) · [API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md) · [rules](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md) · [releases](https://github.com/dequelabs/axe-core/releases) · [Deque coverage study](https://www.deque.com/automated-accessibility-testing-coverage/)
- web.dev: [vitals](https://web.dev/articles/vitals) · [thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) · [INP](https://web.dev/articles/inp) · [FCP](https://web.dev/articles/fcp) · [TTFB](https://web.dev/articles/ttfb) · [lab vs field](https://web.dev/articles/lab-and-field-data-differences) · [INP March 12](https://web.dev/blog/inp-cwv-march-12)
- Chrome: [DevTools Performance](https://developer.chrome.com/docs/devtools/performance/overview) · [Lighthouse a11y scoring](https://developer.chrome.com/docs/lighthouse/accessibility/scoring) · [Lighthouse user flows](https://github.com/GoogleChrome/lighthouse/blob/main/docs/user-flows.md) · [web-vitals](https://github.com/GoogleChrome/web-vitals)
- NN/g: [10 heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- Stats: [Evan Miller — How Not To Run an A/B Test](https://www.evanmiller.org/how-not-to-run-an-ab-test.html) · [Evan Miller sample size](https://www.evanmiller.org/ab-testing/sample-size.html) · [OriginLab two-proportion power](https://docs.originlab.com/origin-help/pss-two-prop-algorithm/) · [MS ExP SRM](https://www.microsoft.com/en-us/research/articles/diagnosing-sample-ratio-mismatch-in-a-b-testing/) · [MS ExP during-experiment](https://www.microsoft.com/en-us/research/articles/patterns-of-trustworthy-experimentation-during-experiment-stage/) · [Fabijan et al. 2019](https://dl.acm.org/doi/10.1145/3292500.3330722)
