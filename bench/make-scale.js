#!/usr/bin/env node
// Builds the ScaleLab screen and its cases from one description, so the two cannot drift
// (port of the iOS Phase 3 make-scale.js).
//
//   node bench/make-scale.js   → app/src/main/assets/scale.json (the tree the app renders),
//                                app/src/main/res/values/ids.xml, bench/scale-cases.json
//
// The screen is one shop "Checkout" page (G1, the targets) plus background load that only grows the
// tree. With default UiAutomator2 settings only views visible on screen are in the tree (docs/spike.md),
// so every group is a full-screen layer stacked under Checkout, as screens added to a back stack are:
// G2 two screens underneath (+400), G3 a recommendations screen (+500), G4 an open drawer and three
// kept-alive tabs (+1000). `--ei load 100|500|1000|2000` picks the groups. Checkout is the top layer and
// so the last subtree in the page source. Every target is unique in the whole tree at every load;
// background labels share words with targets but never the matched value.
//
// Node: { t: text|button|field|box|row, l: text or hint, id: resource name, d: content-desc,
//         w: share of the parent's length (default 1), f: fixed small height (depth markers), cols: grid columns (box only), k: children }.
// The app gives every view an exact pixel size: a box splits its height between its children by `w`,
// a row splits its width, a grid box places its children in `cols` columns.
import fs from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const PKG = 'io.github.domovou69.scalelab';
const rid = name => `${PKG}:id/${name}`;

// ---------- tree nodes
const text = (l, o = {}) => ({ t: 'text', l, ...o });
const button = (l, o = {}) => ({ t: 'button', l, ...o });
const field = (hint, id) => ({ t: 'field', l: hint, id });
const box = (o, k) => ({ t: 'box', ...o, k });
const row = (k, o = {}) => ({ t: 'row', ...o, k });

// ---------- targets: 10 shapes × 3 positions, each with its XPath, UiSelector and (shapes 1, 7) `byId` / `accessibilityId`
const TV = 'android.widget.TextView', BT = 'android.widget.Button';
const ui = s => `new UiSelector()${s}`;
const shapes = [
  { shape: 1, form: '//T[@resource-id="v"]', ids: ['nav_help', 'review_helpful', 'checkout_placeOrder'],
    make: id => ({ xpath: `//${BT}[@resource-id="${rid(id)}"]`, uiautomator: ui(`.className("${BT}").resourceId("${rid(id)}")`), byId: rid(id) }) },
  { shape: 2, form: '//T[contains(@text,"v")]', vals: ['#1042', 'Anna K', 'Baker St'],
    make: v => ({ xpath: `//${TV}[contains(@text,"${v}")]`, uiautomator: ui(`.className("${TV}").textContains("${v}")`) }) },
  { shape: 3, form: '//*[contains(@class,"Button") and contains(@text,"v")]', vals: ['promo code', 'more replies', 'payment method'],
    make: v => ({ xpath: `//*[contains(@class,"Button") and contains(@text,"${v}")]`, uiautomator: ui(`.classNameMatches(".*Button.*").textContains("${v}")`) }) },
  { shape: 4, form: '//T[@text="v"]', vals: ['Free delivery over $50', 'Great fit, runs small', 'Total: $148.97'],
    make: v => ({ xpath: `//${TV}[@text="${v}"]`, uiautomator: ui(`.className("${TV}").text("${v}")`) }) },
  { shape: 5, form: '//*[contains(@class,"EditText") and contains(@resource-id,"v")]', vals: ['codeInput', 'replyInput', 'postcode'],
    make: v => ({ xpath: `//*[contains(@class,"EditText") and contains(@resource-id,"${v}")]`, uiautomator: ui(`.classNameMatches(".*EditText.*").resourceIdMatches(".*${v}.*")`) }) },
  { shape: 6, form: '//T[contains(@content-desc,"v")]', vals: ['Edit cart', 'Report rev', 'Terms of'],
    make: v => ({ xpath: `//${BT}[contains(@content-desc,"${v}")]`, uiautomator: ui(`.className("${BT}").descriptionContains("${v}")`) }) },
  { shape: 7, form: '//*[@content-desc="v"]', vals: ['Flash sale banner', 'Verified purchase badge', 'Order help'],
    make: v => ({ xpath: `//*[@content-desc="${v}"]`, uiautomator: ui(`.description("${v}")`), accessibilityId: v }) },
  { shape: 8, form: '(//T[@text="v"])[n]', vals: [['Add to cart', 2], ['Reply', 2], ['Remove', 3]],
    make: ([v, n]) => ({ xpath: `(//${BT}[@text="${v}"])[${n}]`, uiautomator: ui(`.className("${BT}").text("${v}").instance(${n - 1})`), copies: { xpath: `//${BT}[@text="${v}"]`, count: 3 } }) },
  { shape: 9, form: '//*[@resource-id="v" and @text="v"]', vals: [['cart_badge', '3 items'], ['review_helpfulPrompt', 'Was this helpful?'], ['checkout_saveAddress', 'Save address']],
    make: ([id, v]) => ({ xpath: `//*[@resource-id="${rid(id)}" and @text="${v}"]`, uiautomator: ui(`.resourceId("${rid(id)}").text("${v}")`) }) },
  { shape: 10, form: '//*[contains(@resource-id,"v")]/child::T[@text="v"]', vals: [['deliveryInfo', 'Arrives Tue, Oct 14'], ['replyMeta', 'Posted 2 days ago'], ['summary_taxes', 'Taxes: $11.02']],
    make: ([id, v]) => ({ xpath: `//*[contains(@resource-id,"${id}")]/child::${TV}[@text="${v}"]`,
      uiautomator: ui(`.resourceIdMatches(".*${id}.*").childSelector(new UiSelector().className("${TV}").text("${v}"))`) }) },
];

// values no background node may carry: fragments matched by `contains` and exact values
const RESERVED = ['nav_help', 'review_helpful', 'checkout_placeOrder', '#1042', 'Anna K', 'Baker St', 'promo code', 'more replies',
  'payment method', 'Free delivery over $50', 'Great fit, runs small', 'Total: $148.97', 'codeInput', 'replyInput', 'postcode',
  'Edit cart', 'Report rev', 'Terms of', 'Flash sale banner', 'Verified purchase badge', 'Order help', 'cart_badge', '3 items',
  'review_helpfulPrompt', 'Was this helpful?', 'checkout_saveAddress', 'Save address', 'deliveryInfo', 'Arrives Tue, Oct 14',
  'replyMeta', 'Posted 2 days ago', 'summary_taxes', 'Taxes: $11.02'];
const RESERVED_EXACT = ['Add to cart', 'Reply', 'Remove'];

// ---------- G1: the Checkout page (always rendered, same at every load)
// DEEP = boxes between the thread root and the deep targets; calibrated so the deep targets sit at
// depth ~40 in the page source (snapshotMaxDepth is 70; XPath sees nothing below it).
const DEEP = Number(process.env.DEEP || 30);
function nest(levels, inner) { let n = inner; for (let i = levels; i >= 1; i--) n = [box({ id: `review_reply_${i}` }, n)]; return n[0]; }

const G1 = box({ id: 'screen_checkout' }, [
  // top: nav bar, header, promo, product cards
  box({ id: 'checkout_navbar' }, [row([text('Checkout', { id: 'checkout_title' }), button('Help', { id: 'nav_help' }), button('3 items', { id: 'cart_badge' })])]),
  text('Order #1042 · 3 items'),
  text('Free delivery over $50'),
  box({ id: 'header_deliveryInfo' }, [text('Arrives Tue, Oct 14')]),
  text('Flash sale ends in 02:14:09', { d: 'Flash sale banner' }),
  row([field('Promo code', 'promo_codeInput'), button('Apply promo code')]),
  button('Edit cart (3)', { d: 'Edit cart, 3 items' }),
  row(['Linen shirt · $49.99', 'Canvas sneakers · $64.00', 'Leather belt · $24.98'].map((p, i) => box({ id: `cart_product_${i + 1}` }, [text(p), button('Add to cart')]))),
  // middle: reviews with one deep thread
  box({ id: 'reviews_thread', w: 9 }, [
    nest(DEEP, [box({ id: 'review_deep' }, [
      text('Reply from Anna K.'),
      text('Great fit, runs small'),
      text('Verified purchase · Size M', { d: 'Verified purchase badge' }),
      box({ id: 'review_replyMeta' }, [text('Posted 2 days ago')]),
      text('Was this helpful?', { id: 'review_helpfulPrompt' }),
      row([button('Yes, helpful', { id: 'review_helpful' }), button('Report review', { d: 'Report review as abuse' })]),
      row([button('Reply'), button('Reply'), button('Reply')]),
      button('Show 3 more replies'),
      field('Write a reply', 'review_replyInput'),
    ])]),
  ]),
  // end: cart lines, address, summary, footer
  ...['Linen shirt', 'Canvas sneakers', 'Leather belt'].map(p => row([text(`${p} × 1`), button('Remove')])),
  row([text('Gift wrap'), button('Add gift wrap')]),
  text('Estimated delivery: 2–3 days'),
  text('Secure checkout'),
  text('Delivery address: 12 Baker St, London'),
  field('Postcode', 'address_postcodeField'),
  button('Save address', { id: 'checkout_saveAddress' }),
  button('Change payment method'),
  box({ id: 'checkout_summary_taxes' }, [text('Taxes: $11.02')]),
  text('Total: $148.97'),
  button('Terms of sale', { d: 'Terms of sale and returns' }),
  button('Need help with your order?', { d: 'Order help' }),
  button('Place order', { id: 'checkout_placeOrder' }),
]);

// ---------- background vocabulary
let seed = 1042;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = a => a[Math.floor(rnd() * a.length)];
const PRODUCTS = ['Wool sweater', 'Denim jacket', 'Running shoes', 'Silk scarf', 'Cotton t-shirt', 'Rain coat', 'Ankle boots',
  'Chino trousers', 'Leather wallet', 'Sunglasses', 'Baseball cap', 'Hiking backpack', 'Yoga mat', 'Water bottle', 'Coffee grinder',
  'French press', 'Ceramic mug', 'Desk lamp', 'Wireless earbuds', 'Phone case', 'USB-C cable', 'Smart watch', 'Bluetooth speaker',
  'Scented candle', 'Throw pillow', 'Bath towel', 'Plant pot', 'Notebook', 'Fountain pen', 'Board game'];
const ACTIONS = ['Add to wishlist', 'Compare', 'Share', 'Buy now', 'Details', 'Notify me', 'Add to bag', 'Quick view', 'Remove from list', 'Reply all'];
const TAGS = ['New', 'Bestseller', 'Only 2 left', 'Eco', '-20%', 'Limited', 'Back in stock'];
const CATEGORIES = ['Women', 'Men', 'Kids', 'Home', 'Electronics', 'Sports', 'Beauty', 'Garden', 'Books', 'Toys', 'Outlet'];
const price = () => `$${(5 + Math.floor(rnd() * 190))}.${String(Math.floor(rnd() * 100)).padStart(2, '0')}`;

// one product card: box + 2–4 TextView + row of 1–2 Button (≈ 6–8 elements); icon buttons carry a content-desc
function card(prefix, i) {
  const p = pick(PRODUCTS), k = [text(p), text(price())];
  if (rnd() < 0.5) k.push(text(`${(3.5 + rnd() * 1.5).toFixed(1)} ★ (${Math.floor(rnd() * 900)})`));
  if (rnd() < 0.3) k.push(text(pick(TAGS)));
  const act = () => { const a = pick(ACTIONS); return rnd() < 0.3 ? button(a, { d: `${a} ${p}` }) : button(a); };
  k.push(row(rnd() < 0.5 ? [act()] : [act(), act()]));
  return box({ id: `${prefix}_card_${i}` }, k);
}
function navbar(prefix, title) { return box({ id: `${prefix}_navbar` }, [row([button('Back', { id: `${prefix}_back`, d: 'Navigate up' }), text(title), button('Search', { id: `${prefix}_search` })])]); }

// every node is an element of the page source (layouts too: ignoreUnimportantViews=false)
const count = n => 1 + (n.k || []).reduce((s, c) => s + count(c), 0);
const total = ns => ns.reduce((s, n) => s + count(n), 0);
// a full-screen layer: header nodes, then cards in a grid until the layer holds `budget` elements
function layer(prefix, head, budget) {
  const grid = box({ id: `${prefix}_grid`, cols: 4, w: 8 }, []);
  const l = box({ id: `screen_${prefix}` }, [...head, grid]);
  let i = 0; while (count(l) < budget) grid.k.push(card(prefix, ++i));
  return l;
}

// budgets are calibrated against the page source (scale.js --count)
const B = { g2: Number(process.env.G2 || 390), g3: Number(process.env.G3 || 500), drawer: Number(process.env.DRAWER || 300), tabs: Number(process.env.TABS || 670) };

const G2 = [
  layer('home', [navbar('home', 'Home'), text('Good morning'), text('Picked for you')], B.g2 / 2),
  layer('catalog', [navbar('catalog', 'Catalog'), row(CATEGORIES.slice(0, 4).map(c => button(c)))], B.g2 / 2),
];
const G3 = [layer('reco', [navbar('reco', 'For you'), text('You may also like'), text('Recently viewed')], B.g3)];
function drawer(budget) {
  const cats = box({ id: 'drawer_categories', cols: 2, w: 12 }, []);
  const l = box({ id: 'screen_drawer' }, [text('Menu'), button('Sign in'), cats]); let i = 0;
  while (count(l) < budget) {
    const c = CATEGORIES[i % CATEGORIES.length] + (i >= CATEGORIES.length ? ` ${Math.floor(i / CATEGORIES.length) + 1}` : '');
    cats.k.push(box({ id: `drawer_cat_${++i}` }, [button(c), ...['New in', 'Clothing', 'Shoes', 'Accessories', 'Sale'].map(s =>
      row([button(`${c}: ${s}`), text(`${Math.floor(rnd() * 400)} products`)]))]));
  }
  return l;
}
const G4 = [
  layer('search', [navbar('search', 'Search'), text('Popular searches')], B.tabs / 3),
  layer('orders', [navbar('orders', 'Orders'), text('Order history')], B.tabs / 3),
  layer('profile', [navbar('profile', 'Profile'), text('Account settings')], B.tabs / 3),
  drawer(B.drawer),
];

// ---------- checks
const strings = n => [n.l, n.id, n.d, ...(n.k || []).flatMap(strings)].filter(Boolean);
const bg = [...G2, ...G3, ...G4].flatMap(strings);
const clash = bg.filter(s => RESERVED.some(r => s.includes(r)) || RESERVED_EXACT.includes(s));
if (clash.length) throw new Error(`background reuses target values: ${[...new Set(clash)].join(', ')}`);
const g1 = strings(G1);
for (const r of RESERVED) if (!g1.some(s => s.includes(r))) throw new Error(`target value missing from G1: ${r}`);

// ---------- scale-deep: one chain of boxes, a marker every 5 levels, to 100 (depth check, not timed)
const DEEP_MAX = 100;
let deepTree = [text(`depth.marker.${DEEP_MAX}`, { f: 1 })];
for (let d = DEEP_MAX - 1; d >= 1; d--) deepTree = [box({ id: `level_${d}` }, d % 5 === 0 ? [text(`depth.marker.${d}`, { f: 1 }), ...deepTree] : deepTree)];

// ---------- write
// groups bottom → top; the app adds the ones of the requested load in this order, Checkout last
const screen = { note: 'Generated by bench/make-scale.js; do not edit.', groups: { g4: G4, g3: G3, g2: G2, g1: [G1] }, deep: deepTree };
fs.mkdirSync(`${ROOT}app/src/main/assets`, { recursive: true });
fs.writeFileSync(`${ROOT}app/src/main/assets/scale.json`, JSON.stringify(screen) + '\n');

const ids = new Set();
const collect = n => { if (n.id) ids.add(n.id); (n.k || []).forEach(collect); };
[G1, ...G2, ...G3, ...G4, ...deepTree].forEach(collect);
fs.writeFileSync(`${ROOT}app/src/main/res/values/ids.xml`, ['<?xml version="1.0" encoding="utf-8"?>',
  '<!-- Generated by bench/make-scale.js; do not edit. -->', '<resources>',
  ...[...ids].sort().map(id => `    <item name="${id}" type="id" />`), '</resources>', ''].join('\n'));

const positions = ['top', 'deep', 'end'];
const cases = shapes.flatMap(s => positions.map((p, i) => ({
  id: `S${String(s.shape).padStart(2, '0')}-${p}`, shape: s.shape, form: s.form, position: p, ...s.make((s.ids || s.vals)[i]) })));
const deepCases = [];
for (let d = 5; d <= DEEP_MAX; d += 5) deepCases.push({ id: `D${d}`, marker: d,
  xpath: `//${TV}[@text="depth.marker.${d}"]`, uiautomator: ui(`.className("${TV}").text("depth.marker.${d}")`) });
fs.writeFileSync(`${ROOT}bench/scale-cases.json`, JSON.stringify({ note: 'Generated by bench/make-scale.js; do not edit.', cases, deep: deepCases }, null, 1) + '\n');

console.log(`G1 ${count(G1)}, G2 ${total(G2)}, G3 ${total(G3)}, G4 ${total(G4)} model elements (+ the app's window and root views); ${ids.size} ids; ${cases.length} cases, ${deepCases.length} depth markers`);
