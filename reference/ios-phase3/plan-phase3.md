## Phase 3 — lookup time vs. screen size (done)

Results in the "Lookup time vs. tree size (Phase 3)" section of [`coverage-report.md`](coverage-report.md); runner and data in [`device/`](device/README.md#scale-benchmark-phase-3).

- Class chain faster in all 240 lookups (simulator and iPhone 13 Pro Max, 100–2000 elements): 22–29 % per lookup at every size, 70 → 676 ms per lookup on the iPhone.
- No effect of locator shape or target position; `[1]` and `useFirstMatch` do not help; nothing below depth 50 is found.
- Deviations from the plan below: the deep branch is UIKit (SwiftUI merges single-child containers), page sources are read without `visible`, the simulator ran on AC and on battery, and a `--variants` run was added.

The plan as agreed:

Question: does class chain get faster than XPath as the tree grows? Phase 2b showed no total gain on LocatorLab's small screens (36–275 elements). XPath serializes the whole tree on every lookup, so the gap should widen on big screens.

**Screen.** One LocatorLab screen, `-screen scale -load 100|500|1000|2000`. The targets stay the same; only the background load around them changes. Background is iPhone-shaped. A plain `UINavigationController` drops earlier screens from the tree and SwiftUI drops `opacity(0)` views, so the load comes from what really stays in the tree on a phone:

| Group      | Elements     | Mimics                                                                                  | Tree position          |
| ---------- | ------------ | --------------------------------------------------------------------------------------- | ---------------------- |
| G1 targets | 100 (always) | "Checkout": nav bar, product cards, cart, address form, a review thread ~40 levels deep | middle                 |
| G2         | +400         | screens underneath in a ZStack-based navigator (RN, custom routers): Home feed, Catalog | before targets         |
| G3         | +500         | long non-lazy feed below the fold (recommendations, reviews)                            | after targets          |
| G4         | +1000        | drawer mounted off-screen (category tree), tab-bar tabs kept alive                      | after targets (on top) |

- Element types follow the corpus mix (StaticText > Button > Other > TextField). Realistic shop labels.
- No background name equals a target; near-misses ("Add to wishlist" vs "Add to cart") make `contains` scan everything.
- Acceptance: page-source element count within ±2 % of the target size on the simulator.
- `scale-deep`: one element at absolute depth ~55 (WDA 16.14.1 `snapshotMaxDepth` = 50, `FBConfiguration.m:356`); records what XPath and chain return. Not timed.

**Locator shapes** (~340 of the corpus's 460 XPath locators, ~74 %):

1. `//T[@name="v"]` (115)
2. `//T[contains(@name,"v")]` (44)
3. `//*[contains(@type,"v") and contains(@label,"v")]` (36)
4. `//T[@label="v"]` (34)
5. `//*[contains(@type,"v") and contains(@name,"v")]` (28)
6. `//T[contains(@label,"v")]` (22)
7. `//*[contains(@name|@label,"v")]`, untyped (22)
8. `(//T[@name="v"])[n]` (20; RC-D1 warning; exactly 3 copies in G1)
9. `//*[@name="v" and @label="v"]`, untyped and typed (16)
10. `//*[contains(@name,"v")]/child::T[@name="v"]`, a path (3; exercises the deep branch)

Each shape is used on 3 targets: top of screen (shallow, early in traversal), deep branch (~40), end of G1. Chain `findElement` may stop at the first match; XPath always serializes the tree. That makes 30 lookups per size. `following-sibling` shapes are skipped by the converter and stay XPath.

**Timing.**

- One session per size, settle, then 3 passes of all 30 lookups. XPath/chain order alternates, no warm-up, every lookup cold on the current screen; median of 3.
- Before timing, XPath and chain must find the same element at every size; a point that fails is flagged and not timed.
- `getPageSource` time per size is recorded as the tree-serialization baseline.
- Simulator first, then the iPhone 13 Pro Max over USB.

**Deliverables.**

- Scale cases and runner in `device/`, plus `results-scale*.json`.
- A report section with size × shape × position, and a chart of lookup time vs. screen size.
- README instructions so others can run the benchmark on their devices.
