#!/usr/bin/env node
// Element count, max depth and the depth of the position targets per load, plus the depth screen —
// to calibrate the budgets in make-scale.js (target: within ±2 % of 100 / 500 / 1000 / 2000).
//
//   node bench/count.js [100,500,1000,2000]
import { Session, launch, shape, r1 } from './lib/wd.js';

const loads = (process.argv[2] || '100,500,1000,2000').split(',').map(Number);
const MARK = { top: 'nav_help', deep: 'review_helpful', end: 'checkout_placeOrder' };

// depth of the first element whose attribute matches (hierarchy children = depth 1)
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

const s = await Session.open();
try {
  for (const load of loads) {
    const l = await launch({ load }, '.ScaleActivity');
    const { src, ms } = await s.source();
    const t = shape(src);
    const depths = Object.fromEntries(Object.entries(MARK).map(([p, id]) => [p, depthOf(src, new RegExp(`resource-id="[^"]*:id/${id}"`))]));
    const off = r1(100 * (t.elements - load) / load);
    console.log(`load ${load}: ${t.elements} elements (${off > 0 ? '+' : ''}${off} %), max depth ${t.maxDepth}, target depths ${JSON.stringify(depths)}, page source ${r1(ms)} ms, launch ${JSON.stringify(l)}`);
  }
  await launch({ screen: 'deep' }, '.ScaleActivity');
  const { src } = await s.source();
  const seen = [...src.matchAll(/text="depth\.marker\.(\d+)"/g)].map(m => Number(m[1]));
  console.log(`deep: max depth ${shape(src).maxDepth}, deepest marker in page source ${Math.max(0, ...seen)}`);
} finally { await s.close(); }
