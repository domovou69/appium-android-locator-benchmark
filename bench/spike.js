#!/usr/bin/env node
// Stage 1 spike: what the UiAutomator2 tree contains with default settings, the depth limit, and
// whether the emulator measures lookups fairly (transport cost, first-call cost, accessibility cache,
// spread on fresh targets, CPU load). Needs the Appium server (`npm run appium`), the emulator and
// the app installed (`cd app && ./gradlew installDebug`).
//
//   node bench/spike.js                          all sections → results/spike-emulator.json
//   node bench/spike.js --only cache,stability   some sections (first, baseline, content, depth, cache, stability)
//   node bench/spike.js --tag cores2             label the run and write results/spike-emulator-cores2.json
import fs from 'node:fs';
import { Session, launch, shape, host, device, sampler, spread, r1, PKG } from './lib/wd.js';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('--only')?.split(',');
const tag = opt('--tag');
const out = new URL(`../results/spike-emulator${tag ? '-' + tag : ''}.json`, import.meta.url);
const UI = '-android uiautomator';
const doc = { date: new Date().toISOString().slice(0, 10), tag, host: host(), device: device() };
const save = () => { fs.mkdirSync(new URL('../results/', import.meta.url), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 1) + '\n'); };
const want = s => !only || only.includes(s);
const log = (...a) => console.log(...a);

// cell (layer, row, col) of the spike screen, by its three locators
const cell = (layer, row, col, n) => {
  const i = layer * 200 + row * 10 + col, text = `Item ${layer}.${row}.${col}`;
  const idx = i - Math.max(0, n - 100);
  return {
    text, xpath: `//android.widget.TextView[@text="${text}"]`,
    ui: `new UiSelector().className("android.widget.TextView").text("${text}")`,
    id: idx >= 0 ? `${PKG}:id/t${String(idx).padStart(3, '0')}` : null,
  };
};
const lastRow = n => ({ layer: Math.floor((n - 1) / 200), row: Math.floor(((n - 1) % 200) / 10) });
const loc = (c, strategy) => strategy === 'xpath' ? ['xpath', c.xpath] : strategy === 'ui' ? [UI, c.ui] : ['id', c.id];

const s = await Session.open();
try {
  doc.versions = { uiautomator2Server: s.caps.uiautomator2ServerVersion ?? null, platformVersion: s.caps.platformVersion, deviceApiLevel: s.caps.deviceApiLevel };
  doc.settings = await s.settings();
  log(`host ${JSON.stringify(doc.host)}\ndevice ${JSON.stringify(doc.device)}`);

  // First lookup in a fresh session vs the next ones, and after an app restart within the session.
  if (want('first')) {
    const r = {};
    r.launch = await launch({ mode: 'stack', n: 100 });
    const c = (row, col) => cell(0, row, col, 100);
    r.sessionFirstXpath = r1((await s.find('xpath', c(9, 0).xpath)).ms);
    r.thenXpath = r1((await s.find('xpath', c(9, 1).xpath)).ms);
    r.thenUi = r1((await s.find(UI, c(9, 2).ui)).ms);
    await launch({ mode: 'stack', n: 100 });
    r.afterRestartFirstUi = r1((await s.find(UI, c(8, 0).ui)).ms);
    r.afterRestartThenXpath = r1((await s.find('xpath', c(8, 1).xpath)).ms);
    r.afterRestartThenUi = r1((await s.find(UI, c(8, 2).ui)).ms);
    doc.first = r; save(); log('first', JSON.stringify(r));
  }

  // Fixed cost of a round trip, so ms savings are read against it.
  if (want('baseline')) {
    await launch({ mode: 'stack', n: 100 });
    const t = async f => { const a = []; for (let i = 0; i < 10; i++) { const t0 = performance.now(); await f(); a.push(performance.now() - t0); } return spread(a); };
    const el = (await s.find(UI, cell(0, 0, 0, 100).ui)).id;
    doc.baseline = {
      appiumStatus: await t(() => fetch('http://127.0.0.1:4723/status').then(r => r.json())),
      getAttribute: await t(() => s.attr(el, 'text')),
      uiMiss: await t(() => s.find(UI, 'new UiSelector().resourceId("nope")')),
      xpathMiss: await t(() => s.find('xpath', '//*[@resource-id="nope"]')),
    };
    save(); log('baseline', JSON.stringify(doc.baseline));
  }

  // What ends up in the tree (default settings) for each way of adding background load, n = 2000 cells.
  if (want('content')) {
    doc.content = [];
    for (const mode of ['stack', 'offscreen', 'invisible', 'scroll']) {
      const l = await launch({ mode, n: 2000 });
      const times = []; let src;
      for (let i = 0; i < 3; i++) { const r = await s.source(); times.push(r.ms); src = r.src; }
      const cells = (src.match(/text="Item \d+\.\d+\.\d+"/g) || []).length;
      const row = { mode, launch: l, ...shape(src), cellsInTree: cells, sourceMs: spread(times) };
      doc.content.push(row); save(); log('content', JSON.stringify(row));
    }
  }

  // Depth limit: markers every 5 levels of a 100-level chain; which ones each strategy and the source see.
  if (want('depth')) {
    await launch({ mode: 'deep', depth: 100 });
    const { src, ms } = await s.source();
    const r = { ...shape(src), sourceMs: r1(ms), markers: [] };
    for (let k = 5; k <= 100; k += 5) {
      const x = await s.find('xpath', `//*[@text="Depth ${k}"]`), u = await s.find(UI, `new UiSelector().text("Depth ${k}")`);
      r.markers.push({ level: k, inSource: src.includes(`text="Depth ${k}"`), xpath: !x.error, ui: !u.error, xpathMs: r1(x.ms), uiMs: r1(u.ms) });
    }
    const last = (f) => Math.max(0, ...r.markers.filter(f).map(m => m.level));
    r.deepestFound = { source: last(m => m.inSource), xpath: last(m => m.xpath), ui: last(m => m.ui) };
    doc.depth = r; save(); log('depth', JSON.stringify({ elements: r.elements, maxDepth: r.maxDepth, deepestFound: r.deepestFound }));
  }

  // Accessibility cache: the same target 5× in a row, and a second strategy right after the first.
  if (want('cache')) {
    const n = 2000, { layer, row } = lastRow(n), r = { repeats: {}, cross: [] };
    for (const [k, strategy] of [[0, 'xpath'], [1, 'ui'], [2, 'id']]) {
      await launch({ mode: 'stack', n });
      const c = cell(layer, row - k, 0, n), a = [];
      for (let i = 0; i < 5; i++) a.push(r1((await s.find(...loc(c, strategy))).ms));
      r.repeats[strategy] = a;
    }
    for (const [k, order] of [[3, ['xpath', 'ui', 'xpath']], [4, ['ui', 'xpath', 'ui']], [5, ['xpath', 'ui', 'xpath']], [6, ['ui', 'xpath', 'ui']]]) {
      await launch({ mode: 'stack', n });
      const c = cell(layer, row - k, 5, n);
      r.cross.push({ order, ms: await order.reduce(async (acc, st) => [...await acc, r1((await s.find(...loc(c, st))).ms)], []) });
    }
    doc.cache = r; save(); log('cache', JSON.stringify(r));
  }

  // Spread on fresh targets: per strategy, a fresh app, 10 different targets of the last rows, each once.
  if (want('stability')) {
    doc.stability = [];
    const mon = sampler(2000);
    for (const n of [100, 2000]) {
      const { layer, row } = lastRow(n), res = { n, ms: { xpath: [], ui: [], id: [] }, launches: [] };
      for (const [round, order] of [[0, ['xpath', 'ui', 'id']], [1, ['id', 'ui', 'xpath']]]) {
        for (const strategy of order) {
          res.launches.push(await launch({ mode: 'stack', n }));
          for (let col = 0; col < 10; col++) {
            const f = await s.find(...loc(cell(layer, row - round, col, n), strategy));
            res.ms[strategy].push(f.error ? null : r1(f.ms));
            if (f.error) log(`  ${n} ${strategy} ${f.error}`);
          }
        }
      }
      // identity: all three strategies return the same element (attribute fingerprint)
      const c = cell(layer, row, 3, n), ids = {};
      for (const st of ['xpath', 'ui', 'id']) { const f = await s.find(...loc(c, st)); ids[st] = f.error ? f.error : await s.fingerprint(f.id); }
      res.sameElement = new Set(Object.values(ids)).size === 1;
      res.spread = Object.fromEntries(Object.entries(res.ms).map(([k, a]) => [k, spread(a.filter(v => v != null))]));
      doc.stability.push(res); save(); log('stability', n, JSON.stringify(res.spread), 'same element:', res.sameElement);
    }
    const samples = await mon.stop();
    const busy = samples.flatMap(x => x.coreBusy);
    doc.load = { samples, coreBusy: spread(busy), maxCoreBusy: Math.max(...busy), load1: spread(samples.map(x => x.load1)), qemuHostCpu: spread(samples.map(x => x.qemuHostCpu).filter(v => v != null)) };
    save(); log('load', JSON.stringify({ coreBusy: doc.load.coreBusy, load1: doc.load.load1, qemuHostCpu: doc.load.qemuHostCpu }));
  }
} finally { await s.close(); }
doc.hostAtEnd = host(); save();
log(`saved ${out.pathname}`);
