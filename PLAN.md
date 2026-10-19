# PLAN — Appium Android locator benchmark (draft, decisions of 2026-10-18 applied)

Question: on Android (UiAutomator2), is there a noticeable lookup-time gain from replacing XPath with
`-android uiautomator` (UiSelector), `id` (resource-id) or `accessibility id`, and does it grow with the
tree size? The method follows the iOS Phase 3 benchmark (`reference/ios-phase3/`); the differences are
listed in "Differences from iOS".

Why a gain is plausible: in the UiAutomator2 server, XPath serializes the whole accessibility tree to
XML and evaluates the expression on it; UiSelector, `id` and `accessibility id` walk the
`AccessibilityNodeInfo` tree natively and can stop at the first match. This is checked, not assumed.

## Why / what next

On iOS ([xpath-to-class-chain](https://github.com/domovou69/xpath-to-class-chain)) class chain was
22–29 % faster than XPath at 100–2000 elements (70 → 676 ms per lookup, iPhone 13 Pro Max). For Android
no controlled measurement of XPath vs native strategies was found (only blog posts without a method),
and no ready XPath → UiSelector converter (only a parser inside the Python framework Shadowstep).

- Noticeable gain → next project: XPath → `-android uiautomator` converter with the iOS discipline
  (exact → convert, close → convert with a warning, the rest → skip with a reason).
- No gain → publish the result (dev.to article), maybe a cross-platform brittle-locator linter.

## Stages

Times are wall clock; "window" = share of one 5-hour usage window spent by Claude on the stage
(background runs and downloads cost little window but take wall time). Each stage needs a "yes" first.

| # | Stage | Output | Wall time | Window |
|---|---|---|---|---|
| 0 | Environment: Android Studio (installed by the user) with its SDK, bundled JDK, emulator and system image; one AVD; Appium + uiautomator2 driver as devDependencies; pin versions | `docs/environment.md` with exact versions | ~20 min + downloads | ~5 % |
| 1 | Feasibility spike: a throwaway app with ~2000 views; check what is in the tree with default settings (off-screen, overlapped, other fragments), `snapshotMaxDepth`, page-source time, `waitForIdleTimeout`, element identity; emulator validity check (see below) | go/no-go notes in `docs/spike.md`; decides where the background load lives | ~45 min | ~10 % |
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
  3 passes, median per case and strategy. "Cold" includes the accessibility cache: no timed lookup
  may hit an element already fetched in the same app run (how this is enforced follows the cache
  check of stage 1). Savings always shown in % and in ms.
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

## Emulator validity check (stage 1)

Question: does the emulator show the real cost difference between strategies, or is it CPU-bound and
noisy? A `findElement` runs on one thread of the UiAutomator2 server (plus the app's and
`system_server`'s accessibility work), so one lookup uses about one core; extra vCPUs only keep the
background (GC, system services, Play services) off that core. Checks:

1. vCPUs: the AVD gets 4 cores (Studio created it with `hw.cpu.ncore=1`, which puts the app, the
   server and the system on one core).
2. Load during lookups: guest `/proc/loadavg` and `top -b -n 1` (per-process CPU), host CPU of
   `qemu-system-aarch64`. Passes if no core is pinned at 100 % between lookups and the host is not
   saturated.
3. Transport baseline: time of a trivial request (`GET /status`) and of a `findElement` that misses on
   a tiny tree; this fixed cost (HTTP + adb forward) is reported, so ms savings are not diluted unseen.
4. Cache effect: Android caches `AccessibilityNodeInfo`s on the client side (`AccessibilityCache` in
   the UiAutomator2 server process), so a repeated lookup of the same element may be faster, unlike a
   real test where most actions hit new elements. Measured: the same lookup 1st vs 2nd–5th time, and a
   2nd strategy right after the 1st on the same target. If repeats are faster, every timed lookup must
   be cold: the app is restarted (`am force-stop` + launch, new window = empty cache) before each
   pass, and inside a pass each target is looked up by one strategy only, so strategies of a case run
   in different passes or after a cache reset (`UiAutomation.clearCache()` if reachable from the server).
5. Stability on fresh targets: 10 different targets of the same shape and position at 100 and 2000
   elements, each looked up once, cold; spread (min/median/max) must be well below the difference
   between strategies.
6. Core-count sensitivity: the same cold lookups with 2 and 4 cores; if the XPath/UiSelector ratio
   holds, the difference is the algorithm, not CPU contention.

Limit noted in the report: M1 Pro cores are faster than most phones' cores, so absolute ms are lower
than on a phone; the ratio is what transfers. A real phone (stage 6) confirms it.

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

Elements use realistic shop names (as on iOS); one deep branch.

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

Background load (after the spike): only views visible on screen are in the tree, so every group is a
full-screen layer stacked under Checkout, as screens added to a back stack are — G2 two screens (+400),
G3 a recommendations screen (+500), G4 three kept-alive tabs and an open drawer (+1000). Checkout is the
top layer, so it is the **last** subtree in the page source: UiSelector, which stops at the first match,
walks the whole background before it reaches any target. That is the realistic Android order and the
unfavourable one for UiSelector.

As built in stage 2 (`ScaleActivity`, `bench/make-scale.js`, `bench/count.js`):
- page source counts 100 / 497 / 1000 / 1989 elements; targets at depth 8 (top), 39 (deep), 6 (end);
  the depth screen shows markers down to level 60 (tree depth 70 = `snapshotMaxDepth`);
- exact pixel sizes, single-line text, content padded by system-bar insets;
- benchmark build = `assembleRelease` (not debuggable, signed with the debug key): the debug build
  built the 2000-element screen in up to 15 s and answered first accessibility queries slowly;
- all 30 cases valid at 100 and 2000 elements: every strategy returns the same single element.

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

Found on 2026-10-18: Android Studio with SDK in `~/Library/Android/sdk` — platform `android-37.0`,
build-tools 36.0.0, emulator 37.2.12, platform-tools 37.0.1, JBR OpenJDK 25.0.3. One AVD
`Medium_Phone` (API 37.0, **Google Play** image, arm64, 1080×2400; created with `hw.cpu.ncore=1` and
2 GB RAM, changed to 4 cores / 4 GB, original config kept as `config.ini.bak-2026-10-18`).
`ANDROID_HOME`, `JAVA_HOME` (Studio's JBR), `platform-tools` and `emulator` added to `PATH` in `~/.zshrc`.
No AOSP (`default`) image exists for API 37; the newest is API 36 (773 MB). Pinned versions:
`docs/environment.md`.

## Report

Savings always in % and in ms; clear table headers; no obvious comments; a "Limits of these
measurements" section.

## Decisions (2026-10-18)

1. View app only (Kotlin, no AndroidX). Compose — possible later phase.
2. No Android locator corpus: the draft shape table above is used.
3. Default UiAutomator2 settings only; background load made of nodes visible to the user. No
   `allowInvisibleElements` variant.
4. Sizes 100/500/1000/2000, as on iOS.
5. Emulator image: the installed Google Play API 37.0 image (`Medium_Phone`, 4 cores, 4 GB). If the
   stage 1 checks show background noise from Play services, switch to AOSP API 36 (773 MB, new AVD
   with consent).
6. No real phone for now: emulator first; stage 6 runs when the user has an Android phone, so the
   report has both. Local runs (any Appium / OS version) are preferred over device clouds with fixed,
   often outdated Appium–OS pairings.
7. Downloads over the hotspot as is.
8. All 30 cases keep 3 positions (top / deep / end). `id` and `accessibility id` are timed on the
   cases where they apply (shapes 1 and 7), which also cover the 3 positions.
9. No settings-variants side table.
10. Kotlin.
11. After the spike (`docs/spike.md`, "Consequences"): background load = overlapping on-screen layers,
    insets-padded content; one untimed lookup after each app start; wait for guest load < 1.5; never on
    battery / Low Power Mode; 3 passes, median; 4 cores only.
