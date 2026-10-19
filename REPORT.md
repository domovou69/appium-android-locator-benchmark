# Report — XPath vs UiSelector on Android (UiAutomator2)

2026-10-19. Emulator `AOSP_API_36` (AOSP Android 16, 4 cores, 4 GB, headless) on an Apple M1 Pro on AC
power; Appium 3.8.0, uiautomator2 driver 8.7.0 / server 10.6.6, default UiAutomator2 settings.
Raw data: `results/results-scale-emulator.json`, `results/results-scale-deep-emulator.json`.

**Answer:** yes. `-android uiautomator` (UiSelector) was faster than XPath in every case at every
size: 22 ms (49 %) per lookup at 100 elements, 133 ms (12 %) at 2000. The saving in ms grows with the
tree; the saving in % shrinks. Deeper than 70 levels XPath does not find elements at all, while
UiSelector does.

![Time per lookup vs. elements in the tree](scale-chart.svg)

## Method

- App: ScaleLab (View-based, release build), one screen with 100 / 497 / 1000 / 1989 elements in the
  tree. The background load is full-screen layers stacked under the target screen (as a back stack
  built with `add`), so UiSelector, which stops at the first match, walks the whole background first —
  the unfavourable order for it.
- 30 cases: 10 XPath shapes, each on 3 targets (top of the screen, a 39-level-deep branch, end).
  Every strategy of a case must return the same single element (attribute fingerprint) before timing.
- Per size: 3 passes, each a fresh app start, one untimed lookup, then one cold `findElement` per case
  and strategy, order rotating per case and pass. Median of 3 passes per case. Guest load average
  < 1.5 before each pass.

## Results

Time per lookup = mean of the 30 case medians (3 for `id` and `accessibility id`).

| Elements | XPath | UiSelector | Saving | `id` saving (3 cases) | `accessibility id` saving (3 cases) | Page source |
|---|---|---|---|---|---|---|
| 100 | 44 ms | 22 ms | 22 ms, 49 % | 22 ms, 52 % | 23 ms, 53 % | 41 ms |
| 497 | 256 ms | 204 ms | 52 ms, 20 % | 51 ms, 23 % | 47 ms, 18 % | 339 ms |
| 1000 | 557 ms | 485 ms | 71 ms, 13 % | 53 ms, 12 % | 64 ms, 11 % | 727 ms |
| 1989 | 1150 ms | 1018 ms | 133 ms, 12 % | 150 ms, 16 % | 101 ms, 9 % | 1454 ms |

- UiSelector was faster in 30 of 30 cases at every size.
- By target position at 100 elements: top 74 %, deep 48 %, end 25 % saving. At 2000 elements all
  positions save 11–12 %: the background walk dominates, wherever the target is.
- XPath time follows the page-source time (it serializes the whole tree first); UiSelector's cost
  also grows with the tree here because the targets sit after the whole background load.
- The Google Play image (`results/results-scale-emulator-play.json`, Android 17) gave the same savings:
  49 / 22 / 13 / 13 %.

## Depth limit

`snapshotMaxDepth` is 70. On a 100-level chain with a marker every 5 levels, page source and XPath see
markers down to tree depth 66 and find nothing below; UiSelector found every marker down to level 100.
Same on the Play and AOSP images. For deep trees this is a functional difference, not only a timing one.

## Limits of these measurements

- Emulator only. Absolute ms are synthetic: the M1 Pro is faster than most phone CPUs, and the ratio
  moved with the number of vCPUs (×1.14–×1.83 at 2000 elements in the spike). The direction and the
  growth with size are what the emulator shows; a real phone is needed for the magnitude.
- One View-based app with one screen layout; Compose, `WebView` and real apps are not measured.
- 30 synthetic cases from a draft shape table, not from a corpus of real Android locators.
- `id` and `accessibility id` have 3 cases per size each: indicative only.
- Default UiAutomator2 settings only.
