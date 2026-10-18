# Stage 1 spike — findings

2026-10-18, emulator `Medium_Phone_API_37.0` (Android 17, Google Play image), Appium 3.8.0,
uiautomator2 driver 8.7.0 / server 10.6.6, default UiAutomator2 settings, host on AC power.
Script: `bench/spike.js`; raw data: `results/spike-emulator.json` (all sections, 4 cores),
`results/spike-emulator-cores2.json` and `results/spike-emulator-cores4.json` (stability only, each
after the guest settled to load < 1.5).

Verdict: **go**, with the changes listed under "Consequences".

## 1. What is in the tree (2000 cells, default settings)

| Background load | Elements in page source | Cells in tree | Page source, median |
|---|---|---|---|
| Layers stacked on top of each other, all on screen | 2214 | 2000 | 1407 ms |
| Layers moved off screen (closed drawer, other pages) | 225 | 200 | 144 ms |
| Layers `INVISIBLE` | 225 | 200 | 157 ms |
| `ScrollView`, most cells below the fold | 225 | 200 | 359 ms |

Only overlapping on-screen views count (`allowInvisibleElements=false`). The background load must be
screens stacked with `add` (as a fragment back stack does), a drawer overlay that is open, etc.

Edge-to-edge (enforced for `targetSdk` ≥ 35): views drawn under the status bar are not visible to the
user and drop out of the tree (the depth markers at levels 5 and 10 were missing for every strategy).
The app must pad its content by the system-bar insets.

## 2. Depth limit

`snapshotMaxDepth=70`. In a 100-level chain the page source and XPath see down to the marker at level
65; deeper elements do not exist for XPath. UiSelector found every marker down to level 100: it is not
limited by `snapshotMaxDepth`. This is a functional difference, not only a timing one; the 40-level deep
branch of the plan stays inside the limit.

## 3. Fixed costs

| Request | Median (10×) |
|---|---|
| `GET /status` (Appium only, no device) | 0.7 ms |
| Get one attribute (device round trip) | 8.6 ms |
| UiSelector miss, 100-cell tree | 52 ms |
| XPath miss, 100-cell tree | 78 ms |

## 4. First lookup after an app start

The first lookup after every app launch is much slower, whatever the strategy, and the cost grows
with the tree: +40–250 ms at 100 cells, +400–900 ms at 2000 (e.g. 1243 ms vs a median of 656 ms).
The very first lookup of a session adds a little more (380 ms vs 87 ms at 100 cells). It looks like
the app process building its accessibility nodes the first time they are asked for. A real test pays
this once per freshly started screen, on whichever locator comes first, so it is not a property of
the strategy.

## 5. Accessibility cache

With the default `deferAccessibilityCacheReset=false` the server resets the cache before each lookup.
Measured: the same target 5× in a row is not faster than 10 different targets once each (XPath at
2000 cells: repeats 612–883 ms after the first, fresh targets 623–724 ms interquartile). A second
strategy right after the first on the same target is not faster either, beyond the first-lookup effect.
So repeated passes over the same elements are cold in this sense.

## 6. CPU and core count

Stability on 10 fresh targets of the last row, each looked up once per fresh app, two rounds;
medians **without** the first lookup after each launch:

| Run | Cells | XPath | UiSelector | `id` | XPath / UiSelector | Saving |
|---|---|---|---|---|---|---|
| 4 cores, guest busy (load 3.7) | 100 | 61 ms | 43 ms | 44 ms | ×1.40 | 17 ms, 28 % |
| | 2000 | 656 ms | 574 ms | 525 ms | ×1.14 | 82 ms, 12 % |
| 4 cores, settled guest | 100 | 75 ms | 47 ms | 50 ms | ×1.60 | 28 ms, 37 % |
| | 2000 | 771 ms | 552 ms | 569 ms | ×1.40 | 219 ms, 28 % |
| 2 cores, settled guest | 100 | 74 ms | 40 ms | 43 ms | ×1.86 | 34 ms, 46 % |
| | 2000 | 631 ms | 345 ms | 365 ms | ×1.83 | 286 ms, 45 % |

- No core is pinned: per-core busy median 35–65 %, max 76–94 %; the host runs qemu at a median of
  140–200 % of one core out of 10. The lookups are not CPU-bound.
- UiSelector and `id` are faster than XPath in every run, but the size of the gain moves with the
  emulator's state (×1.14–×1.83 at 2000 cells). Fewer vCPUs were faster, likely because a lookup is
  thousands of binder calls between the UiAutomator2 server and the app, and cross-vCPU wake-ups are
  expensive in a VM. Absolute ms and the exact ratio are therefore emulator-specific; the direction
  and the growth with size are what the emulator can show. A real phone is needed for the magnitude.
- Spread is wide (2 cores, XPath at 2000: 532–1045 ms interquartile), with single outliers up to ×2.
- Host state matters a lot: on battery with Low Power Mode, building the 2000-cell screen took 6–7.5 s
  instead of 0.15–1 s.

All strategies returned the same element (attribute fingerprint) in every check.

## Consequences for stages 2–4 (proposed, to confirm)

1. Background load = overlapping on-screen layers; content padded by system-bar insets.
2. After each app launch: one untimed lookup of an unrelated element, then the timed ones; the
   first-lookup cost is reported separately per size.
3. Wait for the guest to settle (load average < 1.5) before each size; record guest load and the
   host's power state per size; refuse to start on battery / Low Power Mode unless forced.
4. More passes against the spread: 5 instead of 3 (median).
5. Run the emulator benchmark at 2 and at 4 cores and report both; the ratio range is the honest
   emulator result.
