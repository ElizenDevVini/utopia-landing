// utopia dashboard: buy plots with UTOP, watch yield, claim. Real contracts
// on Robinhood Chain testnet; same renderer language as the landing page.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi,
} from './vendor/viem.js';
import { BG, TOPS, HOVER_TOP, CLAIMED_TOP, IN, hash, prism, makeTip } from './iso.js';

const LAND = '0x6ceB22129eB8EBf3Ad1F9828F5c585Fa3A390cFd';
const UTOP = '0xB0Ff1Be3dd5b04F285e82a502Fcc30D216Bd4977';
const EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = ['TSLA', 'AMD', 'PLTR', 'AMZN', 'NFLX'];
const MINE_TOP = '#ffffff';
const WAD = 10n ** 18n;

// open-plot tops by base value, cheap to premium; premium gets the gold
const TIER_TOPS = ['#dbe7f5', '#b9d3ec', '#8fb9e4', '#e3c67b'];
const TIERS = [150n * WAD, 220n * WAD, 300n * WAD];

const chain = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
  testnet: true,
});

const abi = parseAbi([
  'function buy(uint256 id)',
  'function claim(uint256 id)',
  'function claimMany(uint256[] ids)',
  'function claimable(uint256 id) view returns (uint256)',
  'function multiplierWad() view returns (uint256)',
  'function ownershipBitmap() view returns (uint256[4])',
  'function plotsOf(address) view returns (uint256[4])',
  'function plotsPacked() view returns (uint256[1024])',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function faucet()',
]);

const pub = createPublicClient({ chain, transport: http() });

const canvas = document.getElementById('land');
const ctx = canvas.getContext('2d');
const statusEl = document.querySelector('.map-status');
const selEl = document.getElementById('sel');
const holdingsEl = document.querySelector('#holdings .body');
const marketEl = document.querySelector('#market .body');
const walletLink = document.getElementById('wallet');
const tip = makeTip(document.getElementById('tip'));
const fine = matchMedia('(pointer: fine)').matches;

const view = { w: 0, h: 0, tw: 30, th: 15, ox: 0, oy: 0 };

let basePrices = null; // bigint[] in UTOP wei
let apys = null;
let tokIdx = null;
let tiers = null; // Uint8Array 0..3
let owned = new Uint8Array(PLOTS);
let mine = new Uint8Array(PLOTS);
let ownedCount = 0;
let multiplier = WAD;
let loaded = false;
let account = null;
let selected = -1;
let hoverId = -1;
let claimables = new Map();
let utopBalance = null;

function priceNow(id) {
  return (basePrices[id] * multiplier) / WAD;
}

function fmtUtop(wei) {
  const n = Number(wei) / 1e18;
  return parseFloat(n.toFixed(2)) + ' UTOP';
}

function fmtTok(wei, idx) {
  const n = Number(wei) / 1e18;
  const s = n === 0 ? '0' : n < 1e-6 ? n.toExponential(2) : parseFloat(n.toFixed(8)).toString();
  return s + ' ' + SYMBOLS[idx];
}

function fmtMult() {
  return (Number(multiplier) / 1e18).toFixed(2) + 'x';
}

function short(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

// ---- rendering ----

function fit() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  view.w = w; view.h = h;
  const dpr = Math.min(window.devicePixelRatio || 1, w < 700 ? 1.5 : 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tw = Math.min((w * 0.96) / SIDE, (2 * (h * 0.82)) / SIDE);
  view.tw = tw;
  view.th = tw / 2;
  view.ox = w / 2;
  view.oy = (h - SIDE * view.th) / 2 + view.th * 1.5;
}

function zOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  if (!owned[id]) return 0.08;
  return 0.35 + hash(x + 7, y + 13) * 0.85;
}

function render() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
  for (let s = 0; s <= 2 * SIDE - 2; s++) {
    for (let x = Math.max(0, s - SIDE + 1); x <= Math.min(SIDE - 1, s); x++) {
      const y = s - x;
      const id = y * SIDE + x;
      let z = zOf(id);
      let top;
      if (owned[id]) top = mine[id] ? MINE_TOP : CLAIMED_TOP;
      else top = tiers ? TIER_TOPS[tiers[id]] : TOPS[(hash(x, y) * 997) % 3 | 0];
      if (id === selected) z += 0.35;
      if (id === hoverId && id !== selected) top = HOVER_TOP;
      prism(ctx, view, x + IN, y + IN, x + 1 - IN, y + 1 - IN, z, top);
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
  basePrices = new Array(PLOTS);
  apys = new Uint16Array(PLOTS);
  tokIdx = new Uint8Array(PLOTS);
  tiers = new Uint8Array(PLOTS);
  const M128 = (1n << 128n) - 1n;
  for (let i = 0; i < PLOTS; i++) {
    const v = packed[i];
    basePrices[i] = v & M128;
    apys[i] = Number((v >> 128n) & 0xffffn);
    tokIdx[i] = Number(v >> 144n);
    tiers[i] = TIERS.findIndex(t => basePrices[i] < t);
    if (tiers[i] === 255) tiers[i] = 3; // findIndex returned -1: top tier
  }
}

function unpackBits(words, out) {
  let count = 0;
  for (let i = 0; i < PLOTS; i++) {
    out[i] = Number((words[i >> 8] >> BigInt(i & 255)) & 1n);
    count += out[i];
  }
  return count;
}

async function refreshOwnership() {
  const [bm, mult] = await Promise.all([
    pub.readContract({ address: LAND, abi, functionName: 'ownershipBitmap' }),
    pub.readContract({ address: LAND, abi, functionName: 'multiplierWad' }),
  ]);
  ownedCount = unpackBits(bm, owned);
  multiplier = mult;
  if (account) {
    const [my, bal] = await Promise.all([
      pub.readContract({ address: LAND, abi, functionName: 'plotsOf', args: [account] }),
      pub.readContract({ address: UTOP, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    ]);
    unpackBits(my, mine);
    utopBalance = bal;
  } else {
    mine.fill(0);
    utopBalance = null;
  }
  statusEl.innerHTML = ownedCount + ' of 1,024 plots owned · market multiplier ' + fmtMult() + ' · ' +
    '<a href="' + EXPLORER + '/address/' + LAND + '" target="_blank" rel="noopener">contract</a>';
  renderMarket();
  renderHoldings();
  schedule();
}

async function refreshClaimables() {
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
  const vals = await Promise.all(ids.map(id =>
    pub.readContract({ address: LAND, abi, functionName: 'claimable', args: [BigInt(id)] }).catch(() => 0n)
  ));
  claimables = new Map(ids.map((id, i) => [id, vals[i]]));
  renderHoldings();
  if (selected >= 0 && mine[selected]) renderSel();
}

async function load() {
  try {
    if (!basePrices) await loadStatic();
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
    selEl.innerHTML = '<h3>no wallet</h3><p class="quiet-note">utopia needs a browser wallet like MetaMask or Rabby. the map stays readable without one.</p>';
    return null;
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [addr] = await wallet.requestAddresses();
  try {
    await wallet.switchChain({ id: chain.id });
  } catch {
    await wallet.addChain({ chain });
    await wallet.switchChain({ id: chain.id });
  }
  account = addr;
  walletLink.textContent = short(addr);
  await refreshOwnership();
  refreshClaimables();
  return wallet;
}

walletLink.addEventListener('click', e => {
  e.preventDefault();
  if (!account) connect().catch(() => {});
});

if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', accs => {
    account = accs[0] || null;
    walletLink.textContent = account ? short(account) : 'connect wallet';
    claimables.clear();
    refreshOwnership().catch(() => {});
    if (account) refreshClaimables();
  });
}

// ---- selected plot ----

function coords(id) {
  return '(' + (id % SIDE) + ', ' + ((id / SIDE) | 0) + ')';
}

function renderSel() {
  if (selected < 0 || !loaded) {
    selEl.innerHTML = '<h3>plot</h3><p class="quiet-note">click a plot on the map, or pick one from the market below.</p>';
    return;
  }
  const id = selected;
  const rows =
    '<div class="row"><span class="k">price</span><span class="v">' + fmtUtop(priceNow(id)) + '</span></div>' +
    '<div class="row"><span class="k">apy</span><span class="v">' + (apys[id] / 100).toFixed(2) + '%</span></div>' +
    '<div class="row"><span class="k">grows</span><span class="v">' + SYMBOLS[tokIdx[id]] + '</span></div>';
  if (!owned[id]) {
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
      '<button id="act" data-act="buy">' + (account ? 'buy for ' + fmtUtop(priceNow(id)) : 'connect wallet to buy') + '</button>' +
      '<p class="txstate"></p>';
  } else if (mine[id]) {
    const c = claimables.get(id);
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · yours</h3>' + rows +
      '<div class="row"><span class="k">claimable</span><span class="v">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></div>' +
      '<button id="act" data-act="claim">claim yield</button>' +
      '<p class="txstate"></p>';
  } else {
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · owned</h3>' + rows +
      '<p><a href="' + EXPLORER + '/token/' + LAND + '/instance/' + id + '" target="_blank" rel="noopener">deed on the explorer</a></p>';
  }
}

function txState(msg) {
  const el = selEl.querySelector('.txstate') || holdingsEl.querySelector('.txstate');
  if (el) el.innerHTML = msg;
}

async function doTx(act, ids) {
  const btn = selEl.querySelector('#act') || holdingsEl.querySelector('#claimall');
  try {
    const wallet = await connect();
    if (!wallet) return;
    if (btn) btn.disabled = true;
    let hash_;
    if (act === 'buy') {
      const id = ids[0];
      const price = priceNow(id);
      const allowance = await pub.readContract({
        address: UTOP, abi: erc20Abi, functionName: 'allowance', args: [account, LAND],
      });
      if (utopBalance != null && utopBalance < price) {
        txState('not enough UTOP. use "get 1,000 UTOP" below.');
        if (btn) btn.disabled = false;
        return;
      }
      if (allowance < price) {
        txState('step 1 of 2 · approve UTOP in your wallet…');
        const ah = await wallet.writeContract({
          address: UTOP, abi: erc20Abi, functionName: 'approve', args: [LAND, price], account,
        });
        await pub.waitForTransactionReceipt({ hash: ah });
      }
      txState('confirm the buy in your wallet…');
      hash_ = await wallet.writeContract({ address: LAND, abi, functionName: 'buy', args: [BigInt(id)], account });
    } else if (act === 'claim') {
      hash_ = await wallet.writeContract({ address: LAND, abi, functionName: 'claim', args: [BigInt(ids[0])], account });
    } else if (act === 'claimMany') {
      hash_ = await wallet.writeContract({ address: LAND, abi, functionName: 'claimMany', args: [ids.map(BigInt)], account });
    } else {
      hash_ = await wallet.writeContract({ address: UTOP, abi: erc20Abi, functionName: 'faucet', account });
    }
    txState('pending · <a href="' + EXPLORER + '/tx/' + hash_ + '" target="_blank" rel="noopener">' + short(hash_) + '</a>');
    await pub.waitForTransactionReceipt({ hash: hash_ });
    await refreshOwnership();
    await refreshClaimables();
    renderSel();
    txState(act === 'buy' ? 'yours. the block just rose.' : act === 'faucet' ? '1,000 UTOP in.' : 'claimed. check your wallet.');
  } catch (err) {
    if (btn) btn.disabled = false;
    const m = (err?.shortMessage || err?.message || 'failed').split('\n')[0];
    txState(/rejected|denied/i.test(m) ? 'cancelled.' : m.toLowerCase());
  }
}

selEl.addEventListener('click', e => {
  const btn = e.target.closest('#act');
  if (btn && selected >= 0) doTx(btn.dataset.act, [selected]);
});

// ---- holdings ----

function renderHoldings() {
  if (!account) {
    holdingsEl.innerHTML = '<p class="quiet-note">connect a wallet to see your plots and yield.</p>';
    return;
  }
  const bal = '<div class="row"><span class="k">UTOP balance</span><span class="v">' +
    (utopBalance != null ? fmtUtop(utopBalance) : '…') + '</span></div>';
  const faucetBtn = '<button id="getutop">get 1,000 UTOP</button>';
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
  if (!ids.length) {
    holdingsEl.innerHTML = bal + '<p class="quiet-note">no plots yet. click an open one on the map.</p>' + faucetBtn + '<p class="txstate"></p>';
    return;
  }
  const items = ids.map(id => {
    const c = claimables.get(id);
    return '<li><span class="plotlink" data-id="' + id + '">plot ' + id + '</span>' +
      '<span class="amt">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></li>';
  }).join('');
  holdingsEl.innerHTML = bal + '<ul class="holdlist">' + items + '</ul>' +
    '<button id="claimall">claim all</button> ' + faucetBtn + '<p class="txstate"></p>';
}

holdingsEl.addEventListener('click', e => {
  const link = e.target.closest('.plotlink');
  if (link) {
    selected = Number(link.dataset.id);
    renderSel();
    schedule();
    return;
  }
  if (e.target.closest('#claimall')) {
    const ids = [];
    for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
    if (ids.length) doTx('claimMany', ids);
    return;
  }
  if (e.target.closest('#getutop')) doTx('faucet', []);
});

// ---- market ----

function renderMarket() {
  if (!basePrices) return;
  let cheapest = -1;
  let bestApy = -1;
  for (let i = 0; i < PLOTS; i++) {
    if (owned[i]) continue;
    if (cheapest < 0 || basePrices[i] < basePrices[cheapest]) cheapest = i;
    if (bestApy < 0 || apys[i] > apys[bestApy]) bestApy = i;
  }
  if (cheapest < 0) {
    marketEl.innerHTML = '<p class="quiet-note">every plot is owned. the city is sold out.</p>';
    return;
  }
  marketEl.innerHTML =
    '<div class="row"><span class="k">open plots</span><span class="v">' + (PLOTS - ownedCount) + '</span></div>' +
    '<div class="row"><span class="k">cheapest</span><span class="v"><span class="plotlink" data-id="' + cheapest + '">plot ' + cheapest + '</span> · ' + fmtUtop(priceNow(cheapest)) + '</span></div>' +
    '<div class="row"><span class="k">highest apy</span><span class="v"><span class="plotlink" data-id="' + bestApy + '">plot ' + bestApy + '</span> · ' + (apys[bestApy] / 100).toFixed(2) + '%</span></div>' +
    '<div class="row"><span class="k">multiplier</span><span class="v">' + fmtMult() + '</span></div>' +
    '<p class="quiet-note">prices and stock yield scale with UTOP’s market. the multiplier goes live when the token lists and the contract’s oracle points at its pool.</p>';
}

marketEl.addEventListener('click', e => {
  const link = e.target.closest('.plotlink');
  if (link) {
    selected = Number(link.dataset.id);
    renderSel();
    schedule();
  }
});

// ---- map interactions ----

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
  selected = pick(e);
  renderSel();
  schedule();
});

if (fine) {
  canvas.addEventListener('pointermove', e => {
    if (!loaded) return;
    const id = pick(e);
    hoverId = id;
    if (id >= 0) {
      const l1 = 'plot ' + id + (owned[id] ? (mine[id] ? ' · yours' : ' · owned') : ' · ' + fmtUtop(priceNow(id)));
      const l2 = (apys[id] / 100).toFixed(2) + '% apy · grows ' + SYMBOLS[tokIdx[id]];
      tip.show(e, l1, l2);
    } else tip.hide();
    schedule();
  });
  canvas.addEventListener('pointerleave', () => {
    hoverId = -1;
    tip.hide();
    schedule();
  });
}

// ---- lifecycle ----

setInterval(() => { if (loaded && !document.hidden) refreshOwnership().catch(() => {}); }, 15000);
setInterval(() => { if (loaded && !document.hidden && account) refreshClaimables().catch(() => {}); }, 10000);

window.addEventListener('resize', () => { fit(); schedule(); });

fit();
render();
load();
