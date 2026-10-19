# Environment

Recorded 2026-10-18 (stage 0). Every result file also records the versions it ran with.

## Host

| Item       | Value                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Machine    | Apple M1 Pro (8 performance + 2 efficiency cores), 16 GB                                                                 |
| macOS      | 26.6.2                                                                                                                   |
| Node / npm | 24.21.0 / 12.2.0                                                                                                         |
| JDK        | OpenJDK 25.0.3 bundled with Android Studio (`JAVA_HOME` = `/Applications/Android Studio.app/Contents/jbr/Contents/Home`) |

## Android SDK (`~/Library/Android/sdk`, installed by Android Studio)

| Package                | Version                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| Platform               | `android-37.0` (Android 17), revision 2                                  |
| Build-tools            | 36.0.0                                                                   |
| Platform-tools (`adb`) | 37.0.1                                                                   |
| Emulator               | 37.2.12 (build 16428233)                                                 |
| System image           | `system-images;android-37.0;google_apis_playstore;arm64-v8a`, revision 6 |

Shell setup (`~/.zshrc`):

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$JAVA_HOME/bin:$PATH"
```

## AVD

Benchmark AVD since 2026-10-19 (stage 4): **`AOSP_API_36`** (directory `~/.android/avd/AOSP_API_36.avd`).

| Setting   | Value                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| Image     | `system-images;android-36;default;arm64-v8a`, revision 2 (AOSP, no Google services), 811 MB |
| Build     | `Android/sdk_phone64_arm64/emu64a:16/BE2A.250530.026.D1/13818094:userdebug/test-keys`        |
| Screen    | 1080×2400, 420 dpi                                                                           |
| CPU cores | 4 (`hw.cpu.ncore`)                                                                           |
| RAM       | 4 GB (`hw.ramSize`)                                                                          |

The SDK has no `cmdline-tools`, so the image was downloaded from
`https://dl.google.com/android/repository/sys-img/android/arm64-v8a-36_r02.zip` (SHA-1
`62ad6714df790f89c8a8ad32552ffe20bb16fe87`, from `sys-img2-4.xml`), unpacked to
`$ANDROID_HOME/system-images/android-36/default/`, and the AVD config copied from `Medium_Phone` with
the image and tags changed. Start it **without a window** for benchmark runs:

```sh
emulator -avd AOSP_API_36 -no-window -no-snapshot-load -no-boot-anim -no-audio
```

Why: with a window that is hidden or minimised, macOS deprioritises the emulator, and lookups switch
between ~1 s and ~6 s at 2000 elements with a quiet guest (seen on 2026-10-19). Without a window the
emulator ran at a steady ~125–140 % host CPU in every pass.

The first AVD, **`Medium_Phone_API_37.0`** (Google Play, API 37.0, build
`google/sdk_gphone64_arm64/emu64a:17/CE2A.260420.019/15611780`, same screen, 4 cores / 4 GB; original
config kept as `config.ini.bak-2026-10-18`), is kept. It was dropped for timing: Play services
background work (`artd` optimizing `com.google.android.gms`) raised the guest load average to 5–9 in the
middle of passes. Its run is in `results/results-scale-emulator-play.json`.

## Appium (local devDependencies, exact versions)

| Package                                                             | Version |
| ------------------------------------------------------------------- | ------- |
| `appium`                                                            | 3.8.0   |
| `appium-uiautomator2-driver`                                        | 8.7.0   |
| UiAutomator2 server on the device (`io.appium.uiautomator2.server`) | 10.6.6  |

Appium finds the driver in the project's `node_modules`; nothing is installed globally. Appium's
`postinstall` (auto-install of extensions listed in env vars) is denied in `package.json`
(`allowScripts`). `npm run doctor`: no required fixes; optional bundletool, ffmpeg and GStreamer are
not needed here.

Start: `npm run appium` (port 4723).

## App build (`app/`)

| Item                                  | Version                           |
| ------------------------------------- | --------------------------------- |
| Gradle (wrapper)                      | 9.8.1                             |
| Android Gradle Plugin                 | 9.4.1 (built-in Kotlin)           |
| Kotlin                                | 2.2.10 (AGP's runtime dependency) |
| `compileSdk` / `targetSdk` / `minSdk` | 37 / 37 / 26                      |

No AndroidX, no library dependencies. Benchmark build: `cd app && ./gradlew assembleRelease` (not debuggable, signed with the debug key; `installRelease` installs it). The screen and cases are generated by `node bench/make-scale.js`.

## UiAutomator2 defaults seen in the smoke session

`snapshotMaxDepth=70`, `allowInvisibleElements=false`, `ignoreUnimportantViews=false`,
`waitForIdleTimeout=10000`, `simpleBoundsCalculation=false`, `limitXPathContextScope=true`,
`deferAccessibilityCacheReset=false` (the accessibility cache is reset before lookups by default —
checked in stage 1).

Smoke run (1 session, 1 TextView): session start 18.7 s (installs the server APKs on first run);
first XPath lookup 1390 ms, then UiSelector 60 ms on the same element — a first-call cost to be
separated in stage 1.
