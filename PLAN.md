# PLAN — Appium Android locator benchmark (draft, decisions of 2026-10-18 applied)

Question: on Android (UiAutomator2), is there a noticeable lookup-time gain from replacing XPath with
`-android uiautomator` (UiSelector), `id` (resource-id) or `accessibility id`, and does it grow with the
tree size? The method follows the iOS Phase 3 benchmark (`reference/ios-phase3/`); the differences are
listed in "Differences from iOS".

Why a gain is plausible: in the UiAutomator2 server, XPath serializes the whole accessibility tree to
XML and evaluates the expression on it; UiSelector, `id` and `accessibility id` walk the
`AccessibilityNodeInfo` tree natively and can stop at the first match. This is checked, not assumed.

## Stages

Times are wall clock; "window" = share of one 5-hour usage window spent by Claude on the stage
(background runs and downloads cost little window but take wall time). Each stage needs a "yes" first.

| # | Stage | Output | Wall time | Window |
|---|---|---|---|---|
| 0 | Environment: Android Studio (installed by the user) with its SDK, bundled JDK, emulator and system image; one AVD; Appium + uiautomator2 driver as devDependencies; pin versions | `docs/environment.md` with exact versions | ~20 min + downloads | ~5 % |
| 1 | Feasibility spike: a throwaway app with ~2000 views; check what is in the tree with default settings (off-screen, overlapped, other fragments), `snapshotMaxDepth`, page-source time, `waitForIdleTimeout`, element identity | go/no-go notes in `docs/spike.md`; decides where the background load lives | ~45 min | ~10 % |
| 2 | ScaleLab app + `make-scale.js` port: same 100 targets, background load to 100/500/1000/2000, deep branch, `scale-deep` screen | `app/`, `bench/make-scale.js`, `bench/scale-cases.json`; element counts within ±2 % | 60–90 min | ~15–20 % |
| 3 | Runner `bench/scale.js` (standalone, plain WebDriver HTTP like the iOS one): validation, 3 cold passes, median, alternating order, `--resume`, `--count`, `--deep`, host state, `caffeinate` | runner + smoke run at 100 elements | ~60 min | ~15 % |
| 4 | Emulator run: 4 sizes × 30 cases × 2–4 strategies × 3 passes, in the background, chunked per size | `results/results-scale-emulator.json` | 30–60 min | ~5 % |
| 5 | Depth limit + page source per size (+ optional settings variants, see questions) | `results/results-scale-deep-emulator.json` | ~20 min | ~5 % |
| 6 | Real phone over USB — **postponed: no phone for now** | — | — | — |
| 7 | Report, chart, README (how to run on your own device), "Limits of these measurements" | `REPORT.md`, `scale-chart.svg`, `README.md` | 45–60 min | ~10–15 % |
| | Total (without stage 6) | | ~5–7 h over 2–3 sessions | ~65–75 % of one window |

Cheaper path: stop after stage 4 at 100 and 2000 elements only (≈ half the run time) if the
emulator already shows no gain or a large one; stages 5–6 then only confirm.

## What we measure

- Per lookup: one cold `findElement`, no warm-up, strategy order rotating per case and per pass,
  3 passes, median per case and strategy. Savings always shown in % and in ms.
- Strategies per case:
  - `xpath` vs `-android uiautomator` — all 30 cases;
  - `id` — only cases that select by exact resource-id;
  - `accessibility id` — only cases that select by exact content-desc.
- Validation before timing: every strategy of a case must return the same single element (shape 8:
  XPath without the position finds exactly 3). Identity by fingerprint (class, resource-id, text,
  content-desc, bounds), not by element id. Otherwise `INVALID`, not timed.
- Per size: element count, max depth, depth of the 3 position targets, page-source time (3×).
- Depth limit: `scale-deep` with a marker every 5 levels up to ~100; what each strategy and the page
  source return around UiAutomator2's `snapshotMaxDepth` (to be confirmed in the spike; believed default 70).
- Recorded in every result: Appium / uiautomator2 driver / server versions, Android version, device or
  AVD name and image, all UiAutomator2 settings in effect, host CPU, memory, macOS, power (AC/battery),
  Low Power Mode.

## Locator shapes (draft — no Android corpus yet)

The iOS shapes mapped to Android attributes (`resource-id`, `text`, `content-desc`, `class`).
Each on 3 targets: top of the screen, deep branch (~40 levels), end of the target group → 30 cases.

| # | XPath form | UiSelector | Also |
|---|---|---|---|
| 1 | `//T[@resource-id="pkg:id/v"]` | `className(T).resourceId(v)` | `id` |
| 2 | `//T[contains(@text,"v")]` | `className(T).textContains(v)` | |
| 3 | `//*[contains(@class,"Button") and contains(@text,"v")]` | `classNameMatches(".*Button.*").textContains(v)` | |
| 4 | `//T[@text="v"]` | `className(T).text(v)` | |
| 5 | `//*[contains(@class,"EditText") and contains(@resource-id,"v")]` | `classNameMatches(...).resourceIdMatches(".*v.*")` | |
| 6 | `//T[contains(@content-desc,"v")]` | `className(T).descriptionContains(v)` | |
| 7 | `//*[@content-desc="v"]` | `description(v)` | `accessibility id` |
| 8 | `(//T[@text="v"])[n]` | `className(T).text(v).instance(n-1)` | |
| 9 | `//*[@resource-id="v" and @text="v"]` | `resourceId(v).text(v)` | |
| 10 | `//*[contains(@resource-id,"v")]/child::T[@text="v"]` | `resourceIdMatches(...).childSelector(className(T).text(v))` | |

Notes: `childSelector` matches descendants, not only children — validation catches a mismatch.
`instance()` is 0-based. `following-sibling` stays XPath (as on iOS).

## App

Recommendation: **one Android View app, no Compose, no AndroidX** — minimal Gradle project (AGP,
Kotlin, `minSdk` 26), one Activity that builds the tree programmatically from
`assets/scale.json` (the same "one description → screen + cases" idea as `make-scale.js`).
- Plain `android.widget.*` gives stable `class` names and real `resource-id`s (`View.generateViewId`
  can't give names, so ids are declared in `res/values/ids.xml`, generated too).
- No AndroidX → fewer Gradle downloads (matters on a hotspot) and no `DrawerLayout`/`ViewPager`;
  drawer and kept-alive tabs are plain layouts placed/translated by hand.
- Static UI: no animations, no ticking timers, so `waitForIdle` returns at once.
- Compose would be a separate phase (semantics merging, `testTagsAsResourceId`, lazy lists compose
  only visible items) — see questions.

Background load (to be adjusted after the spike): by default UiAutomator2 drops nodes that are not
visible to the user (`allowInvisibleElements=false`), so content below the fold, an off-screen
drawer and off-screen pages may not count at all. The likely Android-shaped load that stays in the
tree: fragments/screens stacked on top of each other with `add` instead of `replace` (overlapped
views are still "visible to user"), a visible drawer overlay, a tab pager whose pages share the
screen bounds. The spike decides which of these really count.

## Differences from iOS (to confirm)

1. Up to 4 strategies instead of 2; `id` / `accessibility id` timed only where they apply.
2. Background load must be visible-to-user (see above), unless we also run with
   `allowInvisibleElements=true`.
3. No WDA; UiAutomator2 settings that may affect timing are fixed and recorded
   (`waitForIdleTimeout`, `allowInvisibleElements`, `snapshotMaxDepth`, `simpleBoundsCalculation`,
   `ignoreUnimportantViews`).
4. Element identity by attribute fingerprint.
5. Depth check up to ~100 levels instead of 70 (Android limit believed to be 70).
6. No `visible` attribute problem for page source (to be checked); no `useFirstMatch` variant.

## Folder structure

```
PLAN.md  README.md  REPORT.md  scale-chart.svg
package.json            appium + appium-uiautomator2-driver pinned (devDependencies), npm scripts
docs/environment.md     install steps and pinned versions
docs/spike.md           stage 1 findings
app/                    ScaleLab Gradle project (assets/scale.json and ids.xml generated)
bench/make-scale.js     screen + cases from one description
bench/scale-cases.json
bench/scale.js          runner
bench/lib/              session, host state, stats, fingerprint
bench/make-scale-chart.js
results/                results-scale-*.json
reference/              iOS material (unchanged)
```

## Environment (stage 0)

Android Studio is installed with its default SDK set (the user's choice; downloads go over a mobile
hotspot). Use what it installed instead of downloading more: its bundled JDK (`JAVA_HOME` = Studio's
`jbr`), `platform-tools`, `emulator`, the SDK platform and, if the setup wizard created one with an AOSP
image, its AVD; otherwise one AVD is created (name recorded here) on the AOSP image. Any extra download (another image, build-tools) is announced with its size first.

## Decisions (2026-10-18)

1. View app only (Kotlin, no AndroidX). Compose — possible later phase.
2. No Android locator corpus: the draft shape table above is used.
3. Default UiAutomator2 settings only; background load made of nodes visible to the user. No
   `allowInvisibleElements` variant.
4. Sizes 100/500/1000/2000, as on iOS.
5. Emulator image: AOSP (`default`) arm64. Android Studio's default image is used only if it is already AOSP;
   otherwise the AOSP image (~1–1.5 GB) is downloaded after a size/time estimate.
6. No real phone for now: emulator only; stage 6 postponed.
7. Downloads over the hotspot as is.
8. All 30 cases keep 3 positions (top / deep / end). `id` and `accessibility id` are timed on the
   cases where they apply (shapes 1 and 7), which also cover the 3 positions.
9. No settings-variants side table.
10. Kotlin.
