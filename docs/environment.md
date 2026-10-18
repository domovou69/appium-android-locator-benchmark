# Environment

Recorded 2026-10-18 (stage 0). Every result file also records the versions it ran with.

## Host

| Item | Value |
|---|---|
| Machine | Apple M1 Pro (8 performance + 2 efficiency cores), 16 GB |
| macOS | 26.6.2 |
| Node / npm | 24.21.0 / 12.2.0 |
| JDK | OpenJDK 25.0.3 bundled with Android Studio (`JAVA_HOME` = `/Applications/Android Studio.app/Contents/jbr/Contents/Home`) |

## Android SDK (`~/Library/Android/sdk`, installed by Android Studio)

| Package | Version |
|---|---|
| Platform | `android-37.0` (Android 17), revision 2 |
| Build-tools | 36.0.0 |
| Platform-tools (`adb`) | 37.0.1 |
| Emulator | 37.2.12 (build 16428233) |
| System image | `system-images;android-37.0;google_apis_playstore;arm64-v8a`, revision 6 |

Shell setup (`~/.zshrc`):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
```

## AVD

The only AVD used by this project: **`Medium_Phone_API_37.0`** (directory `~/.android/avd/Medium_Phone.avd`).

| Setting | Value |
|---|---|
| Image | Google Play, API 37.0, arm64-v8a |
| Build | `google/sdk_gphone64_arm64/emu64a:17/CE2A.260420.019/15611780` |
| Screen | 1080×2400, 420 dpi |
| CPU cores | 4 (`hw.cpu.ncore`; created with 1) |
| RAM | 4 GB (`hw.ramSize`; created with 2 GB) |

The original config is kept as `config.ini.bak-2026-10-18`. Start:

```sh
emulator -avd Medium_Phone_API_37.0 -no-snapshot-load -no-boot-anim
```

No AOSP (`default`) image exists for API 37; the fallback is `system-images;android-36;default;arm64-v8a`
(773 MB), only if stage 1 shows noise from Play services.

## Appium (local devDependencies, exact versions)

| Package | Version |
|---|---|
| `appium` | 3.8.0 |
| `appium-uiautomator2-driver` | 8.7.0 |
| UiAutomator2 server on the device (`io.appium.uiautomator2.server`) | 10.6.6 |

Appium finds the driver in the project's `node_modules`; nothing is installed globally. Appium's
`postinstall` (auto-install of extensions listed in env vars) is denied in `package.json`
(`allowScripts`). `npm run doctor`: no required fixes; optional bundletool, ffmpeg and GStreamer are
not needed here.

Start: `npm run appium` (port 4723).

## App build (`app/`)

| Item | Version |
|---|---|
| Gradle (wrapper) | 9.8.1 |
| Android Gradle Plugin | 9.4.1 (built-in Kotlin) |
| Kotlin | 2.2.10 (AGP's runtime dependency) |
| `compileSdk` / `targetSdk` / `minSdk` | 37 / 37 / 26 |

No AndroidX, no library dependencies. Build: `cd app && ./gradlew assembleDebug`.

## UiAutomator2 defaults seen in the smoke session

`snapshotMaxDepth=70`, `allowInvisibleElements=false`, `ignoreUnimportantViews=false`,
`waitForIdleTimeout=10000`, `simpleBoundsCalculation=false`, `limitXPathContextScope=true`,
`deferAccessibilityCacheReset=false` (the accessibility cache is reset before lookups by default —
checked in stage 1).

Smoke run (1 session, 1 TextView): session start 18.7 s (installs the server APKs on first run);
first XPath lookup 1390 ms, then UiSelector 60 ms on the same element — a first-call cost to be
separated in stage 1.
