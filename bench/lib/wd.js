// Minimal WebDriver client for the Appium server (plain HTTP, no client library), host and device state.
import { execFileSync, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

export const APPIUM = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
// Android Studio's default SDK location when ANDROID_HOME is not set (e.g. a non-login shell)
const SDK = process.env.ANDROID_HOME || [`${homedir()}/Library/Android/sdk`].find(existsSync);
export const ADB = SDK ? `${SDK}/platform-tools/adb` : 'adb';
export const PKG = 'io.github.domovou69.scalelab';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export const ms = t0 => performance.now() - t0;
export const r1 = v => Math.round(v * 10) / 10;
export const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const spread = a => a.length ? { min: r1(Math.min(...a)), median: r1(median(a)), max: r1(Math.max(...a)), n: a.length } : null;
export const sleep = t => new Promise(r => setTimeout(r, t));

export async function wd(method, path, body) {
  const r = await fetch(APPIUM + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value && j.value.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
}

export class Session {
  static async open(caps = {}) {
    const v = await wd('POST', '/session', { capabilities: { alwaysMatch: {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:autoLaunch': false,
      'appium:noReset': true, 'appium:newCommandTimeout': 1800, ...caps } } });
    const s = new Session(); s.id = v.sessionId; s.caps = v.capabilities; return s;
  }
  url(p) { return `/session/${this.id}${p}`; }
  // one timed findElement; never throws
  async find(using, value) {
    const t0 = performance.now();
    try { const e = await wd('POST', this.url('/element'), { using, value }); return { ms: ms(t0), id: e[ELEMENT] }; }
    catch (e) { return { ms: ms(t0), error: e.message.split('\n')[0].slice(0, 200) }; }
  }
  async findAll(using, value) { return (await wd('POST', this.url('/elements'), { using, value })).map(e => e[ELEMENT]); }
  async source() { const t0 = performance.now(); const src = await wd('GET', this.url('/source')); return { src, ms: ms(t0) }; }
  attr(id, name) { return wd('GET', this.url(`/element/${id}/attribute/${name}`)); }
  // an empty attribute comes back as the string "null" for XPath hits and as "" for UiSelector hits
  async fingerprint(id) { return (await Promise.all(['class', 'resource-id', 'text', 'content-desc', 'bounds'].map(a => this.attr(id, a)))).map(v => v == null || v === 'null' ? '' : v).join('|'); }
  settings() { return wd('GET', this.url('/appium/settings')); }
  close() { return wd('DELETE', this.url('')).catch(() => {}); }
}

export const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const adbAsync = (...a) => new Promise(r => execFile(ADB, a, { encoding: 'utf8' }, (e, out) => r(e ? '' : out)));

// Force-stop and start the app in a mode; ready when the app logs its first draw, plus a quiet second.
// The tree is not touched before the first timed lookup (no page source, no settle loop).
export async function launch(extras = {}, activity = '.MainActivity') {
  adb('logcat', '-c');
  const ex = Object.entries(extras).flatMap(([k, v]) => typeof v === 'number' ? ['--ei', k, String(v)] : ['--es', k, v]);
  adb('shell', 'am', 'start', '-S', '-n', `${PKG}/${activity}`, ...ex);
  const t0 = Date.now();
  for (;;) {
    const m = adb('logcat', '-d', '-s', 'ScaleLab:I').match(/built (\d+) ms, first draw (\d+) ms/);
    if (m) {
      await sleep(1000);
      // a system dialog on top (e.g. "isn't responding" after a slow start) would become the tree
      const focus = adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=.*/)?.[0] || '';
      if (!focus.includes(`${PKG}/`)) throw new Error(`app not in focus after launch: ${focus}`);
      return { buildMs: Number(m[1]), firstDrawMs: Number(m[2]) };
    }
    if (Date.now() - t0 > 120000) throw new Error(`app did not draw: ${JSON.stringify(extras)}`);
    await sleep(300);
  }
}

// element count and max depth of a UiAutomator2 page source (<hierarchy> = depth 0)
export function shape(src) {
  let depth = 0, max = 0, count = 0;
  for (const m of src.matchAll(/<(\/?)([\w.$]+)([^>]*?)(\/?)>/g)) {
    if (m[2] === 'hierarchy' || m[2] === '?xml') continue;
    if (m[1]) { depth--; continue; }
    depth++; count++; max = Math.max(max, depth);
    if (m[4]) depth--;
  }
  return { elements: count, maxDepth: max };
}

export function host() {
  const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8' }).trim(); } catch { return null; } };
  const batt = sh('pmset', ['-g', 'batt']) || '', lpm = (sh('pmset', ['-g']) || '').match(/lowpowermode\s+(\d)/);
  return { cpu: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), memoryGB: Math.round(Number(sh('sysctl', ['-n', 'hw.memsize'])) / 2 ** 30),
    macOS: sh('sw_vers', ['-productVersion']), power: /AC Power/.test(batt) ? 'AC' : /Battery Power/.test(batt) ? 'battery' : null,
    lowPowerMode: lpm ? lpm[1] === '1' : null };
}

export function device() {
  const p = k => adb('shell', 'getprop', k);
  return { model: p('ro.product.model'), android: p('ro.build.version.release'), sdk: p('ro.build.version.sdk'),
    fingerprint: p('ro.build.fingerprint'), cores: Number(adb('shell', 'nproc')), avd: p('ro.boot.qemu.avd_name') || null };
}

// Samples guest per-core busy % (/proc/stat), load average and the host CPU of qemu every `everyMs`.
export function sampler(everyMs = 2000) {
  const samples = []; let prev = null, on = true;
  const qemu = (() => { try { return execFileSync('pgrep', ['-f', 'qemu-system-aarch64'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch { return null; } })();
  const parse = t => Object.fromEntries(t.split('\n').filter(l => /^cpu\d+ /.test(l)).map(l => {
    const [name, ...v] = l.trim().split(/\s+/); const n = v.map(Number); return [name, { idle: n[3] + n[4], total: n.reduce((a, b) => a + b, 0) }];
  }));
  const loop = (async () => {
    while (on) {
      const [stat, load] = await Promise.all([adbAsync('shell', 'cat', '/proc/stat'), adbAsync('shell', 'cat', '/proc/loadavg')]);
      const cur = parse(stat);
      let hostCpu = null;
      if (qemu) try { hostCpu = Number(execFileSync('ps', ['-p', qemu, '-o', '%cpu='], { encoding: 'utf8' }).trim()); } catch {}
      if (prev) samples.push({ coreBusy: Object.keys(cur).map(c => r1(100 * (1 - (cur[c].idle - prev[c].idle) / Math.max(1, cur[c].total - prev[c].total)))),
        load1: Number(load.split(' ')[0]), qemuHostCpu: hostCpu });
      prev = cur; await sleep(everyMs);
    }
  })();
  return { async stop() { on = false; await loop; return samples; } };
}
