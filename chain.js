// the land, live: reads and writes the real UtopiaLand contract on
// Robinhood Chain testnet. Renders with the same prism system as the art.

// vendored tree-shaken viem 2.21.19 bundle; the site itself has no build step
import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi,
} from './vendor/viem.js';

const LAND = '0x6ceB22129eB8EBf3Ad1F9828F5c585Fa3A390cFd';
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = ['TSLA', 'AMD', 'PLTR', 'AMZN', 'NFLX'];
const WAD = 10n ** 18n;

const chain = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
  testnet: true,
});

const abi = parseAbi([
  'function multiplierWad() view returns (uint256)',
  'function ownershipBitmap() view returns (uint256[4])',
  'function plotsOf(address) view returns (uint256[4])',
  'function plotsPacked() view returns (uint256[1024])',
]);

const pub = createPublicClient({ chain, transport: http() });

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
let mine = new Uint8Array(PLOTS);
let ownedCount = 0;
let multiplier = WAD;
let loaded = false;
let account = null;
let selected = -1;
let hoverId = -1;

const MINE_TOP = '#ffffff';

function priceNow(id) {
  return (prices[id] * multiplier) / WAD;
}

function fmtUtop(wei) {
  return parseFloat((Number(wei) / 1e18).toFixed(2)) + ' UTOP';
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
      let top = owned[id] ? (mine[id] ? MINE_TOP : U.CLAIMED_TOP) : U.TOPS[(U.hash(x, y) * 997) % 3 | 0];
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
  const [bm, mult] = await Promise.all([
    pub.readContract({ address: LAND, abi, functionName: 'ownershipBitmap' }),
    pub.readContract({ address: LAND, abi, functionName: 'multiplierWad' }),
  ]);
  multiplier = mult;
  ownedCount = unpackBits(bm, owned);
  if (account) {
    const my = await pub.readContract({ address: LAND, abi, functionName: 'plotsOf', args: [account] });
    unpackBits(my, mine);
  } else {
    mine.fill(0);
  }
  statusEl.innerHTML = ownedCount + ' of 1,024 plots owned · robinhood chain testnet · ' +
    '<a href="' + EXPLORER + '/address/' + LAND + '" target="_blank" rel="noopener">contract</a>';
  schedule();
}

async function load() {
  try {
    if (!prices) await loadStatic();
    await refreshOwnership();
    loaded = true;
  } catch (e) {
    statusEl.textContent = 'the chain is not answering right now. retrying shortly.';
    setTimeout(load, 30000);
  }
}

// ---- wallet ----

async function connect() {
  if (!window.ethereum) {
    setPanel('<b>no wallet found</b><p>utopia needs a browser wallet like MetaMask or Rabby to buy land. the map stays readable without one.</p>');
    return null;
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [addr] = await wallet.requestAddresses();
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (err) {
    await wallet.addChain({ chain });
    await wallet.switchChain({ id: chain.id });
  }
  account = addr;
  walletLink.textContent = short(addr);
  await refreshOwnership();
  return wallet;
}

walletLink.addEventListener('click', e => {
  e.preventDefault();
  if (!account) connect().catch(() => {});
  else document.getElementById('live').scrollIntoView();
});

if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', accs => {
    account = accs[0] || null;
    walletLink.textContent = account ? short(account) : 'connect wallet';
    refreshOwnership().catch(() => {});
  });
}

// ---- panel / interactions ----

function setPanel(html) {
  panel.innerHTML = html;
  panel.hidden = false;
}

// the landing map is read-only; buying and claiming live on the dashboard
function panelFor(id) {
  const name = 'plot ' + id;
  const apy = (apys[id] / 100).toFixed(2) + '% apy';
  const grows = 'grows ' + SYMBOLS[tokIdx[id]];
  if (!owned[id]) {
    setPanel('<b>' + name + ' · ' + fmtUtop(priceNow(id)) + '</b><p>' + apy + ' · ' + grows +
      '</p><p><a href="app.html">buy it on the dashboard</a></p>');
  } else if (mine[id]) {
    setPanel('<b>' + name + ' · yours</b><p>' + apy + ' · ' + grows +
      '</p><p><a href="app.html">claim yield on the dashboard</a></p>');
  } else {
    setPanel('<b>' + name + ' · owned</b><p>' + apy + ' · ' + grows + '</p><p><a href="' + EXPLORER +
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
      const l1 = 'plot ' + id + (owned[id] ? (mine[id] ? ' · yours' : ' · owned') : ' · ' + fmtUtop(priceNow(id)));
      const l2 = (apys[id] / 100).toFixed(2) + '% apy · grows ' + SYMBOLS[tokIdx[id]];
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
  if (vis) {
    if (!loaded) load(); else refreshOwnership().catch(() => {});
    pollTimer = setInterval(() => refreshOwnership().catch(() => {}), 15000);
  }
}).observe(canvas);

window.addEventListener('resize', () => { fit(); schedule(); });

fit();
render();
load();
