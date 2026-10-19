#!/usr/bin/env node
// Chart: time per lookup vs. elements in the tree, XPath and UiSelector (mean of the 30 case medians).
// Reads the totals that scale.js wrote (the same numbers as the report's tables).
//
//   node bench/make-scale-chart.js                         → scale-chart.svg from results/results-scale-emulator.json
//   node bench/make-scale-chart.js run.json out.svg        another run (e.g. your own device)
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const inFile = process.argv[2] || new URL('results/results-scale-emulator.json', root);
const outFile = process.argv[3] || new URL('scale-chart.svg', root);
const doc = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const pts = doc.loads.map(l => {
  const u = l.summary.uiautomator;
  return { n: l.elements, x: u.xpathTotalMs / u.cases, u: u.totalMs / u.cases };
});
const d = doc.env.device;
const title = `${d.avd ? `Emulator ${d.avd}` : d.model}, Android ${d.android}, UiAutomator2 server ${doc.env.uiautomator2Server}`;

const W = 720, H = 420, top = 96, bottom = 52, left = 64, right = 96;
const pw = W - left - right, ph = H - top - bottom;
const xMax = Math.ceil(Math.max(...pts.map(p => p.n)) / 500) * 500;
const yMax = Math.ceil(Math.max(...pts.map(p => p.x)) / 250) * 250;
const X = n => left + n / xMax * pw, Y = ms => top + ph - ms / yMax * ph;
const fmt = ms => ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

let body = `<text class="t2" x="${left}" y="${top - 34}">${esc(title)}</text>\n`;
for (let s = 0; s <= yMax; s += 250) {
  body += `<line class="${s ? 'grid' : 'axis'}" x1="${left}" x2="${left + pw}" y1="${Y(s)}" y2="${Y(s)}"/>\n`;
  body += `<text class="tick" x="${left - 8}" y="${Y(s) + 4}" text-anchor="end">${s} ms</text>\n`;
}
for (const p of pts) body += `<text class="tick" x="${X(p.n)}" y="${top + ph + 18}" text-anchor="middle">${p.n}</text>\n`;
body += `<text class="tick" x="${left + pw / 2}" y="${top + ph + 38}" text-anchor="middle">elements in the tree</text>\n`;
for (const [key, cls, name] of [['x', 's-xpath', 'XPath'], ['u', 's-ui', 'UiSelector']]) {
  body += `<polyline class="line ${cls}" points="${pts.map(p => `${X(p.n).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ')}"/>\n`;
  for (const p of pts) body += `<circle class="dot ${cls}" cx="${X(p.n).toFixed(1)}" cy="${Y(p[key]).toFixed(1)}" r="4"><title>${name}, ${p.n} elements: ${fmt(p[key])}</title></circle>\n`;
  const last = pts[pts.length - 1];
  body += `<text class="val" x="${X(last.n) + 10}" y="${Y(last[key]) + (key === 'x' ? -2 : 12)}">${fmt(last[key])}</text>\n`;
}
const sav = pts.map(p => (p.x - p.u) / p.x * 100);
body += `<text class="tick" x="${left}" y="${top - 16}">UiSelector ${Math.round(Math.min(...sav))}–${Math.round(Math.max(...sav))} % faster per lookup (30 cases, median of 3 passes)</text>\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Time per element lookup vs. elements in the tree, XPath and UiSelector, Android emulator">
<title>Time per lookup vs. elements in the tree</title>
<style>
  svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink2: #52514e; --muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --xpath: #eb6834; --ui: #2a78d6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  @media (prefers-color-scheme: dark) { svg { --surface: #1a1a19; --ink: #ffffff; --ink2: #c3c2b7; --grid: #2c2c2a; --axis: #383835; --xpath: #d95926; --ui: #3987e5; } }
  .bg { fill: var(--surface); }
  .t1 { fill: var(--ink); font-size: 16px; font-weight: 600; }
  .t2 { fill: var(--ink); font-size: 13px; font-weight: 600; }
  .tick { fill: var(--muted); font-size: 11px; }
  .val, .leg { fill: var(--ink2); font-size: 12px; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .axis { stroke: var(--axis); stroke-width: 1; }
  .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .dot { stroke: var(--surface); stroke-width: 2; }
  .line.s-xpath { stroke: var(--xpath); } .dot.s-xpath { fill: var(--xpath); }
  .line.s-ui { stroke: var(--ui); } .dot.s-ui { fill: var(--ui); }
</style>
<rect class="bg" width="${W}" height="${H}" rx="8"/>
<text class="t1" x="${left}" y="28">Time per element lookup vs. elements in the tree</text>
<line class="line s-xpath" x1="${W - right - 176}" x2="${W - right - 160}" y1="24" y2="24"/><text class="leg" x="${W - right - 154}" y="28">XPath</text>
<line class="line s-ui" x1="${W - right - 100}" x2="${W - right - 84}" y1="24" y2="24"/><text class="leg" x="${W - right - 78}" y="28">UiSelector</text>
${body}</svg>
`;
fs.writeFileSync(outFile, svg);
console.log(`${outFile instanceof URL ? outFile.pathname : outFile}: ${title}, ${pts.length} sizes`);
