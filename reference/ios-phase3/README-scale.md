## Scale benchmark (Phase 3)

Times XPath against class chain on one screen with 100, 500, 1000 and 2000 elements in the tree (the same 30 targets every time). Results are in the "Lookup time vs. tree size" section of [`../coverage-report.md`](../coverage-report.md).

```sh
node make-scale.js        # LocatorLab/scale.json + scale-cases.json (only after editing make-scale.js); rebuild the app afterwards
node scale.js --count     # elements, max depth and page-source time per size, no lookups
node scale.js --out results-scale-mine.json            # 4 sizes × 30 cases × 3 passes, saved after every size
node scale.js --out results-scale-mine.json --resume   # continue after a failure
node scale.js --deep --out results-scale-deep-mine.json        # depth check (`scale-deep`)
node scale.js --variants 100,2000 --out results-scale-variants-mine.json   # chain vs. [1] vs. useFirstMatch
node make-scale-chart.js results-scale-mine.json results-scale-device-mine.json ../scale-chart-mine.svg   # the chart (simulator run, device run)
```

- On a real device, set `UDID` and `XCODE_ORG_ID` and install the rebuilt LocatorLab as in "Real device" above.
- A full run takes about 35 minutes on the simulator and 50 on an iPhone 13 Pro Max; most of it is the 2000-element size.
- `scale.js` runs `caffeinate` while it works: a sleeping display drops the USB tunnel to the phone.
- Each size records the Mac's power state (`host`). On battery with Low Power Mode, lookups on the simulator were 14–16 % slower on an M1 Pro; the XPath/chain savings were the same.
- Page sources are read without the `visible` attribute (`pageSourceExcludedAttributes`, switched on only around source calls). With it, one page source took 53 s at 1000 elements.
- Before timing, XPath and chain must return the same single element; a case that fails is printed as `INVALID` and not timed. Many `INVALID` at once with `no such element` usually means the USB tunnel dropped: re-run with `--resume`.
