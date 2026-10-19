#!/usr/bin/env node
// Stage 3: lookup time of XPath vs UiSelector (and `id` / `accessibility id` where a case selects by
// exact resource-id / content-desc) as the screen grows (bench/scale-cases.json, made by make-scale.js).
// Needs the Appium server (`npm run appium`), the emulator and the release build installed
// (`cd app && ./gradlew installRelease`).
//
//   node bench/scale.js                      all loads → results/results-scale-emulator.json; saved after every load
//   node bench/scale.js --out f.json         another file (relative to results/)
//   node bench/scale.js --resume             skip the loads already in the output file
//   node bench/scale.js --loads 100,2000     some loads only
//   node bench/scale.js --resume --redo --loads 100   run these loads again, replacing them in the output file
//   node bench/scale.js --count [100,2000]   element count, max depth, target depths and page-source time (3×) per load
//   node bench/scale.js --deep               the depth check on the depth screen → results/results-scale-deep-emulator.json
//   node bench/scale.js --allow-debug        run on a debuggable build (its timings are not comparable)
//
// Per load: refuse to start on battery or in Low Power Mode, wait until the guest's load average is
// below 1.5, start the app, check that every strategy of a case finds the same single element (a case
// that fails is INVALID and not timed), then PASSES passes. Each pass starts the app afresh and does
// one untimed lookup of an unrelated element (as a test waits for its first element) before the timed
// ones. Every timed lookup is one findElement; the strategy order rotates per case and per pass. The
// result per case and strategy is the median of the passes. Page source is timed once per pass.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { Session, launch, shape, host, device, adb, median, r1, sleep, PKG, APPIUM } from './lib/wd.js';

const LOADS = [100, 500, 1000, 2000];
const PASSES = Number(process.env.PASSES || 3);
const LOAD_MAX = 1.5, LOAD_REDO = 3, REDO = 2;
const MARK = { top: 'nav_help', deep: 'review_helpful', end: 'checkout_placeOrder' };
// untimed lookup after each app start: the app's content frame, not a target, found without a tree walk
const READY = ['id', 'android:id/content'];
const STRATEGIES = { xpath: 'xpath', uiautomator: '-android uiautomator', id: 'id', accessibilityId: 'accessibility id' };
const valueOf = { xpath: k => k.xpath, uiautomator: k => k.uiautomator, id: k => k.byId, accessibilityId: k => k.accessibilityId };

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 && !args[i + 1]?.startsWith('--') ? args[i + 1] : undefined; };
const RESULTS = new URL('../results/', import.meta.url);
const readJson = u => JSON.parse(fs.readFileSync(u, 'utf8'));
const save = (u, doc) => { fs.mkdirSync(RESULTS, { recursive: true }); fs.writeFileSync(u, JSON.stringify(doc, null, 1) + '\n'); };
const r2 = v => Math.round(v * 100) / 100;
const geomean = a => Math.exp(a.reduce((s, v) => s + Math.log(v), 0) / a.length);
const today = () => new Date().toISOString().slice(0, 10);
const guestLoad = () => Number(adb('shell', 'cat', '/proc/loadavg').split(' ')[0]);
// The emulator process on the host: its command line, and its CPU time in seconds. macOS can deprioritise
// it (e.g. while its window is hidden), which slows every lookup with a quiet guest; host CPU per pass shows it.
const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const QEMU = sh('pgrep', ['-f', 'qemu-system-aarch64']).split('\n')[0] || null;
const qemuArgs = () => QEMU ? sh('ps', ['-o', 'args=', '-p', QEMU]).replace(/^.*?qemu-system-aarch64\s*/, '') : null;
const qemuCpuS = () => { const t = QEMU && sh('ps', ['-o', 'time=', '-p', QEMU]); return t ? t.split(':').reduce((a, v) => a * 60 + Number(v), 0) : null; };

function powerOk() {
  const h = host();
  if (h.power !== 'AC' || h.lowPowerMode !== false)
    throw new Error(`not starting: power ${h.power}, Low Power Mode ${h.lowPowerMode} — plug in and turn Low Power Mode off`);
  return h;
}

async function waitGuest(timeoutMs = 15 * 60000) {
  const t0 = Date.now(); let l = guestLoad();
  while (l >= LOAD_MAX) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`guest load average still ${l} after ${timeoutMs / 60000} min`);
    process.stdout.write(`  waiting for the guest: load ${l}\r`);
    await sleep(10000); l = guestLoad();
  }
  if (Date.now() - t0 > 1000) process.stdout.write('\n');
  return { load1: l, waitedS: Math.round((Date.now() - t0) / 1000) };
}

function build() {
  const flags = adb('shell', 'dumpsys', 'package', PKG).match(/pkgFlags=\[([^\]]*)\]/)?.[1] || '';
  const ver = adb('shell', 'dumpsys', 'package', PKG).match(/versionName=(\S+)/)?.[1] || null;
  const debuggable = /DEBUGGABLE/.test(flags);
  if (debuggable && !args.includes('--allow-debug'))
    throw new Error('the installed app is a debuggable build; install the release build (cd app && ./gradlew installRelease) or pass --allow-debug');
  return { type: debuggable ? 'debug' : 'release', versionName: ver };
}

async function env(s) {
  const pkgVersion = p => readJson(new URL(`../node_modules/${p}/package.json`, import.meta.url)).version;
  return {
    appium: pkgVersion('appium'), uiautomator2Driver: pkgVersion('appium-uiautomator2-driver'),
    uiautomator2Server: adb('shell', 'dumpsys', 'package', 'io.appium.uiautomator2.server').match(/versionName=(\S+)/)?.[1] ?? null, device: device(), emulator: qemuArgs(), app: build(), settings: await s.settings(),
  };
}

// depth of the first element whose attributes match (hierarchy children = depth 1)
function depthOf(src, re) {
  let depth = 0;
  for (const m of src.matchAll(/<(\/?)([\w.$]+)([^>]*?)(\/?)>/g)) {
    if (m[2] === 'hierarchy' || m[2] === '?xml') continue;
    if (m[1]) { depth--; continue; }
    depth++;
    if (re.test(m[3])) return depth;
    if (m[4]) depth--;
  }
  return null;
}
const targetDepths = src => Object.fromEntries(Object.entries(MARK).map(([p, id]) => [p, depthOf(src, new RegExp(`resource-id="[^"]*:id/${id}"`))]));

const strategiesOf = k => Object.keys(STRATEGIES).filter(st => valueOf[st](k));

// Every strategy must find exactly one element, and all the same one (attribute fingerprint); for a
// grouped position (shape 8) the XPath without the position must find exactly `copies.count`.
// UiSelector uniqueness is checked with findElement + `.instance(1)`, not findElements: with
// classNameMatches, findElements in UiAutomator2 server 10.6.6 drops matches (`.*Button.*` finds 3 of
// the screen's buttons, combined with textContains none), while findElement finds the element.
async function validate(s, k) {
  const hits = {};
  for (const st of strategiesOf(k)) {
    const v = valueOf[st](k);
    let id;
    if (st === 'uiautomator') {
      const f = await s.find(STRATEGIES[st], v);
      if (f.error) return { ok: false, why: `${st}: ${f.error}` };
      if (!/\.instance\(\d+\)$/.test(v) && !(await s.find(STRATEGIES[st], `${v}.instance(1)`)).error) return { ok: false, why: `${st} finds more than 1 element` };
      id = f.id;
    } else {
      let ids;
      try { ids = await s.findAll(STRATEGIES[st], v); } catch (e) { return { ok: false, why: `${st}: ${e.message.split('\n')[0].slice(0, 160)}` }; }
      if (ids.length !== 1) return { ok: false, why: `${st} finds ${ids.length} elements, expected 1` };
      id = ids[0];
    }
    hits[st] = await s.fingerprint(id);
  }
  if (k.copies) {
    const n = (await s.findAll('xpath', k.copies.xpath)).length;
    if (n !== k.copies.count) return { ok: false, why: `XPath without the position finds ${n}, expected ${k.copies.count}` };
  }
  const fp = Object.values(hits);
  return fp.every(f => f === fp[0]) ? { ok: true, hit: fp[0] } : { ok: false, why: 'different elements', hits };
}

// one fresh app start + the untimed ready lookup; returns what the start cost
async function start(s, extras) {
  const l = await launch(extras, '.ScaleActivity');
  const ready = await s.find(...READY);
  if (ready.error) throw new Error(`ready lookup failed: ${ready.error}`);
  return { ...l, readyMs: r1(ready.ms) };
}

function summarize(rows) {
  const vs = (st, q = rows) => {
    const t = q.filter(r => r.median?.xpath && r.median?.[st]);
    if (!t.length) return null;
    const x = t.reduce((a, r) => a + r.median.xpath, 0), o = t.reduce((a, r) => a + r.median[st], 0);
    return { cases: t.length, xpathTotalMs: r1(x), totalMs: r1(o), savingMs: r1(x - o), savingPct: r1(100 * (x - o) / x),
      speedupGeomean: r2(geomean(t.map(r => r.median.xpath / r.median[st]))), faster: t.filter(r => r.median[st] < r.median.xpath).length };
  };
  const out = {};
  for (const st of ['uiautomator', 'id', 'accessibilityId']) {
    const all = vs(st);
    if (!all) continue;
    out[st] = { ...all, byPosition: Object.fromEntries(['top', 'deep', 'end'].map(p => [p, vs(st, rows.filter(r => r.position === p))])) };
  }
  return out;
}

async function runLoad(s, load, cases) {
  const hostAtStart = powerOk();
  const guest = await waitGuest();
  const first = await start(s, { load });
  const { src, ms: sourceMs } = await s.source();
  const tree = { ...shape(src), targetDepths: targetDepths(src) };
  console.log(`load ${load}: ${tree.elements} elements, max depth ${tree.maxDepth}, target depths ${JSON.stringify(tree.targetDepths)}, guest load ${guest.load1} (waited ${guest.waitedS} s)`);
  const rows = [];
  for (const k of cases) {
    const v = await validate(s, k);
    if (!v.ok) console.log(`  INVALID ${k.id}: ${v.why}`);
    rows.push({ id: k.id, shape: k.shape, position: k.position, locators: Object.fromEntries(strategiesOf(k).map(st => [st, valueOf[st](k)])),
      valid: v.ok, why: v.ok ? undefined : v.why, hit: v.hit, ms: Object.fromEntries(strategiesOf(k).map(st => [st, []])) });
  }
  const valid = rows.filter(r => r.valid);
  console.log(`  validation: ${valid.length}/${rows.length} cases valid`);
  // A pass after which the guest's load average is above LOAD_REDO had background work (e.g. Play
  // services) running during it; it is discarded and run again, up to REDO times.
  const passes = [], discarded = [];
  for (let pass = 0; pass < PASSES; pass++) {
    powerOk();
    const wait = await waitGuest();
    const p = { guestLoadBefore: wait.load1, waitedS: wait.waitedS, ...(await start(s, { load })), sourceMs: null, errors: 0 };
    const got = valid.map(() => ({})), cpu0 = qemuCpuS(), wall0 = performance.now();
    for (const [i, r] of valid.entries()) {
      const sts = Object.keys(r.ms), rot = (i + pass) % sts.length;
      for (const st of [...sts.slice(rot), ...sts.slice(0, rot)]) {
        const f = await s.find(STRATEGIES[st], r.locators[st]);
        got[i][st] = f.error ? null : r1(f.ms);
        if (f.error) { p.errors++; console.log(`  pass ${pass + 1} ${r.id} ${st}: ${f.error}`); }
      }
    }
    const cpu1 = qemuCpuS();
    p.hostQemuCpuPct = cpu0 != null && cpu1 != null ? r1(100 * (cpu1 - cpu0) / ((performance.now() - wall0) / 1000)) : null;
    p.sourceMs = r1((await s.source()).ms);
    p.guestLoadAfter = guestLoad();
    const line = `host qemu CPU ${p.hostQemuCpuPct} %, ready lookup ${p.readyMs} ms, page source ${p.sourceMs} ms, guest load ${p.guestLoadBefore} → ${p.guestLoadAfter}`;
    if (p.guestLoadAfter > LOAD_REDO && discarded.length < REDO) {
      discarded.push({ ...p, ms: Object.fromEntries(valid.map((r, i) => [r.id, got[i]])) });
      console.log(`  pass ${pass + 1}/${PASSES} discarded (guest load above ${LOAD_REDO}): ${line}`);
      pass--; continue;
    }
    valid.forEach((r, i) => { for (const st of Object.keys(r.ms)) r.ms[st].push(got[i][st]); });
    passes.push(p);
    console.log(`  pass ${pass + 1}/${PASSES}: ${line}`);
  }
  for (const r of valid) {
    r.median = Object.fromEntries(Object.entries(r.ms).map(([st, a]) => [st, a.filter(v => v != null)]).filter(([, a]) => a.length).map(([st, a]) => [st, r1(median(a))]));
  }
  const summary = summarize(rows);
  for (const [st, v] of Object.entries(summary))
    console.log(`  ${st} vs XPath (${v.cases} cases): ${v.totalMs} vs ${v.xpathTotalMs} ms, saving ${v.savingMs} ms (${v.savingPct} %), ×${v.speedupGeomean} geomean, faster ${v.faster}/${v.cases}`);
  return { load, host: hostAtStart, guest, firstStart: first, firstSourceMs: r1(sourceMs), ...tree, passes, discardedPasses: discarded,
    sourceMedianMs: r1(median(passes.map(p => p.sourceMs))), summary, cases: rows };
}

async function count(s, loads) {
  for (const load of loads) {
    powerOk();
    const l = await start(s, { load });
    const t = []; let src;
    for (let i = 0; i < 3; i++) { const r = await s.source(); t.push(r1(r.ms)); src = r.src; }
    const tree = shape(src), off = r1(100 * (tree.elements - load) / load);
    console.log(`load ${load}: ${tree.elements} elements (${off > 0 ? '+' : ''}${off} %), max depth ${tree.maxDepth}, target depths ${JSON.stringify(targetDepths(src))}, page source ${t.join(' / ')} ms, start ${JSON.stringify(l)}`);
  }
}

// the depth check: what XPath and UiSelector return for markers around snapshotMaxDepth
async function deep(s, cases) {
  const out = new URL(opt('--out') || 'results-scale-deep-emulator.json', RESULTS);
  powerOk();
  const guest = await waitGuest();
  await start(s, { screen: 'deep' });
  const { src } = await s.source();
  const tree = shape(src);
  console.log(`depth screen: ${tree.elements} elements, max depth in page source ${tree.maxDepth}`);
  const rows = [];
  for (const k of cases) {
    const row = { id: k.id, marker: k.marker, depthInSource: depthOf(src, new RegExp(`text="depth\\.marker\\.${k.marker}"`)) };
    for (const st of ['xpath', 'uiautomator']) {
      const f = await s.find(STRATEGIES[st], k[st]);
      row[st] = f.error ? { ms: r1(f.ms), error: f.error } : { ms: r1(f.ms), found: true };
    }
    rows.push(row);
    const show = r => r.error ? 'not found' : 'found';
    console.log(`  marker ${String(k.marker).padStart(3)} (source depth ${row.depthInSource ?? '—'}): XPath ${show(row.xpath)} [${row.xpath.ms} ms], UiSelector ${show(row.uiautomator)} [${row.uiautomator.ms} ms]`);
  }
  save(out, { date: today(), env: await env(s), host: host(), guest, elements: tree.elements, maxDepth: tree.maxDepth, cases: rows });
}

async function main() {
  // keeps the Mac (and so the emulator) awake for as long as this process runs
  if (process.platform === 'darwin') spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref();
  await fetch(`${APPIUM}/status`).catch(() => { throw new Error(`Appium is not running at ${APPIUM} (npm run appium)`); });
  if (!/\tdevice$/m.test(adb('devices'))) throw new Error('no device: start the emulator');
  build();
  powerOk();
  const { cases, deep: deepCases } = readJson(new URL('scale-cases.json', import.meta.url));
  const loads = (opt('--loads') || opt('--count') || '').split(',').filter(Boolean).map(Number);
  await waitGuest(); // a busy guest starts the UiAutomator2 server slowly
  const s = await Session.open({ 'appium:uiautomator2ServerLaunchTimeout': 120000 });
  try {
    if (args.includes('--count')) return await count(s, loads.length ? loads : LOADS);
    if (args.includes('--deep')) return await deep(s, deepCases);
    const out = new URL(opt('--out') || 'results-scale-emulator.json', RESULTS);
    const doc = args.includes('--resume') && fs.existsSync(out) ? readJson(out) : {
      method: `${PASSES} passes, median; each pass a fresh app start + one untimed ready lookup, then one findElement per case and strategy, strategy order rotating per case and pass`,
      env: await env(s), loads: [] };
    if (args.includes('--redo')) { doc.loads = doc.loads.filter(r => !loads.includes(r.load)); doc.env = await env(s); }
    const t0 = Date.now();
    for (const load of (loads.length ? loads : LOADS).filter(l => !doc.loads.some(r => r.load === l))) {
      doc.loads.push(await runLoad(s, load, cases));
      doc.loads.sort((a, b) => a.load - b.load);
      doc.date = today(); doc.seconds = (doc.seconds || 0) + Math.round((Date.now() - t0) / 1000);
      save(out, doc);
    }
    console.log('\nload  elements  source ms  XPath total  UiSelector total  saving          geomean  faster');
    for (const r of doc.loads) {
      const u = r.summary.uiautomator;
      console.log(`${String(r.load).padEnd(5)} ${String(r.elements).padStart(8)} ${String(r.sourceMedianMs).padStart(10)} ${String(u?.xpathTotalMs).padStart(12)} ${String(u?.totalMs).padStart(17)}  ${`${u?.savingMs} ms, ${u?.savingPct} %`.padEnd(15)} ×${u?.speedupGeomean}    ${u?.faster}/${u?.cases}`);
    }
  } finally { await s.close(); }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
