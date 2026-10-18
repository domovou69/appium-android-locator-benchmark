## Lookup time vs. tree size (Phase 3)

Does converting to class chain make tests faster? Phase 2 and 2b timed small screens. Phase 3 times the same lookups while the number of elements in the accessibility tree grows. Data: `device/results-scale-*.json`; how to run it: [`device/README.md`](device/README.md#scale-benchmark-phase-3).

### Setup

| | |
|---|---|
| Screen | LocatorLab `scale`, `-load 100/500/1000/2000`. The same Checkout page with 100 target elements; extra elements are added around it: screens underneath in a ZStack navigator (+400), a long feed below the fold (+500), a drawer mounted off-screen and kept-alive tabs (+1000). Deep targets sit at depth 39 (a UIKit branch: SwiftUI merges single-child containers) |
| Locators | the 10 most frequent convertible shapes of the corpus (~340 of its 460 XPath locators), each on 3 targets: top of the page, deep branch, end of the page. 30 lookups per size |
| Method | one session per size, then 3 passes; each lookup is one cold `findElement`, no warm-up, XPath/chain order alternating; median of the 3 passes. Before timing, XPath and chain must return the same single element (all 240 did) |
| Devices | simulator iPhone 17, iOS 27.0, on an M1 Pro (16 GB); iPhone 13 Pro Max, iOS 26.6, USB. Appium 3.8.0 / xcuitest-driver 12.16.0 / WDA 16.14.1 |
| Host power | simulator runs on AC with Low Power Mode off (`results-scale-ac.json`) and on battery with Low Power Mode on (`results-scale-battery.json`); recorded per size in `host` |

### Class chain savings by tree size (%)

Savings = (XPath − chain) / XPath, over the 30 lookups; in brackets the time saved per lookup.

| Elements in the tree (simulator / iPhone) | Simulator | iPhone 13 Pro Max |
|---|---|---|
| 102 / 99 | 21.9 % (25 ms) | 23.8 % (70 ms) |
| 503 / 494 | 24.1 % (109 ms) | 23.4 % (178 ms) |
| 998 / 989 | 25.8 % (235 ms) | 28.9 % (405 ms) |
| 1998 / 1989 | 25.4 % (445 ms) | 24.9 % (676 ms) |

The chain was faster in all 240 lookups (30 × 4 sizes × 2 devices).

![Time per element lookup vs. elements in the tree, XPath and class chain, simulator and iPhone](scale-chart.svg)

Chart: `node device/make-scale-chart.js` (simulator on AC, iPhone).

### Time per lookup by tree size

| Elements | Simulator XPath | Simulator chain | iPhone XPath | iPhone chain | Page source (simulator, without `visible`) |
|---|---|---|---|---|---|
| 100 | 115 ms | 90 ms | 295 ms | 225 ms | 139 ms |
| 500 | 453 ms | 344 ms | 760 ms | 582 ms | 683 ms |
| 1000 | 912 ms | 677 ms | 1.40 s | 997 ms | 1.35 s |
| 2000 | 1.75 s | 1.31 s | 2.72 s | 2.04 s | 2.58 s |

### Host power (simulator)

| Elements | XPath per lookup, battery + LPM → AC | Chain per lookup, battery + LPM → AC | Faster on AC | Chain savings, battery + LPM → AC |
|---|---|---|---|---|
| 100 | 133 ms → 115 ms | 105 ms → 90 ms | 14 % | 21.4 % → 21.9 % |
| 500 | 541 ms → 453 ms | 409 ms → 344 ms | 16 % | 24.4 % → 24.1 % |
| 1000 | 1.09 s → 912 ms | 808 ms → 677 ms | 16 % | 25.9 % → 25.8 % |
| 2000 | 2.10 s → 1.75 s | 1.57 s → 1.31 s | 16 % | 25.3 % → 25.4 % |

### Regular screens (Phase 2 and 2b)

The LocatorLab test screens (36–275 elements) with the same per-lookup method, but `findElements` (all matches), and the audit's spec and corpus cases rather than the most frequent shapes.

| | Simulator (`results.json`) | iPhone 13 Pro Max (`results-device.json`) |
|---|---|---|
| Cases timed | 179 | 178 |
| Median per lookup, XPath / chain | 150 / 118 ms | 350 / 285 ms |
| Savings on the median | 21.4 % | 18.5 % |
| Chain faster in | 130 | 138 |
| Total, XPath / chain | 53.7 / 64.8 s | 114.8 / 118.6 s |
| Savings on the total | −20.7 % | −3.4 % |
| Total without A07, A16, B07, B10 | 45.7 / 43.9 s (3.8 %) | 100.6 / 92.6 s (8.0 %) |

### Slow class chains in Phase 2

None of these shapes is in the corpus: it has no `visible` locator and one bare-type locator (`//XCUIElementTypeWebView`).

| Case | XPath | Chain | Matches | Simulator XPath / chain | iPhone XPath / chain |
|---|---|---|---|---|---|
| B07 | `//XCUIElementTypeButton[@visible='true']` | ``**/XCUIElementTypeButton[`visible == true`]`` | 32 | 2.05 / 12.60 s | 3.30 / 10.77 s |
| A16 (lists) | `//XCUIElementTypeCell[@visible="true"]/XCUIElementTypeButton` | ``**/XCUIElementTypeCell/XCUIElementTypeButton[`visible == 1`]`` | 23 / 24 | 3.46 / 5.14 s | 6.01 / 8.71 s |
| B10 | `//XCUIElementTypeButton[@name]` | ``**/XCUIElementTypeButton[`name != nil`]`` | 36 | 1.15 / 1.78 s | 3.03 / 4.08 s |
| A07 | `/XCUIElementTypeApplication/XCUIElementTypeWindow/XCUIElementTypeButton` | `**/XCUIElementTypeButton` | 1 | 0.12 / 0.75 s | 0.29 / 1.69 s |

### First match (simulator, battery + LPM)

Savings over the chain as converted, same method (`results-scale-variants.json`).

| Variant | 100 elements | 2000 elements |
|---|---|---|
| Chain with an explicit `[1]` (27 cases; shape 8 already has a position) | 0.1 % | 0.1 % |
| Chain with the `useFirstMatch` setting | 2.7 % | −5.7 % (deep targets −15 %) |

In WDA 16.14.1 a single lookup without a position and one with `[1]` both go through `fb_firstMatch`, which collects all matches and takes the first unless `useFirstMatch` is on (`FBXCodeCompatibility.m`).

### Depth limit

`scale-deep`: one chain of nested views with a marker every 5 levels (`results-scale-deep*.json`). WDA's default `snapshotMaxDepth` is 50.

| Depth in the page source | XPath | Chain |
|---|---|---|
| up to 50 | found | found |
| over 50 (markers 45–70) | `no such element` | `no such element` |

Same on the simulator and the iPhone. The page source ends at depth 50 as well.

### Limits of these measurements

- Only element lookup is timed: one cold `findElement` per locator. With an implicit wait or a retry loop, a lookup that does not find the element at once repeats the whole search, so the time saved per lookup is multiplied by the number of attempts (not measured).
- The screen is synthetic (LocatorLab); no production app was measured.
- One WDA version (16.14.1). Its class chain lookup strategy changed recently (`XCUIElement+FBClassChain.m`, appium/WebDriverAgent PR #1194), so other versions may give other numbers.
- One phone (iPhone 13 Pro Max) and one iOS version per device (26.6 on the phone, 27.0 on the simulator).
- The simulator ran on one Mac (Apple M1 Pro, 16 GB, macOS 26.6.2), on AC with Low Power Mode off and on battery with Low Power Mode on; absolute times on other hosts will differ.

### Conclusions

1. The class chain was faster than XPath in all 240 lookups.
2. In percent, the savings do not depend on the tree size: 22–29 %. In time, they grow with it: 25 → 445 ms per lookup on the simulator, 70 → 676 ms on the iPhone.
3. Neither the locator shape nor the target's position (top, depth 39, end) changes the savings: both strategies pay for the whole tree on every lookup.
4. An explicit `[1]` changes nothing; `useFirstMatch` does not help and is slower for deep targets.
5. Nothing deeper than 50 levels is found by either strategy, and the error is a plain `no such element`.
6. The iPhone is 2.6 times slower than the simulator at 100 elements and 1.55 times at 1000–2000 (a fixed per-request cost over USB). Host power changes the simulator's times (16 % faster on AC on an M1 Pro), not the savings.
7. A page source with the `visible` attribute takes 53 s at 1000 elements on the simulator, 1.4 s without it.
8. On regular screens (up to ~300 elements in the tree) the per-lookup savings are similar in percent (18–21 % on the median) but only tens of milliseconds. In total, Phase 2 lost time on the chain side because of four cases: `visible` predicates, lookups of all matches when there are dozens, and a short absolute path that the optimizer turns into `**/`. Convert lookups of one element by name, label, value or type; check locators with `visible`, list lookups with many matches, and absolute paths before converting them.

