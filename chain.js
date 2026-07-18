// Read-only live land map. Wallet actions live on the dashboard.

// vendored tree-shaken viem 2.21.19 bundle; the site itself has no build step
import {
  createPublicClient, http, defineChain, parseAbi,
} from './vendor/viem.js';

import { addressUrl, MULTICALL3, NET, withNetwork } from './config.js';

const LAND = NET.land;
const EXPLORER = NET.explorer;
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = NET.symbols;
const WAD = 10n ** 18n;

const chain = defineChain({
  id: NET.chainId,
  name: NET.label,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: NET.key !== 'mainnet',
});

const abi = parseAbi([
  'function multiplierWad() view returns (uint256)',
  'function marketMultiplierWad() view returns (uint256)',
  'function ownershipBitmap() view returns (uint256[4])',
  'function plotsPacked() view returns (uint256[1024])',
]);

const pub = createPublicClient({
  chain,
  batch: { multicall: { wait: 16, batchSize: 4096 } },
  transport: http(NET.rpc),
});

const U = window.utopia;
const canvas = document.getElementById('land');
const ctx = canvas.getContext('2d');
const wrap = canvas.parentElement;
const statusEl = document.querySelector('.map-status');
const panel = document.getElementById('panel');
const walletLink = document.getElementById('wallet');

const view = { w: 0, h: 0, tw: 30, th: 15, ox: 0, oy: 0 };

// chain state
let prices = null; // base prices, bigint UTOP wei
let apys = null; // Uint16Array
let tokIdx = null; // Uint8Array
let owned = new Uint8Array(PLOTS);
let ownedCount = 0;
let multiplier = WAD;
let loaded = false;
let selected = -1;
let hoverId = -1;

function priceNow(id) {
  return NET.landVersion === 2 ? (prices[id] * multiplier) / WAD : prices[id];
}

function fmtPrice(wei) {
  const n = Number(wei) / 1e18;
  return NET.payment === 'native'
    ? parseFloat(n.toFixed(5)) + ' ETH'
    : parseFloat(n.toFixed(2)) + ' UTOP';
}

function short(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ---- rendering ----

function fit() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  view.w = w; view.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tw = Math.min((w * 0.94) / SIDE, (2 * (h * 0.8)) / SIDE);
  view.tw = tw;
  view.th = tw / 2;
  view.ox = w / 2;
  view.oy = (h - SIDE * view.th) / 2 + view.th * 1.5;
}

function zOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  if (!owned[id]) return 0.08;
  return 0.35 + U.hash(x + 7, y + 13) * 0.85;
}

function render() {
  ctx.fillStyle = U.BG;
  ctx.fillRect(0, 0, view.w, view.h);
  for (let s = 0; s <= 2 * SIDE - 2; s++) {
    for (let x = Math.max(0, s - SIDE + 1); x <= Math.min(SIDE - 1, s); x++) {
      const y = s - x;
      const id = y * SIDE + x;
      let z = zOf(id);
      let top = owned[id] ? U.CLAIMED_TOP : U.TOPS[(U.hash(x, y) * 997) % 3 | 0];
      if (id === selected) z += 0.35;
      if (id === hoverId && id !== selected) top = U.HOVER_TOP;
      U.prism(ctx, view, x + U.IN, y + U.IN, x + 1 - U.IN, y + 1 - U.IN, z, top);
    }
  }
}

let raf = 0;
function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}

// ---- chain reads ----

async function loadStatic() {
  if (!NET.ready) return;
  const packed = await pub.readContract({ address: LAND, abi, functionName: 'plotsPacked' });
  prices = new Array(PLOTS);
  apys = new Uint16Array(PLOTS);
  tokIdx = new Uint8Array(PLOTS);
  const M128 = (1n << 128n) - 1n;
  for (let i = 0; i < PLOTS; i++) {
    const v = packed[i];
    prices[i] = v & M128;
    apys[i] = Number((v >> 128n) & 0xffffn);
    tokIdx[i] = Number(v >> 144n);
  }
}

function unpackBits(words, out) {
  let count = 0;
  for (let i = 0; i < PLOTS; i++) {
    const bit = (words[i >> 8] >> BigInt(i & 255)) & 1n;
    out[i] = Number(bit);
    count += out[i];
  }
  return count;
}

async function refreshOwnership() {
  if (!NET.ready) return;
  const multiplierFunction = NET.landVersion === 2
    ? 'multiplierWad'
    : NET.landVersion === 3 ? 'marketMultiplierWad' : null;
  const [bm, mult] = await Promise.all([
    pub.readContract({ address: LAND, abi, functionName: 'ownershipBitmap' }),
    multiplierFunction
      ? pub.readContract({ address: LAND, abi, functionName: multiplierFunction })
      : Promise.resolve(WAD),
  ]);
  multiplier = mult;
  ownedCount = unpackBits(bm, owned);
  const contractLink = document.createElement('a');
  contractLink.href = addressUrl(LAND);
  contractLink.target = '_blank';
  contractLink.rel = 'noopener';
  contractLink.textContent = 'contract';
  statusEl.replaceChildren(
    document.createTextNode(ownedCount + ' of 1,024 plots owned · ' + NET.label + ' · '),
    contractLink,
  );
  schedule();
}

async function load() {
  if (!NET.ready) return;
  try {
    if (!prices) await loadStatic();
    await refreshOwnership();
    loaded = true;
  } catch (e) {
    statusEl.textContent = 'the chain is not answering right now. retrying shortly.';
    setTimeout(load, 30000);
  }
}

// ---- panel / interactions ----

function setPanel(html) {
  panel.innerHTML = html;
  panel.hidden = false;
}

// the landing map is read-only; buying and claiming live on the dashboard
function panelFor(id) {
  const name = 'plot ' + id;
  const rate = (apys[id] / 100).toFixed(2) + '% base reward rate';
  const reward = 'rewards in ' + SYMBOLS[tokIdx[id]];
  if (!owned[id]) {
    setPanel('<b>' + name + ' · ' + fmtPrice(priceNow(id)) + '</b><p>' + rate + ' · ' + reward +
      '</p><p><a href="' + withNetwork('app.html') + '">buy it on the dashboard</a></p>');
  } else {
    setPanel('<b>' + name + ' · owned</b><p>' + rate + ' · ' + reward + '</p><p><a href="' + EXPLORER +
      '/token/' + LAND + '/instance/' + id + '" target="_blank" rel="noopener">deed on the explorer</a></p>');
  }
}

function pick(e) {
  const rect = canvas.getBoundingClientRect();
  const a = (e.clientX - rect.left - view.ox) / (view.tw / 2);
  const b = (e.clientY - rect.top - view.oy + 0.5 * view.th) / (view.th / 2);
  const gx = Math.floor((a + b) / 2);
  const gy = Math.floor((b - a) / 2);
  if (gx < 0 || gx >= SIDE || gy < 0 || gy >= SIDE) return -1;
  return gy * SIDE + gx;
}

canvas.addEventListener('click', e => {
  if (!loaded) return;
  const id = pick(e);
  selected = id;
  if (id >= 0) panelFor(id);
  else panel.hidden = true;
  schedule();
});

if (U.fine) {
  canvas.addEventListener('pointermove', e => {
    if (!loaded) return;
    const id = pick(e);
    hoverId = id;
    if (id >= 0) {
      const l1 = 'plot ' + id + (owned[id] ? ' · owned' : ' · ' + fmtPrice(priceNow(id)));
      const l2 = (apys[id] / 100).toFixed(2) + '% base rate · rewards in ' + SYMBOLS[tokIdx[id]];
      U.tipShow(e, l1, l2);
    } else U.tipHide();
    schedule();
  });
  canvas.addEventListener('pointerleave', () => {
    hoverId = -1;
    U.tipHide();
    schedule();
  });
}

// ---- lifecycle ----

let pollTimer = 0;
new IntersectionObserver(entries => {
  const vis = entries[0].isIntersecting;
  clearInterval(pollTimer);
  if (vis && NET.ready) {
    if (!loaded) load(); else refreshOwnership().catch(() => {});
    pollTimer = setInterval(() => refreshOwnership().catch(() => {}), 15000);
  }
}).observe(canvas);

window.addEventListener('resize', () => { fit(); schedule(); });

fit();
render();
walletLink.href = withNetwork('app.html');
walletLink.textContent = NET.ready ? 'open dashboard' : 'mainnet pending';
document.querySelectorAll('a[href="app.html"]').forEach(link => { link.href = withNetwork('app.html'); });

if (NET.ready) {
  load();
} else {
  statusEl.textContent = 'mainnet contracts and reviewed oracle are not deployed yet.';
}
