# Reference material

Copied from [xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain) (same author, MIT) on 2026-10-18 as a starting point. Nothing here runs as is: it targets iOS (XCUITest driver, WDA, the SwiftUI LocatorLab app).

`ios-phase3/` — the Phase 3 scale benchmark (XPath vs. class chain, 100–2000 elements):

- `plan-phase3.md` — the agreed plan (from `audit/PLAN.md`)
- `report-phase3.md` — the results section (from `audit/coverage-report.md`)
- `README-scale.md` — how it was run (from `audit/device/README.md`)
- `make-scale.js` — generates the screen layout and the 30 cases per size
- `scale.js` — the WebdriverIO runner (sessions per size, 3 cold passes, median, `--resume`, host power state, `caffeinate`)
- `make-scale-chart.js` — the SVG chart
