# appium-android-locator-benchmark

Does replacing XPath with `-android uiautomator` (UiSelector), `id` or `accessibility id` make Appium
element lookups on Android (UiAutomator2) faster, and does the gain grow with the tree size?

**Result (emulator):** UiSelector was faster than XPath in every one of 30 cases at every size:
22 ms (49 %) per lookup at 100 elements, 133 ms (12 %) at 2000. Deeper than 70 levels XPath finds
nothing; UiSelector still does. Details and limits: [REPORT.md](REPORT.md).

![Time per lookup vs. elements in the tree](scale-chart.svg)

## Run it on your own device or emulator

Needs Node ≥ 20, Android SDK (`adb`), a JDK (to build the app) and exactly one device in `adb devices`.
The host must be on AC power with Low Power Mode off (macOS), or the runner refuses to start.

```sh
npm install                                  # Appium 3.8.0 + uiautomator2 driver 8.7.0, local
cd app && ./gradlew installRelease && cd ..  # ScaleLab, release build (a debuggable build is refused)
npm run appium                               # in another terminal, port 4723
node bench/scale.js --out results-scale-mydevice.json      # 4 sizes × 3 passes, ~10–15 min
node bench/scale.js --deep --out results-scale-deep-mydevice.json
node bench/make-scale-chart.js results/results-scale-mydevice.json my-chart.svg
```

`node bench/scale.js --resume` continues an interrupted run; the header of
[bench/scale.js](bench/scale.js) lists all options. On an emulator, start it without a window
(`-no-window`): a hidden emulator window is deprioritised by macOS and lookups get several times slower.

## Files

| Path | What |
|---|---|
| [REPORT.md](REPORT.md) | results and limits |
| [PLAN.md](PLAN.md) | method, decisions, what was built in each stage |
| [docs/environment.md](docs/environment.md) | pinned versions, AVD setup |
| [docs/spike.md](docs/spike.md) | feasibility checks: what is in the tree, depth limit, cache, CPU |
| `app/` | ScaleLab, the test app (Kotlin, Views, no AndroidX) |
| `bench/make-scale.js` | generates the screens (`app/.../assets/scale.json`) and `bench/scale-cases.json` |
| `bench/scale.js` | the runner |
| `results/` | raw results (JSON) |
| `reference/ios-phase3/` | the iOS benchmark this one follows |
