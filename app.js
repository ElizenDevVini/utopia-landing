// Network-aware Utopia dashboard. Mainnet fails closed until the production
// deployment, provider, reserves, and eligibility flow are configured.

import {
  createPublicClient, createWalletClient, custom,
  defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=15';
import { BG, TOPS, HOVER_TOP, CLAIMED_TOP, IN, Z0, hash, makeTip } from './iso.js?v=15';
import { addressUrl, MULTICALL3, NET, resilientReadTransport, withNetwork } from './config.js?v=15';

const LAND = NET.land;
const UTOP = NET.utop;
const EXPLORER = NET.explorer;
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = NET.symbols;
const MINE_TOP = '#ffffff';
const WAD = 10n ** 18n;
const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const MAX_CLAIM_BATCH = 64;
// per-wallet purchase cap, enforced by the site (the next contract enforces it
// on-chain). Wallets already over the cap keep what they have; they just can't add
const MAX_PLOTS_PER_WALLET = 8;
function myPlotCount() {
  let n = 0;
  for (let i = 0; i < PLOTS; i++) n += mine[i];
  return n;
}
// utopia token — its balance is included as informational request context
const UTOPIA_TOKEN = '0x164d9da79722c5294369e79807980e0bff257777';
// retained historical contact constants; onboarding no longer sends users away
const ACCESS_HANDLE = '@Utopiadet';
const ACCESS_HANDLE_URL = 'https://x.com/Utopiadet';
// Google Apps Script destination for automatic Sheet collection
const ACCESS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxCTc6Njp2nRwfXo2t5SbH0jE-Ft9sV0LuQpCG-04ByPlXj1KCWneCp3BJtjjlxXHQP_w/exec';
const ACCESS_PENDING_COPY = 'setting up access for this wallet — takes about a minute. the buy button will appear on its own.';
const ELIGIBILITY_POLL_MS = 30000;
const ACCESS_POLL_MS = 10000;
const ACCESS_POLL_WINDOW_MS = 3 * 60 * 1000;
const CLAIMED_TOPIC = '0x3e356ee9071ea983e847cc7da7b8b224b8f44262f7c9ce77262ea0e854a5442c';

// districts: a center core + four quarters, each its own stock. Visual preview
// over the current contract; a redeploy makes the reward token match the region.
const DISTRICTS_ON = true;
const DISTRICTS = [
  { name: 'silicon heights', stock: 'NVDA', color: '#e3c67b' }, // center core
  { name: 'motorworks', stock: 'TSLA', color: '#6f9fd0' },
  { name: 'cupertino row', stock: 'AAPL', color: '#9ec4e8' },
  { name: 'the cloudworks', stock: 'MSFT', color: '#4d7db0' },
  { name: 'the marketplace', stock: 'AMZN', color: '#c3dcf3' },
];
const DISTRICT_CENTROIDS = [[15.5, 15.5], [7.5, 7.5], [23.5, 7.5], [7.5, 23.5], [23.5, 23.5]];

// preview skyline: named demo skyscrapers, shown only with ?demo in the URL so
// the live site never displays fake sold plots. real sold plots become towers.
const DEMO_SKYLINE = new URLSearchParams(location.search).has('demo');
const DEMO_PLOTS = [
  { x: 16, y: 16, name: 'the spire', h: 4.8 },
  { x: 14, y: 18, name: 'obsidian', h: 3.9 },
  { x: 18, y: 14, name: 'vertex', h: 3.3 },
  { x: 10, y: 6, name: 'atlas', h: 3.4 },
  { x: 24, y: 8, name: 'meridian', h: 3.7 },
  { x: 6, y: 21, name: 'nimbus', h: 2.9 },
  { x: 23, y: 24, name: 'bazaar', h: 3.2 },
  { x: 26, y: 20, name: 'onyx', h: 2.7 },
];
const demoById = new Map(DEMO_PLOTS.map(p => [p.y * 32 + p.x, p]));
function districtOf(x, y) {
  const dx = x - 15.5, dy = y - 15.5;
  if (dx * dx + dy * dy < 64) return 0; // center circle → NVDA
  if (dx < 0 && dy < 0) return 1;
  if (dx >= 0 && dy < 0) return 2;
  if (dx < 0 && dy >= 0) return 3;
  return 4;
}
// contract token index for a plot (matches UtopiaLandCity.tokenIndexOf):
// tokens = [TSLA, AAPL, NVDA, MSFT, AMZN]
function contractTokenOf(id) {
  if (NET.rewardMode < 5) return NET.rewardMode; // uniform: every plot one stock
  const x = id % SIDE, y = (id / SIDE) | 0;
  const dx = 2 * x - 31, dy = 2 * y - 31;
  if (dx * dx + dy * dy < 256) return 2;
  if (dx < 0 && dy < 0) return 0;
  if (dx >= 0 && dy < 0) return 1;
  if (dx < 0 && dy >= 0) return 3;
  return 4;
}

// open-plot tops by base value, cheap to premium; premium gets the gold
const TIER_TOPS = ['#dbe7f5', '#b9d3ec', '#8fb9e4', '#e3c67b'];
const TIERS = NET.payment === 'native'
  ? [15n * 10n ** 14n, 22n * 10n ** 14n, 3n * 10n ** 15n]
  : [150n * WAD, 220n * WAD, 300n * WAD];

const chain = defineChain({
  id: NET.chainId,
  name: NET.label,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

// what gets registered in the user's wallet: the official RPC, so their wallet
// never depends on our proxy being awake to send transactions
const walletChain = NET.walletRpc
  ? { ...chain, rpcUrls: { default: { http: [NET.walletRpc] } } }
  : chain;

const abi = parseAbi([
  'function buy(uint256 id) payable',
  'function claim(uint256 id)',
  'function claimMany(uint256[] ids)',
  'function claimable(uint256 id) view returns (uint256)',
  'function multiplierWad() view returns (uint256)',
  'function marketMultiplierWad() view returns (uint256)',
  'function ownershipBitmap() view returns (uint256[4])',
  'function plotsOf(address) view returns (uint256[4])',
  'function plotsPacked() view returns (uint256[1024])',
  'function tokens(uint256) view returns (address)',
  'function tokensPerEthWad(uint256) view returns (uint256)',
  'function tokensPerUtopWad(uint256) view returns (uint256)',
  'function totalCommittedByToken(uint256) view returns (uint256)',
  'function rewardEnd() view returns (uint64)',
  'function isEligible(address) view returns (bool)',
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function balanceOfUI(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function faucet()',
]);

// ---- building customization (UtopiaBuildings) ----
// owners paint/name/shape their plot; the map renders it. Free for plot owners.
const BUILDINGS = globalThis.UTOPIA_BUILDINGS || NET.buildings || '';
const buildingsAbi = parseAbi([
  'function setBuilding(uint256 id, uint24 color, uint8 style, uint8 height, string name)',
  'function getBuildings(uint256[] ids) view returns ((bool set,uint24 color,uint8 style,uint8 height)[], string[])',
]);
const BUILD_STYLES = ['tower', 'spire', 'low-rise', 'dome', 'plaza'];
const BUILD_COLORS = ['#e3c67b', '#d16b6b', '#8ec07c', '#5b8fd0', '#b46fd0', '#e0a458', '#5ec2c2', '#e9f2fb'];
let builds = new Array(PLOTS).fill(null); // {color, style, height, name} per plot

const pub = createPublicClient({
  chain,
  batch: { multicall: { wait: 16, batchSize: 4096 } },
  transport: resilientReadTransport(custom),
});

const canvas = document.getElementById('land');
const ctx = canvas.getContext('2d');
const statusEl = document.querySelector('.map-status');
const selEl = document.getElementById('sel');
const holdingsEl = document.querySelector('#holdings .body');
const marketEl = document.querySelector('#market .body');
const walletLink = document.getElementById('wallet');
const tip = makeTip(document.getElementById('tip'));
const fine = matchMedia('(pointer: fine)').matches;

const view = { w: 0, h: 0, s: 24, hz: 17, baseS: 24, ox: 0, oy: 0 };

// free-orbit camera: drag spins and tilts the city, wheel zooms at the
// cursor, double-click flies to a plot. The default matches the old fixed
// isometric framing (yaw 45°, 2:1 foreshortening).
const YAW0 = Math.PI / 4, PITCH0 = 0.5;
let yaw = YAW0;
let pitch = PITCH0; // ground foreshortening: low = street level, high = overhead
let zoom = 1;
let panX = 0, panY = 0;

let cosYaw = 1, sinYaw = 0, trigYaw = null;
const wallVisible = [false, false, false, false];
const wallColors = ['', '', '', ''];
const depth = new Float32Array(PLOTS);
const drawOrder = Array.from({ length: PLOTS }, (_, i) => i);

// wall outward normals, in the order of top corners
// c0=(x0,y0) c1=(x1,y0) c2=(x1,y1) c3=(x0,y1)
const WALL_N = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// shade endpoints chosen so the default angle reproduces the old two-tone
// walls (#33608f / #4d84c3)
const SHADE_DARK = [6, 34, 53], SHADE_LITE = [78, 134, 197];

function shade(t) {
  const k = Math.max(0, Math.min(1, t));
  return 'rgb(' + SHADE_DARK.map((d, i) => Math.round(d + (SHADE_LITE[i] - d) * k)).join(',') + ')';
}

function updateCamera() {
  if (trigYaw === yaw) return;
  trigYaw = yaw;
  cosYaw = Math.cos(yaw);
  sinYaw = Math.sin(yaw);
  // the light rides ~30° off the camera so at every orbit angle the two
  // visible walls split into a lit side and a shaded side
  const lx = Math.sin(yaw - 0.53), ly = Math.cos(yaw - 0.53);
  for (let i = 0; i < 4; i++) {
    const [nx, ny] = WALL_N[i];
    wallVisible[i] = nx * sinYaw + ny * cosYaw > 0.02;
    wallColors[i] = shade((nx * lx + ny * ly + 1) / 2);
  }
  for (let id = 0; id < PLOTS; id++) {
    depth[id] = ((id % SIDE) + 0.5 - 16) * sinYaw + (((id / SIDE) | 0) + 0.5 - 16) * cosYaw;
  }
  drawOrder.sort((a, b) => depth[a] - depth[b]); // far to near
}

function proj(x, y, z) {
  const dx = x - 16, dy = y - 16;
  const rx = dx * cosYaw - dy * sinYaw;
  const ry = dx * sinYaw + dy * cosYaw;
  return [view.ox + rx * view.s, view.oy + ry * view.s * pitch - z * view.hz];
}

// world ground-plane offset (from grid center) under a screen point
function groundAt(sx, sy) {
  const rx = (sx - view.ox) / view.s;
  const ry = (sy - view.oy) / (view.s * pitch);
  return [rx * cosYaw + ry * sinYaw, -rx * sinYaw + ry * cosYaw];
}

let basePrices = null; // bigint[] in configured payment-token wei
let apys = null;
let tokIdx = null;
let tiers = null; // Uint8Array 0..3
let owned = new Uint8Array(PLOTS);
let currentOwned = new Uint8Array(PLOTS);
let mine = new Uint8Array(PLOTS);
let ownedCount = 0;
let currentOwnedCount = 0;
const legacyLandForPlot = new Array(PLOTS).fill(null);
let currentMine = new Uint8Array(PLOTS);
let multiplier = WAD;
let loaded = false;
let account = null;
let walletClient = null;
let selected = -1;
let hoverId = -1;
let claimables = new Map();
let rates = null; // stock-wei streamed per payment-wei of price per year
let paymentBalance = null;
let treasuryBalances = null;
let treasuryCommitted = null;
let tokenAddresses = null;
let walletStockBalances = null;
let rewardEnd = null;
let accountEligible = null;
let eligibilityReadSequence = 0;
let eligibilityPollTimer = null;
let eligibilityPollGeneration = 0;
let expeditedEligibilityAddress = null;
let expeditedEligibilityUntil = 0;
const accessRequestMemory = new Map();
const pendingAccessAddresses = new Set();
const accessNoticeShown = new Set();

function priceNow(id) {
  return NET.landVersion === 2 ? (basePrices[id] * multiplier) / WAD : basePrices[id];
}

function fmtPrice(wei) {
  const n = Number(wei) / 1e18;
  const precision = NET.payment === 'native' ? 5 : 2;
  const symbol = NET.payment === 'native' ? 'ETH' : 'UTOP';
  return parseFloat(n.toFixed(precision)) + ' ' + symbol;
}

function fmtTok(wei, idx) {
  const n = Number(wei) / 1e18;
  const s = n === 0 ? '0' : n < 1e-6 ? n.toExponential(2) : parseFloat(n.toFixed(8)).toString();
  return s + ' ' + SYMBOLS[idx];
}

function short(addr) {
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

function fmtMult() {
  return (Number(multiplier) / 1e18).toFixed(2) + 'x';
}

// stock-wei a plot streams per year at current rates
function perYear(id) {
  if (!rates) return null;
  return (basePrices[id] * BigInt(apys[id]) * rates[tokIdx[id]] * multiplier) / (10000n * WAD * WAD);
}

// uncommitted reward reserve for a token index; null if not loaded yet
function tokenAvailable(idx) {
  if (!treasuryBalances) return null;
  const bal = treasuryBalances[idx];
  if (bal == null) return null; // read failed = unknown, not confirmed empty
  const com = treasuryCommitted?.[idx] ?? 0n;
  return bal > com ? bal - com : 0n;
}

// codex: reserve dust is not enough to sell a plot. Mirror the deployed
// contract's maxRewardForSale calculation so only purchases that can reserve
// their full remaining reward obligation are presented as buyable.
function reserveRequiredForSale(id) {
  if (NET.landVersion !== 4 || !rates || !rewardEnd || !basePrices) return null;
  const remaining = BigInt(rewardEnd) - BigInt(Math.floor(Date.now() / 1000));
  if (remaining <= 0n) return null;
  const annualizedPayment = (basePrices[id] * BigInt(apys[id]) * remaining) / (10000n * YEAR_SECONDS);
  return (annualizedPayment * rates[tokIdx[id]]) / WAD;
}

function reserveCoversPlot(id) {
  if (NET.landVersion === 4 && rewardEnd && BigInt(rewardEnd) <= BigInt(Math.floor(Date.now() / 1000))) return false;
  const available = tokenAvailable(tokIdx[id]);
  if (available == null) return null;
  const required = reserveRequiredForSale(id);
  return required == null ? available > 0n : available >= required;
}

function fundedTokenNames() {
  const out = [];
  for (let i = 0; i < 5; i++) {
    for (let id = 0; id < PLOTS; id++) {
      if (!owned[id] && tokIdx[id] === i && reserveCoversPlot(id) === true) {
        out.push(SYMBOLS[i]);
        break;
      }
    }
  }
  return out;
}

function formatRewardEnd() {
  if (!rewardEnd) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(Number(rewardEnd) * 1000)) + ' UTC';
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
  // fit the ground diamond at its widest (diagonal) orientation
  view.baseS = Math.min((w * 0.96) / (SIDE * 1.42), (h * 0.82) / (SIDE * 1.42 * PITCH0));
  view.s = view.baseS * zoom;
  view.hz = view.s * 0.82 * Math.sqrt(1 - pitch * pitch);
  view.ox = w / 2 + panX;
  view.oy = h * 0.52 + panY;
}

function zOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  if (!owned[id]) return 0.08;
  // an owner-set building height overrides the default skyline
  if (builds[id]) return 0.6 + builds[id].height * 0.55 + (builds[id].style === 1 ? 0.8 : 0);
  // sold plots rise as skyscrapers — deterministic height so everyone sees the
  // same skyline, taller toward the center
  const near = Math.exp(-((x - 15.5) ** 2 + (y - 15.5) ** 2) / 260);
  return 1.3 + hash(x + 7, y + 13) * 1.8 + near * 1.6;
}

// footprint inset per style: spire is slim, plaza is flat-wide, dome mid
function styleInset(id) {
  const c = builds[id];
  if (!c) return IN;
  if (c.style === 1) return 0.28; // spire
  if (c.style === 3) return 0.16; // dome
  if (c.style === 4) return 0.02; // plaza (near full footprint, kept low by height)
  return IN; // tower / low-rise
}

function drawBox(x0, y0, x1, y1, z, top) {
  const p0 = proj(x0, y0, z), p1 = proj(x1, y0, z), p2 = proj(x1, y1, z), p3 = proj(x0, y1, z);
  const p = [p0, p1, p2, p3];
  const drop = (z - Z0) * view.hz;
  for (let i = 0; i < 4; i++) {
    if (!wallVisible[i]) continue;
    const a = p[i], b = p[(i + 1) % 4];
    ctx.fillStyle = wallColors[i];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.lineTo(b[0], b[1] + drop); ctx.lineTo(a[0], a[1] + drop);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]);
  ctx.closePath();
  ctx.fill();
}

function render() {
  updateCamera();
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
  for (const id of drawOrder) {
    const x = id % SIDE, y = (id / SIDE) | 0;
    const demo = DEMO_SKYLINE ? demoById.get(id) : null;
    let z = demo ? demo.h : zOf(id);
    let top;
    if (demo) top = MINE_TOP;
    else if (owned[id] && builds[id]) top = builds[id].color; // owner-painted
    else if (owned[id]) top = mine[id] ? MINE_TOP : CLAIMED_TOP;
    else if (DISTRICTS_ON) top = DISTRICTS[districtOf(x, y)].color;
    else top = tiers ? TIER_TOPS[tiers[id]] : TOPS[(hash(x, y) * 997) % 3 | 0];
    if (id === selected) z += 0.35;
    if (id === hoverId && id !== selected) top = HOVER_TOP;
    const inset = owned[id] ? styleInset(id) : IN;
    drawBox(x + inset, y + inset, x + 1 - inset, y + 1 - inset, z, top);
  }
  if (DISTRICTS_ON) drawDistrictLabels();
  drawBuildingLabels();
  if (DEMO_SKYLINE) drawSkylineLabels();
}

// building names float above owner-customized plots. names are nudged upward
// when they would collide so a dense cluster reads as a stack, not a smear.
function drawBuildingLabels() {
  const labels = [];
  for (let id = 0; id < PLOTS; id++) {
    const c = builds[id];
    if (!c || !c.name) continue;
    const x = id % SIDE, y = (id / SIDE) | 0;
    const [sx, sy] = proj(x + 0.5, y + 0.5, zOf(id) + 0.5);
    labels.push({ name: c.name, sx, sy, order: depth[id] });
  }
  if (!labels.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = Math.max(10, view.s * 0.7);
  ctx.font = '600 ' + fs + "px 'Archivo', sans-serif";
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fs * 0.22);
  const lineH = fs * 1.2;
  // front rows (higher x+y) placed last so they win the readable slot up top
  labels.sort((a, b) => a.order - b.order);
  const placed = [];
  for (const L of labels) {
    const w = ctx.measureText(L.name).width;
    let ty = L.sy;
    for (let i = 0; i < 40; i++) {
      const clash = placed.some(p => Math.abs(p.x - L.sx) < (p.w + w) / 2 + 4 && Math.abs(p.y - ty) < lineH);
      if (!clash) break;
      ty -= lineH;
    }
    placed.push({ x: L.sx, y: ty, w });
    ctx.strokeStyle = 'rgba(8,24,44,0.92)';
    ctx.strokeText(L.name, L.sx, ty);
    ctx.fillStyle = '#f2f7fd';
    ctx.fillText(L.name, L.sx, ty);
  }
  ctx.restore();
}

function drawSkylineLabels() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "600 " + Math.max(9, view.s * 0.7) + "px 'Archivo', sans-serif";
  for (const p of DEMO_PLOTS) {
    const [sx, sy] = proj(p.x + 0.5, p.y + 0.5, p.h + 0.7);
    ctx.fillStyle = 'rgba(12,35,64,0.9)';
    ctx.fillText(p.name, sx + 1, sy + 1);
    ctx.fillStyle = '#e9f2fb';
    ctx.fillText(p.name, sx, sy);
  }
  ctx.restore();
}

function drawDistrictLabels() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "600 " + Math.max(11, view.s * 0.88) + "px 'Instrument Serif', serif";
  for (let i = 0; i < DISTRICTS.length; i++) {
    const [sx, sy] = proj(DISTRICT_CENTROIDS[i][0], DISTRICT_CENTROIDS[i][1], 1.6);
    ctx.fillStyle = 'rgba(12,35,64,0.85)';
    ctx.fillText(DISTRICTS[i].name, sx + 1, sy + 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(DISTRICTS[i].name, sx, sy);
  }
  ctx.restore();
}

let raf = 0;
function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}

// ---- chain reads ----

// plot attributes are deterministic (keccak of the id) and identical to the
// contract's priceOf/apyBpsOf/tokenIndexOf — compute them locally so the map
// loads instantly without a heavy plotsPacked RPC call
function h256(salt, id) {
  return BigInt(keccak256(encodePacked(['string', 'uint256'], [salt, BigInt(id)])));
}
function loadStatic() {
  basePrices = new Array(PLOTS);
  apys = new Uint16Array(PLOTS);
  tokIdx = new Uint8Array(PLOTS);
  tiers = new Uint8Array(PLOTS);
  for (let id = 0; id < PLOTS; id++) {
    const x = id % SIDE, y = (id / SIDE) | 0;
    const base = 500000000000000n + (h256('utopia/price/v1', id) % 2000000000000000n);
    const premium = (2500000000000000n * 300n) / (300n + BigInt(x * x + y * y));
    const raw = base + premium;
    basePrices[id] = raw - (raw % 10000000000000n);
    apys[id] = Number(310n + (h256('utopia/apy/v1', id) % 271n));
    tokIdx[id] = contractTokenOf(id);
    let t = TIERS.findIndex(v => basePrices[id] < v);
    tiers[id] = t < 0 ? 3 : t;
  }
}

async function refreshTreasury() {
  if (!NET.ready) return;
  if (!tokenAddresses) {
    tokenAddresses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
      pub.readContract({ address: LAND, abi, functionName: 'tokens', args: [BigInt(i)] })
    ));
  }
  const readBal = token => pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [LAND] }).catch(() => null);
  const [balances, committed, end] = await Promise.all([
    Promise.all(tokenAddresses.map(readBal)),
    NET.landVersion === 4
      ? Promise.all(Array.from({ length: 5 }, (_, i) =>
        pub.readContract({ address: LAND, abi, functionName: 'totalCommittedByToken', args: [BigInt(i)] }).catch(() => null)
      ))
      : Promise.resolve(null),
    NET.landVersion === 4
      ? pub.readContract({ address: LAND, abi, functionName: 'rewardEnd' }).catch(() => rewardEnd)
      : Promise.resolve(null),
  ]);
  // one retry for any balance the flaky public RPC dropped, so a transient
  // failure never gets shown to visitors as an empty treasury
  if (balances.some(b => b == null)) {
    await Promise.all(balances.map(async (b, i) => {
      if (b == null) balances[i] = await readBal(tokenAddresses[i]);
    }));
  }
  treasuryBalances = balances;
  treasuryCommitted = committed;
  rewardEnd = end;
  await refreshWalletStocks();
  renderMarket();
}

async function refreshWalletStocks() {
  if (!account || !tokenAddresses) {
    walletStockBalances = null;
    renderHoldings();
    return;
  }
  walletStockBalances = await Promise.all(tokenAddresses.map(async token => {
    try {
      return await pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOfUI', args: [account] });
    } catch {
      return pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    }
  }));
  renderHoldings();
}

function accessRequestKey(address) {
  return 'utopia:req:' + address.toLowerCase();
}

function storedAccessRequestAt(address) {
  const normalized = address.toLowerCase();
  let stored = accessRequestMemory.get(normalized) || 0;
  try {
    const value = Number(localStorage.getItem(accessRequestKey(normalized)) || 0);
    if (Number.isFinite(value) && value > stored) stored = value;
  } catch {}
  return stored;
}

function rememberAccessRequest(address, requestedAt) {
  const normalized = address.toLowerCase();
  accessRequestMemory.set(normalized, requestedAt);
  try { localStorage.setItem(accessRequestKey(normalized), String(requestedAt)); } catch {}
}

function eligibilityPollDelay() {
  const normalized = account?.toLowerCase();
  return normalized && normalized === expeditedEligibilityAddress && Date.now() < expeditedEligibilityUntil
    ? ACCESS_POLL_MS
    : ELIGIBILITY_POLL_MS;
}

function scheduleEligibilityPoll(delay = eligibilityPollDelay()) {
  const generation = ++eligibilityPollGeneration;
  if (eligibilityPollTimer) clearTimeout(eligibilityPollTimer);
  eligibilityPollTimer = setTimeout(async () => {
    eligibilityPollTimer = null;
    if (loaded && !document.hidden && account) await refreshEligibility().catch(() => {});
    // A request or successful unlock may have replaced this schedule while the
    // read was in flight. Only the newest scheduler is allowed to continue.
    if (generation === eligibilityPollGeneration) scheduleEligibilityPoll();
  }, delay);
}

function watchPendingAccess(address, requestedAt) {
  const normalized = address.toLowerCase();
  pendingAccessAddresses.add(normalized);
  if (account?.toLowerCase() !== normalized) return;
  const requestDeadline = requestedAt + ACCESS_POLL_WINDOW_MS;
  const continuingSameAddress = expeditedEligibilityAddress === normalized;
  expeditedEligibilityAddress = normalized;
  expeditedEligibilityUntil = continuingSameAddress
    ? Math.max(expeditedEligibilityUntil, requestDeadline)
    : requestDeadline;
  if (Date.now() < expeditedEligibilityUntil) scheduleEligibilityPoll(ACCESS_POLL_MS);
}

function maybeAutoRequestAccess(address) {
  if (!ACCESS_WEBHOOK || !address || accountEligible !== false) return;
  const normalized = address.toLowerCase();
  const existingRequestAt = storedAccessRequestAt(normalized);
  if (existingRequestAt) {
    if (Date.now() < existingRequestAt + ACCESS_POLL_WINDOW_MS) watchPendingAccess(normalized, existingRequestAt);
    return;
  }

  // codex: persist before any balance read or fire-and-forget request so a
  // reload, duplicate refresh, or accountsChanged race cannot submit twice.
  const requestedAt = Date.now();
  rememberAccessRequest(normalized, requestedAt);
  watchPendingAccess(normalized, requestedAt);
  requestAccess(null, { automatic: true, address: normalized, requestedAt }).catch(() => {});
}

function showAccessActiveNote(address) {
  const normalized = address.toLowerCase();
  if (accessNoticeShown.has(normalized)) return;
  accessNoticeShown.add(normalized);
  const note = document.createElement('p');
  note.className = 'quiet-note';
  note.textContent = 'access active — you can buy now';
  selEl.append(note);
}

async function refreshEligibility() {
  const checkedAddress = account?.toLowerCase() || null;
  const sequence = ++eligibilityReadSequence;
  let eligibility;
  if (!NET.requiresEligibility || !checkedAddress) {
    eligibility = NET.requiresEligibility ? null : true;
  } else {
    // null = read failed / unknown (don't hard-block or submit); true/false = confirmed
    eligibility = await pub.readContract({
      address: LAND, abi, functionName: 'isEligible', args: [checkedAddress],
    }).catch(() => null);
  }
  if (sequence !== eligibilityReadSequence || (account?.toLowerCase() || null) !== checkedAddress) return;
  accountEligible = eligibility;
  renderHoldings();
  if (selected >= 0) renderSel();
  if (accountEligible === false && checkedAddress) maybeAutoRequestAccess(checkedAddress);
  if (accountEligible === true && checkedAddress && pendingAccessAddresses.has(checkedAddress)) {
    pendingAccessAddresses.delete(checkedAddress);
    if (expeditedEligibilityAddress === checkedAddress) {
      expeditedEligibilityAddress = null;
      expeditedEligibilityUntil = 0;
      scheduleEligibilityPoll(ELIGIBILITY_POLL_MS);
    }
    if (selected < 0) renderSel();
    showAccessActiveNote(checkedAddress);
  }
}

function orBits(words, out) {
  for (let i = 0; i < PLOTS; i++) {
    if ((words[i >> 8] >> BigInt(i & 255)) & 1n) out[i] = 1;
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
  unpackBits(bm, currentOwned);
  owned.set(currentOwned);
  currentOwnedCount = currentOwned.reduce((a, b) => a + b, 0);
  legacyLandForPlot.fill(null);
  // merge in plots bought on earlier contracts so nobody's purchase disappears
  for (const legacy of NET.legacyLands || []) {
    try {
      const lbm = await pub.readContract({ address: legacy, abi, functionName: 'ownershipBitmap' });
      orBits(lbm, owned);
      // codex: retain the source contract so legacy deeds never masquerade as
      // current reward-bearing plots in selection and holdings views.
      for (let i = 0; i < PLOTS; i++) {
        if (!currentOwned[i] && ((lbm[i >> 8] >> BigInt(i & 255)) & 1n)) legacyLandForPlot[i] ||= legacy;
      }
    } catch {}
  }
  ownedCount = owned.reduce((a, b) => a + b, 0);
  if (account) {
    const [my, bal] = await Promise.all([
      pub.readContract({ address: LAND, abi, functionName: 'plotsOf', args: [account] }),
      NET.payment === 'native'
        ? pub.getBalance({ address: account })
        : pub.readContract({ address: UTOP, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    ]);
    unpackBits(my, currentMine);
    mine.set(currentMine);
    // your plots on earlier contracts count as yours too
    for (const legacy of NET.legacyLands || []) {
      try {
        const lmy = await pub.readContract({ address: legacy, abi, functionName: 'plotsOf', args: [account] });
        orBits(lmy, mine);
      } catch {}
    }
    paymentBalance = bal;
  } else {
    mine.fill(0);
    currentMine.fill(0);
    paymentBalance = null;
  }
  const contractLink = document.createElement('a');
  contractLink.href = addressUrl(LAND);
  contractLink.target = '_blank';
  contractLink.rel = 'noopener';
  contractLink.textContent = 'contract';
  const multiplierText = NET.landVersion === 2 || NET.landVersion === 3
    ? ' · market multiplier ' + fmtMult() : '';
  statusEl.replaceChildren(
    document.createTextNode(ownedCount + ' of 1,024 plots owned · ' + NET.label + multiplierText + ' · '),
    contractLink,
  );
  renderMarket();
  renderHoldings();
  schedule();
  refreshBuildings().catch(() => {});
}

// read owner-set customizations for every owned plot (one batched call)
async function refreshBuildings() {
  if (!BUILDINGS) return;
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (owned[i]) ids.push(i);
  if (!ids.length) return;
  try {
    const [bs, ns] = await pub.readContract({
      address: BUILDINGS, abi: buildingsAbi, functionName: 'getBuildings', args: [ids.map(BigInt)],
    });
    builds = new Array(PLOTS).fill(null);
    ids.forEach((id, i) => {
      const b = bs[i];
      if (b.set) {
        builds[id] = {
          color: '#' + Number(b.color).toString(16).padStart(6, '0'),
          style: Number(b.style), height: Number(b.height), name: ns[i] || '',
        };
      }
    });
    if (selected >= 0) renderSel();
    schedule();
  } catch {}
}

async function refreshClaimables() {
  if (!NET.ready) return;
  const ids = [];
  // codex: current LAND cannot claim IDs that exist only on a legacy contract.
  for (let i = 0; i < PLOTS; i++) if (currentMine[i]) ids.push(i);
  const vals = await Promise.all(ids.map(id =>
    pub.readContract({ address: LAND, abi, functionName: 'claimable', args: [BigInt(id)] }).catch(() => null)
  ));
  claimables = new Map(ids.map((id, i) => [id, vals[i]]));
  renderHoldings();
  if (selected >= 0 && mine[selected]) renderSel();
}

async function loadRates() {
  const getter = NET.payment === 'native' ? 'tokensPerEthWad' : 'tokensPerUtopWad';
  rates = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    pub.readContract({ address: LAND, abi, functionName: getter, args: [BigInt(i)] })
  ));
}

async function load() {
  if (!NET.ready) return;
  if (!basePrices) loadStatic(); // local + instant, no RPC
  loaded = true; // map is interactive immediately; ownership paints in when it lands
  schedule();
  // ownership is a tiny call, but the public RPC can be slow — retry, never block
  refreshOwnership().catch(() => setTimeout(() => refreshOwnership().catch(() => {}), 8000));
  if (!rates) loadRates().catch(() => {});
  refreshTreasury().catch(() => {});
  refreshEligibility().catch(() => {});
  refreshClaimables().catch(() => {});
}

// ---- wallet (EIP-6963 multi-wallet discovery: MetaMask, Phantom, Rabby, …) ----

const wallets = new Map(); // rdns -> { info, provider }
let provider = null; // the chosen EIP-1193 provider
let eventsAttached = false;

window.addEventListener('eip6963:announceProvider', e => {
  const { info, provider: p } = e.detail;
  wallets.set(info.rdns, { info, provider: p });
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

function discovered() {
  const list = [...wallets.values()];
  // fall back to a legacy injected provider if nothing announced via 6963
  if (!list.length && window.ethereum) {
    list.push({ info: { name: window.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', rdns: 'injected' }, provider: window.ethereum });
  }
  return list;
}

// re-ask for providers and give late-injecting wallets (Rabby, in-app browsers)
// a moment to announce — the one-shot request at load misses them
async function collectWallets() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r => setTimeout(r, 300));
  return discovered();
}

function walletClientFor(p) {
  return createWalletClient({ chain, transport: custom(p) });
}

function walletErrorCode(err) {
  let current = err;
  for (let i = 0; i < 6 && current; i++) {
    if (typeof current.code === 'number') return current.code;
    current = current.cause;
  }
  return null;
}

async function ensureWalletChain(wallet) {
  if (await wallet.getChainId() === chain.id) return;
  try {
    await wallet.switchChain({ id: chain.id });
  } catch (err) {
    if (walletErrorCode(err) !== 4902) throw err;
    await wallet.addChain({ chain: walletChain });
    await wallet.switchChain({ id: chain.id });
  }
}

// show a small in-panel picker when more than one wallet is installed
function showWalletPicker() {
  const list = discovered();
  const buttons = list.map(w =>
    '<button class="wallet-pick" data-rdns="' + w.info.rdns + '">' + w.info.name + '</button>'
  ).join(' ');
  selEl.innerHTML = '<h3>connect a wallet</h3><p class="quiet-note">pick one to continue.</p>' + buttons;
}

selEl.addEventListener('click', async e => {
  const pick = e.target.closest('.wallet-pick');
  if (!pick) return;
  const found = discovered().find(w => w.info.rdns === pick.dataset.rdns);
  if (found) {
    provider = found.provider;
    try { await connect({ prompt: true }); }
    catch (err) { txState(walletErrorCode(err) === 4001 ? 'connection cancelled.' : 'wallet connection failed.', selEl); }
  }
});

function attachProviderEvents(p) {
  if (eventsAttached || !p.on) return;
  eventsAttached = true;
  p.on('accountsChanged', async accs => {
    account = accs[0] || null;
    walletLink.textContent = account ? short(account) : 'connect wallet';
    claimables.clear();
    walletStockBalances = null;
    accountEligible = NET.requiresEligibility ? null : true;
    if (NET.ready) {
      await Promise.all([
        refreshOwnership().catch(() => {}),
        refreshEligibility().catch(() => {}),
        refreshWalletStocks().catch(() => {}),
      ]);
    }
    if (NET.ready && account) await refreshClaimables().catch(() => {});
  });
  p.on('chainChanged', chainIdHex => {
    if (Number(chainIdHex) !== chain.id) {
      account = null;
      mine.fill(0);
      currentMine.fill(0);
      claimables.clear();
      walletStockBalances = null;
      accountEligible = NET.requiresEligibility ? null : true;
      walletLink.textContent = 'switch network';
      renderHoldings();
      schedule();
    } else {
      connect({ prompt: false }).catch(() => {});
    }
  });
  p.on('disconnect', () => {
    account = null;
    mine.fill(0);
    currentMine.fill(0);
    claimables.clear();
    walletStockBalances = null;
    accountEligible = NET.requiresEligibility ? null : true;
    walletLink.textContent = 'connect wallet';
    renderHoldings();
    schedule();
  });
}

async function connect({ prompt = true } = {}) {
  if (!NET.ready) {
    selEl.innerHTML = '<h3>mainnet pending</h3><p class="quiet-note">' +
      NET.activationIssue + '. the preview city remains available.</p>';
    return null;
  }
  // on an explicit connect, re-poll so late wallets (Rabby, in-app browsers) show
  const list = prompt ? await collectWallets() : discovered();
  if (!list.length) {
    selEl.innerHTML = '<h3>no wallet</h3><p class="quiet-note">install MetaMask, Rabby, or Phantom to buy. the map stays readable without one.</p>';
    return null;
  }
  // if the user hasn't chosen yet and several are installed, ask which
  if (!provider) {
    if (list.length === 1) provider = list[0].provider;
    else if (prompt) { showWalletPicker(); return null; }
    else return null;
  }
  const wallet = walletClientFor(provider);
  attachProviderEvents(provider);
  const addresses = prompt ? await wallet.requestAddresses() : await wallet.getAddresses();
  const addr = addresses[0];
  if (!addr) return null;
  await ensureWalletChain(wallet);
  walletClient = wallet;
  account = addr;
  walletLink.textContent = short(addr);
  await Promise.all([refreshOwnership(), refreshEligibility(), refreshWalletStocks()]);
  await refreshClaimables();
  return wallet;
}

walletLink.addEventListener('click', async e => {
  e.preventDefault();
  try {
    await connect({ prompt: !account });
  } catch (err) {
    const message = walletErrorCode(err) === 4001 ? 'connection cancelled.' : 'wallet connection failed.';
    txState(message, selEl);
  }
});

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
  if (owned[id] && !currentOwned[id]) {
    const legacyLand = legacyLandForPlot[id];
    const relationship = mine[id] ? 'yours · legacy deed' : 'owned · legacy deed';
    const deedLink = legacyLand
      ? '<p><a href="' + EXPLORER + '/token/' + legacyLand + '/instance/' + id +
        '" target="_blank" rel="noopener">legacy deed on the explorer</a></p>'
      : '';
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · ' + relationship + '</h3>' +
      '<p class="quiet-note">This plot remains visible from an earlier land contract. It is not part of the current contract’s reward stream or claim batch.</p>' +
      deedLink;
    return;
  }
  const yr = perYear(id);
  const streams = yr != null
    ? '<div class="row"><span class="k">streams</span><span class="v">' + fmtTok(yr, tokIdx[id]) + ' / year</span></div>'
    : '';
  const rows =
    '<div class="row"><span class="k">price</span><span class="v">' + fmtPrice(priceNow(id)) + '</span></div>' +
    '<div class="row"><span class="k">base reward rate</span><span class="v">' + (apys[id] / 100).toFixed(2) + '%</span></div>' +
    '<div class="row"><span class="k">reward token</span><span class="v">' + SYMBOLS[tokIdx[id]] + '</span></div>' +
    streams;
  if (!owned[id]) {
    // per-wallet cap: keep the city distributed instead of swept by a few
    // wallets. UI-enforced on this contract; the next contract enforces on-chain.
    if (account && myPlotCount() >= MAX_PLOTS_PER_WALLET) {
      selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
        '<p class="quiet-note">you hold ' + myPlotCount() + ' plots — the per-wallet limit is ' +
        MAX_PLOTS_PER_WALLET + ' for now, so more of the city goes around.</p>';
      return;
    }
    // this plot's reward token must have reserve, or the buy reverts on-chain
    const unfunded = reserveCoversPlot(id) === false;
    // only hard-block when eligibility is *confirmed* false; an unknown/failed
    // read must not hide the buy button from an actually-eligible wallet
    const needsAccess = account && NET.requiresEligibility && accountEligible === false;
    if (unfunded) {
      const funded = fundedTokenNames();
      selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
        '<p class="quiet-note">' + SYMBOLS[tokIdx[id]] + ' rewards aren’t funded yet, so this plot can’t be bought right now.' +
        (funded.length ? ' fundable now: ' + funded.join(', ') + ' plots.' : '') + '</p>';
    } else {
      const label = needsAccess
        ? 'setting up access…'
        : account ? 'buy for ' + fmtPrice(priceNow(id)) : 'connect wallet to buy';
      selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
        '<button id="' + (needsAccess ? 'reqaccess' : 'act') + '" data-act="buy">' + label + '</button>' +
        (needsAccess ? '<p class="quiet-note">' + ACCESS_PENDING_COPY + '</p>' : '') +
        '<p class="txstate"></p>';
    }
  } else if (mine[id]) {
    const c = claimables.get(id);
    // codex: unknown means the public RPC read failed; contract simulation is
    // authoritative, so only a confirmed false eligibility result blocks UI.
    const blocked = NET.requiresEligibility && accountEligible === false;
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · yours</h3>' + rows +
      '<div class="row"><span class="k">claimable</span><span class="v">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></div>' +
      '<button id="act" data-act="claim"' + (blocked ? ' disabled' : '') + '>' +
      (blocked ? 'eligibility required to claim' : 'claim rewards') + '</button>' +
      (blocked ? '<p><a href="#" id="reqaccess">setting up access…</a></p><p class="quiet-note">' + ACCESS_PENDING_COPY + '</p>' : '') +
      // The building contract checks ownership on the current land contract;
      // legacy deeds remain visible but cannot customize through this panel.
      (BUILDINGS && currentMine[id] ? buildFormHtml(id) : '') +
      '<p class="txstate"></p>';
  } else {
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · owned</h3>' + rows +
      '<p><a href="' + EXPLORER + '/token/' + LAND + '/instance/' + id + '" target="_blank" rel="noopener">deed on the explorer</a></p>';
  }
}

// the customize-your-building panel, shown on a plot you own
function buildFormHtml(id) {
  const cur = builds[id] || { color: BUILD_COLORS[0], style: 0, height: 3, name: '' };
  const swatches = BUILD_COLORS.map(c =>
    '<button class="swatch' + (cur.color === c ? ' on' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>').join('');
  const styles = BUILD_STYLES.map((s, i) =>
    '<option value="' + i + '"' + (cur.style === i ? ' selected' : '') + '>' + s + '</option>').join('');
  return '<details class="build-panel"' + (builds[id] ? '' : '') + '><summary>customize your building</summary>' +
    '<div class="build-body" data-plot="' + id + '">' +
      '<label class="build-label">color</label><div class="swatches">' + swatches + '</div>' +
      '<label class="build-label">style</label><select class="build-style">' + styles + '</select>' +
      '<label class="build-label">height <span class="hval">' + cur.height + '</span></label>' +
        '<input class="build-height" type="range" min="1" max="6" value="' + cur.height + '">' +
      '<label class="build-label">name</label>' +
        '<input class="build-name" type="text" maxlength="24" placeholder="the spire" value="' + (cur.name || '').replace(/"/g, '&quot;') + '">' +
      '<button class="build-go" data-build="' + id + '">build</button>' +
    '</div></details>';
}

function txRoot(act) {
  return act === 'claimMany' || act === 'faucet' ? holdingsEl : selEl;
}

function txState(msg, root = selEl) {
  const el = root.querySelector('.txstate');
  if (el) el.textContent = msg;
}

function txPending(hash_, root) {
  const el = root.querySelector('.txstate');
  if (!el) return;
  const link = document.createElement('a');
  link.href = EXPLORER + '/tx/' + hash_;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = short(hash_);
  el.replaceChildren(document.createTextNode('pending · '), link);
}

function requireSuccessfulReceipt(receipt, action) {
  if (receipt.status !== 'success') throw new Error(action + ' transaction reverted');
}

function decodeClaimed(receipt) {
  if (!LAND) return [];
  return receipt.logs.flatMap(log => {
    if (log.address.toLowerCase() !== LAND.toLowerCase() || log.topics[0] !== CLAIMED_TOPIC) return [];
    const data = log.data.slice(2);
    if (data.length < 192 || !log.topics[1]) return [];
    const id = Number(BigInt(log.topics[1]));
    return [{
      id,
      paid: BigInt('0x' + data.slice(64, 128)),
      stillOwed: BigInt('0x' + data.slice(128, 192)),
      tokenIndex: tokIdx[id],
    }];
  });
}

function claimSummary(receipt) {
  const claims = decodeClaimed(receipt);
  if (!claims.length) return 'claim confirmed; payout event unavailable.';
  const totals = new Map();
  for (const claim of claims) {
    const total = totals.get(claim.tokenIndex) || { paid: 0n, owed: 0n };
    total.paid += claim.paid;
    total.owed += claim.stillOwed;
    totals.set(claim.tokenIndex, total);
  }
  const paid = [];
  const owedNow = [];
  for (const [idx, total] of totals) {
    if (total.paid > 0n) paid.push(fmtTok(total.paid, idx));
    if (total.owed > 0n) owedNow.push(fmtTok(total.owed, idx));
  }
  const paidText = paid.length ? 'paid ' + paid.join(' + ') : 'no tokens paid';
  return owedNow.length ? paidText + ' · still owed ' + owedNow.join(' + ') : paidText + '.';
}

async function doTx(act, ids, trigger) {
  const btn = trigger || null;
  let root = txRoot(act);
  try {
    const wallet = await connect({ prompt: !account });
    if (!wallet) return;
    root = txRoot(act);
    if (NET.requiresEligibility && accountEligible === false && act !== 'faucet') {
      txState('this wallet is not currently eligible.', root);
      return;
    }
    if (btn) btn.disabled = true;
    let hash_;
    if (act === 'buy') {
      const id = ids[0];
      if (myPlotCount() >= MAX_PLOTS_PER_WALLET) {
        txState('per-wallet limit of ' + MAX_PLOTS_PER_WALLET + ' plots reached.', root);
        if (btn) btn.disabled = false;
        return;
      }
      const price = priceNow(id);
      if (paymentBalance != null && paymentBalance < price) {
        const message = NET.payment === 'native'
          ? NET.key === 'mainnet'
            ? 'not enough ETH for this plot and gas.'
            : 'not enough preview ETH. use the faucet link below.'
          : NET.utopFaucet
            ? 'not enough UTOP. use “get 1,000 UTOP” below.'
            : 'not enough UTOP in this wallet.';
        txState(message, root);
        if (btn) btn.disabled = false;
        return;
      }
      if (NET.payment === 'utop') {
        const allowance = await pub.readContract({
          address: UTOP, abi: erc20Abi, functionName: 'allowance', args: [account, LAND],
        });
        if (allowance < price) {
          txState('step 1 of 2 · approve UTOP in your wallet…', root);
          const approvalHash = await wallet.writeContract({
            address: UTOP, abi: erc20Abi, functionName: 'approve', args: [LAND, price], account,
          });
          const approvalReceipt = await pub.waitForTransactionReceipt({ hash: approvalHash });
          requireSuccessfulReceipt(approvalReceipt, 'approval');
        }
      }
      txState('confirm the buy in your wallet…', root);
      const { request } = await pub.simulateContract({
        address: LAND,
        abi,
        functionName: 'buy',
        args: [BigInt(id)],
        ...(NET.payment === 'native' ? { value: price } : {}),
        account,
      });
      hash_ = await wallet.writeContract(request);
    } else if (act === 'claim') {
      const { request } = await pub.simulateContract({
        address: LAND, abi, functionName: 'claim', args: [BigInt(ids[0])], account,
      });
      hash_ = await wallet.writeContract(request);
    } else if (act === 'claimMany') {
      const { request } = await pub.simulateContract({
        address: LAND, abi, functionName: 'claimMany', args: [ids.map(BigInt)], account,
      });
      hash_ = await wallet.writeContract(request);
    } else {
      hash_ = await wallet.writeContract({ address: UTOP, abi: erc20Abi, functionName: 'faucet', account });
    }
    txPending(hash_, root);
    const receipt = await pub.waitForTransactionReceipt({ hash: hash_ });
    requireSuccessfulReceipt(receipt, act);
    // the receipt already proves the buy succeeded — mark the plot owned now so
    // it renders as the buyer's tower instantly, even if the follow-up read lags
    if (act === 'buy') {
      owned[ids[0]] = 1;
      currentOwned[ids[0]] = 1;
      mine[ids[0]] = 1;
      currentMine[ids[0]] = 1;
      ownedCount = owned.reduce((a, b) => a + b, 0);
      currentOwnedCount = currentOwned.reduce((a, b) => a + b, 0);
    }
    await refreshTreasury();
    await Promise.all([refreshOwnership(), refreshEligibility()]);
    // re-assert after refresh in case the node's plotsOf read hadn't caught up
    if (act === 'buy') {
      owned[ids[0]] = 1;
      currentOwned[ids[0]] = 1;
      mine[ids[0]] = 1;
      currentMine[ids[0]] = 1;
    }
    await refreshClaimables();
    renderSel();
    schedule();
    root = txRoot(act);
    const success = act === 'buy'
      ? 'yours. the block just rose.'
      : act === 'faucet' ? '1,000 UTOP received.' : claimSummary(receipt);
    txState(success, root);
  } catch (err) {
    if (btn) btn.disabled = false;
    const m = (err?.shortMessage || err?.message || 'failed').split('\n')[0];
    // a NotEligible revert means the wallet isn't enrolled; route to the access
    // request instead of leaving a raw revert string
    if (/eligib|NotEligible|not eligible/i.test(m)) {
      accountEligible = false;
      renderSel();
      txState('setting up access for this wallet — the buy button will appear on its own.', root);
      return;
    }
    txState(/rejected|denied/i.test(m) ? 'cancelled.' : m.toLowerCase().slice(0, 240), root);
  }
}

selEl.addEventListener('click', e => {
  const req = e.target.closest('#reqaccess');
  if (req) { e.preventDefault(); requestAccess(req); return; }
  const swatch = e.target.closest('.swatch');
  if (swatch) {
    for (const s of selEl.querySelectorAll('.swatch')) s.classList.toggle('on', s === swatch);
    return;
  }
  const build = e.target.closest('.build-go');
  if (build) { e.preventDefault(); submitBuilding(Number(build.dataset.build), build); return; }
  const btn = e.target.closest('#act');
  if (btn && selected >= 0) doTx(btn.dataset.act, [selected], btn);
});
selEl.addEventListener('input', e => {
  const h = e.target.closest('.build-height');
  if (h) { const v = h.parentElement.parentElement.querySelector('.hval'); if (v) v.textContent = h.value; }
});

// collect the form, approve $utopia if needed, then setBuilding
async function submitBuilding(id, btn) {
  const body = selEl.querySelector('.build-body');
  const colorHex = (body.querySelector('.swatch.on') || body.querySelector('.swatch')).dataset.color;
  const color = parseInt(colorHex.slice(1), 16);
  const style = Number(body.querySelector('.build-style').value);
  const height = Number(body.querySelector('.build-height').value);
  const name = body.querySelector('.build-name').value.trim();
  const txEl = selEl.querySelector('.txstate');
  try {
    if (!currentMine[id]) {
      txState('only the current deed owner can customize this plot.', selEl);
      return;
    }
    const wallet = await connect({ prompt: !account });
    if (!wallet) return;
    btn.disabled = true;
    txState('build it — confirm in your wallet…', selEl);
    const { request } = await pub.simulateContract({
      address: BUILDINGS, abi: buildingsAbi, functionName: 'setBuilding',
      args: [BigInt(id), color, style, height, name], account,
    });
    const h = await wallet.writeContract(request);
    txState('building…', selEl);
    await pub.waitForTransactionReceipt({ hash: h });
    txState('built. your plot is on the map.', selEl);
    await refreshBuildings();
  } catch (err) {
    if (btn) btn.disabled = false;
    const m = (err?.shortMessage || err?.message || 'failed').split('\n')[0];
    txState(m.toLowerCase().slice(0, 160), selEl);
  }
}

// Send the connected address to the Sheet. Automatic submissions are guarded;
// explicit clicks intentionally remain available as fire-and-forget retries.
async function requestAccess(btn, options = {}) {
  if (!account && !options.address) {
    try { await connect({ prompt: true }); } catch {}
    if (!account) return;
  }
  const requestedAddress = (options.address || account)?.toLowerCase();
  if (!requestedAddress) return;
  if (btn) btn.disabled = true;
  if (!ACCESS_WEBHOOK) {
    if (account?.toLowerCase() === requestedAddress) {
      selEl.innerHTML = '<h3>access setup</h3><p class="quiet-note">access setup is temporarily unavailable. try again shortly.</p>';
    }
    return;
  }
  const requestedAt = options.requestedAt || Date.now();
  if (!options.automatic) rememberAccessRequest(requestedAddress, requestedAt);
  watchPendingAccess(requestedAddress, requestedAt);
  let held = 0;
  try {
    const bal = await pub.readContract({ address: UTOPIA_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [requestedAddress] });
    held = Number(bal) / 1e18;
  } catch {}
  fetch(ACCESS_WEBHOOK, {
    method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ wallet: requestedAddress, utopiaHeld: held, at: Date.now() }),
  }).catch(() => {});
  if (account?.toLowerCase() === requestedAddress) {
    selEl.innerHTML = '<h3>setting up access</h3><p class="quiet-note">' + ACCESS_PENDING_COPY + '</p>';
  }
}

// ---- holdings ----

function walletStocksHtml() {
  if (!tokenAddresses) return '<p class="quiet-note">reading wallet Stock Tokens…</p>';
  const rows = SYMBOLS.map((symbol, i) => {
    const amount = walletStockBalances?.[i];
    return '<div class="stock-row"><a href="' + EXPLORER + '/token/' + tokenAddresses[i] +
      '" target="_blank" rel="noopener">' + symbol + '</a><span>' +
      (amount != null ? fmtTok(amount, i).replace(' ' + symbol, '') : '…') + '</span>' +
      '<button class="watch-token" data-token="' + i + '">add</button></div>';
  }).join('');
  return '<div class="wallet-stocks"><p class="eyebrow">Stock Tokens in this wallet</p>' + rows + '</div>';
}

function renderHoldings() {
  if (!account) {
    holdingsEl.innerHTML = '<p class="quiet-note">connect a wallet to see your plots and rewards.</p>';
    return;
  }
  const paymentName = NET.payment === 'native' ? 'ETH balance' : 'UTOP balance';
  const bal = '<div class="row"><span class="k">' + paymentName + '</span><span class="v">' +
    (paymentBalance != null ? fmtPrice(paymentBalance) : '…') + '</span></div>';
  const eligibility = NET.requiresEligibility
    ? '<div class="row"><span class="k">eligibility</span><span class="v">' +
      (accountEligible === true ? 'active' : accountEligible === false
        ? '<a href="#" id="reqaccess">setting up · opens automatically</a>' : 'checking…') +
      '</span></div>'
    : '';
  const portfolio = walletStocksHtml();
  const faucetBtn = NET.utopFaucet ? '<button id="getutop">get 1,000 UTOP</button>' : '';
  const nativeFaucet = NET.nativeFaucet
    ? '<p><a href="' + NET.nativeFaucet + '" target="_blank" rel="noopener">get preview ETH for gas</a></p>'
    : '';
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
  if (!ids.length) {
    holdingsEl.innerHTML = bal + eligibility + '<p class="quiet-note">no plots yet. click an open one on the map.</p>' +
      portfolio + faucetBtn + nativeFaucet + '<p class="txstate"></p>';
    return;
  }
  const items = ids.map(id => {
    const c = claimables.get(id);
    return '<li><button class="plotlink" data-id="' + id + '">plot ' + id + '</button>' +
      '<span class="amt">' + (!currentMine[id] ? 'legacy deed' : c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></li>';
  }).join('');
  const claimIds = ids.filter(id => currentMine[id]);
  const claimBlocked = NET.requiresEligibility && accountEligible === false;
  const claimButton = claimIds.length
    ? '<button id="claimall"' + (claimBlocked ? ' disabled' : '') + '>' +
      (claimBlocked ? 'eligibility required to claim' : claimIds.length > MAX_CLAIM_BATCH ? 'claim first 64' : 'claim all') +
      '</button> '
    : '';
  holdingsEl.innerHTML = bal + eligibility + '<ul class="holdlist">' + items + '</ul>' +
    claimButton + faucetBtn + nativeFaucet + portfolio + '<p class="txstate"></p>';
}

holdingsEl.addEventListener('click', e => {
  const req = e.target.closest('#reqaccess');
  if (req) { e.preventDefault(); requestAccess(req); return; }
  const link = e.target.closest('.plotlink');
  if (link) {
    selected = Number(link.dataset.id);
    renderSel();
    schedule();
    return;
  }
  if (e.target.closest('#claimall')) {
    const btn = e.target.closest('#claimall');
    const ids = [];
    for (let i = 0; i < PLOTS; i++) if (currentMine[i]) ids.push(i);
    if (ids.length) doTx('claimMany', ids.slice(0, MAX_CLAIM_BATCH), btn);
    return;
  }
  const faucet = e.target.closest('#getutop');
  if (faucet) doTx('faucet', [], faucet);
  const watch = e.target.closest('.watch-token');
  if (watch && tokenAddresses && window.ethereum) {
    const index = Number(watch.dataset.token);
    window.ethereum.request({
      method: 'wallet_watchAsset',
      params: { type: 'ERC20', options: { address: tokenAddresses[index], symbol: SYMBOLS[index], decimals: 18 } },
    }).catch(() => {});
  }
});

// ---- market ----

function renderMarket() {
  if (!basePrices) return;
  // only suggest plots whose reward token is actually funded (buyable); fall
  // back to any open plot before treasury data loads
  const buyable = id => reserveCoversPlot(id) !== false;
  let cheapest = -1;
  let bestApy = -1;
  for (let i = 0; i < PLOTS; i++) {
    if (owned[i] || !buyable(i)) continue;
    if (cheapest < 0 || basePrices[i] < basePrices[cheapest]) cheapest = i;
    if (bestApy < 0 || apys[i] > apys[bestApy]) bestApy = i;
  }
  if (cheapest < 0) {
    const funded = fundedTokenNames();
    marketEl.innerHTML = '<p class="quiet-note">' +
      (funded.length ? 'no ' + funded.join('/') + ' plots left to buy right now.' : 'no plots are buyable right now — reward treasury is empty.') +
      '</p>';
    return;
  }
  const reserveShortfall = treasuryBalances && treasuryCommitted && treasuryBalances.some((balance, i) =>
    balance == null || balance < treasuryCommitted[i]
  );
  const reserves = treasuryBalances == null
    ? '<p class="quiet-note">checking reward reserves…</p>'
    : '<p class="' + (reserveShortfall ? 'reserve-warning' : 'quiet-note') + '">reward reserves · ' +
      treasuryBalances.map((balance, i) => {
        if (balance == null) return SYMBOLS[i] + ' unavailable';
        const committed = treasuryCommitted?.[i];
        return fmtTok(balance, i) + (committed != null ? ' (' + fmtTok(committed, i) + ' reserved)' : '');
      }).join(' · ') + '</p>';
  const marketNote = NET.landVersion === 4
    ? 'fixed ETH prices · rewards stop on ' + formatRewardEnd() + ' · every current-contract sold plot is fully reserved.'
    : NET.landVersion === 1
      ? 'plot prices are fixed in preview ETH. reward rates are reference streaming rates, not investment APY.'
      : NET.landVersion === 2
        ? 'preview V2 scales both UTOP plot prices and reward rates with its current market multiplier.'
        : 'mainnet-candidate plot prices stay fixed in UTOP; checkpointed market growth affects only future reward intervals.';
  const multiplierRow = NET.landVersion === 2 || NET.landVersion === 3
    ? '<div class="row"><span class="k">multiplier</span><span class="v">' + fmtMult() + '</span></div>'
    : '';
  marketEl.innerHTML =
    '<div class="row"><span class="k">open plots</span><span class="v">' + (PLOTS - ownedCount) + '</span></div>' +
    '<div class="row"><span class="k">streaming now</span><span class="v">' + currentOwnedCount + ' plots</span></div>' +
    (ownedCount > currentOwnedCount
      ? '<div class="row"><span class="k">legacy deeds shown</span><span class="v">' + (ownedCount - currentOwnedCount) + '</span></div>'
      : '') +
    '<div class="row"><span class="k">cheapest</span><span class="v"><button class="plotlink" data-id="' + cheapest + '">plot ' + cheapest + '</button> · ' + fmtPrice(priceNow(cheapest)) + '</span></div>' +
    '<div class="row"><span class="k">highest base rate</span><span class="v"><button class="plotlink" data-id="' + bestApy + '">plot ' + bestApy + '</button> · ' + (apys[bestApy] / 100).toFixed(2) + '%</span></div>' +
    multiplierRow + reserves + '<p class="quiet-note">' + marketNote + '</p>';
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

function quadContains(mx, my, q) {
  let sgn = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b[0] - a[0]) * (my - a[1]) - (b[1] - a[1]) * (mx - a[0]);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sgn === 0) sgn = s;
      else if (s !== sgn) return false;
    }
  }
  return true;
}

// walk boxes front to back; the first whose top face or visible wall
// contains the cursor is the one the user sees under it
function pick(e) {
  updateCamera();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  for (let k = PLOTS - 1; k >= 0; k--) {
    const id = drawOrder[k];
    const x = id % SIDE, y = (id / SIDE) | 0;
    const z = zOf(id) + (id === selected ? 0.35 : 0);
    const inset = owned[id] ? styleInset(id) : IN;
    const p = [
      proj(x + inset, y + inset, z), proj(x + 1 - inset, y + inset, z),
      proj(x + 1 - inset, y + 1 - inset, z), proj(x + inset, y + 1 - inset, z),
    ];
    if (quadContains(mx, my, p)) return id;
    const drop = (z - Z0) * view.hz;
    for (let i = 0; i < 4; i++) {
      if (!wallVisible[i]) continue;
      const a = p[i], b = p[(i + 1) % 4];
      if (quadContains(mx, my, [a, b, [b[0], b[1] + drop], [a[0], a[1] + drop]])) return id;
    }
  }
  return -1;
}

// ---- camera controls ----

const resetBtn = document.getElementById('view-reset');
const TAU = 2 * Math.PI;

function viewMoved() {
  const ny = ((yaw % TAU) + TAU) % TAU;
  return Math.abs(ny - YAW0) > 0.001 || Math.abs(pitch - PITCH0) > 0.001
    || Math.abs(zoom - 1) > 0.001 || Math.abs(panX) > 0.5 || Math.abs(panY) > 0.5;
}

function updateResetBtn() {
  resetBtn.hidden = !viewMoved();
}

let animRaf = 0;
function flyTo(target, ms = 500) {
  cancelAnimationFrame(animRaf);
  const from = { yaw, pitch, zoom, panX, panY };
  const to = { ...from, ...target };
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    yaw = from.yaw + (to.yaw - from.yaw) * e;
    pitch = from.pitch + (to.pitch - from.pitch) * e;
    zoom = from.zoom + (to.zoom - from.zoom) * e;
    panX = from.panX + (to.panX - from.panX) * e;
    panY = from.panY + (to.panY - from.panY) * e;
    fit();
    updateResetBtn();
    schedule();
    if (k < 1) animRaf = requestAnimationFrame(step);
  };
  animRaf = requestAnimationFrame(step);
}

// quarter turns pivot around whatever ground point is centered on screen
function quarterTurn(dir) {
  updateCamera();
  const [wx, wy] = groundAt(view.w / 2, view.h / 2);
  const ny = yaw + dir * Math.PI / 2;
  const c = Math.cos(ny), s = Math.sin(ny);
  const rx = wx * c - wy * s, ry = wx * s + wy * c;
  flyTo({
    yaw: ny,
    panX: -rx * view.s,
    panY: view.h * -0.02 - ry * view.s * pitch,
  });
}
document.getElementById('rot-l').addEventListener('click', () => quarterTurn(-1));
document.getElementById('rot-r').addEventListener('click', () => quarterTurn(1));
resetBtn.addEventListener('click', () => {
  // unwind to the nearest equivalent of the home angle, not the long way round
  const home = YAW0 + TAU * Math.round((yaw - YAW0) / TAU);
  flyTo({ yaw: home, pitch: PITCH0, zoom: 1, panX: 0, panY: 0 });
});

// double-click a plot: fly the camera down to it
canvas.addEventListener('dblclick', e => {
  if (!loaded) return;
  const id = pick(e);
  if (id < 0) return;
  const gx = (id % SIDE) + 0.5 - 16, gy = ((id / SIDE) | 0) + 0.5 - 16;
  const rx = gx * cosYaw - gy * sinYaw;
  const ry = gx * sinYaw + gy * cosYaw;
  const z = Math.min(6, Math.max(zoom * 1.9, 2.8));
  const s = view.baseS * z;
  const hz = s * 0.82 * Math.sqrt(1 - pitch * pitch);
  flyTo({
    zoom: z,
    panX: -rx * s,
    panY: view.h * -0.02 - ry * s * pitch + zOf(id) * 0.6 * hz,
  }, 600);
});

// wheel zoom about the cursor, so the ground point under it stays put
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  cancelAnimationFrame(animRaf);
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const a = (mx - view.ox) / view.s;
  const b = (my - view.oy) / (view.s * pitch);
  zoom = Math.min(6, Math.max(0.6, zoom * Math.exp(-e.deltaY * 0.0012)));
  fit();
  panX += mx - (view.ox + a * view.s);
  panY += my - (view.oy + b * view.s * pitch);
  fit();
  updateResetBtn();
  schedule();
}, { passive: false });

// drag orbits (shift-drag pans) on fine pointers; touch keeps native page
// scroll and uses the turn buttons
let drag = null; // {x, y, moved, pan}
let suppressClick = false;
if (fine) {
  canvas.addEventListener('pointerdown', e => {
    cancelAnimationFrame(animRaf);
    drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => {
    suppressClick = drag?.moved || false;
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
}

canvas.addEventListener('click', e => {
  if (suppressClick) { suppressClick = false; return; }
  if (!loaded) return;
  selected = pick(e);
  renderSel();
  schedule();
});

if (fine) {
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        if (drag.pan) {
          panX += dx;
          panY += dy;
        } else {
          // orbit about the ground point at the screen center, not the grid
          // center, so a zoomed-in view stays on what it was looking at
          const [wx, wy] = groundAt(view.w / 2, view.h / 2);
          yaw += dx * 0.007;
          pitch = Math.min(0.92, Math.max(0.28, pitch + dy * 0.004));
          updateCamera();
          fit();
          const rx = wx * cosYaw - wy * sinYaw, ry = wx * sinYaw + wy * cosYaw;
          panX += view.w / 2 - (view.ox + rx * view.s);
          panY += view.h / 2 - (view.oy + ry * view.s * pitch);
        }
        drag.x = e.clientX; drag.y = e.clientY;
        hoverId = -1;
        tip.hide();
        fit();
        updateResetBtn();
        schedule();
      }
      return;
    }
    if (!loaded) return;
    const id = pick(e);
    hoverId = id;
    if (id >= 0) {
      const l1 = 'plot ' + id + (owned[id] ? (mine[id] ? ' · yours' : ' · owned') : ' · ' + fmtPrice(priceNow(id)));
      const acc = mine[id] ? claimables.get(id) : null;
      const l2 = acc != null
        ? 'earning · ' + fmtTok(acc, tokIdx[id]) + ' accrued'
        : (apys[id] / 100).toFixed(2) + '% base rate · rewards in ' + SYMBOLS[tokIdx[id]];
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

setInterval(() => { if (loaded && !document.hidden) refreshOwnership().catch(() => {}); }, 25000);
setInterval(() => { if (loaded && !document.hidden && account) refreshClaimables().catch(() => {}); }, 30000);
// codex: one scheduler accelerates pending access without overlapping the
// normal refresh or leaving an open dashboard blocked after enrollment.
scheduleEligibilityPoll(ELIGIBILITY_POLL_MS);
setInterval(() => { if (loaded && !document.hidden) refreshTreasury().catch(() => {}); }, 60000);

window.addEventListener('resize', () => { fit(); schedule(); });

function configurePage() {
  document.querySelector('.crumb').textContent = 'dashboard · ' + NET.label;
  document.querySelector('.wordmark').href = withNetwork('./');

  const disclaimer = document.getElementById('network-disclaimer');
  disclaimer.textContent = NET.key === 'mainnet'
    ? NET.ready
      ? 'mainnet · eligibility required · Stock Tokens are restricted tokenized debt securities.'
      : 'mainnet is not active · ' + NET.activationIssue + '.'
    : 'preview network only. Preview assets have no value. not an offer of anything.';

  const links = [
    ['land-contract-link', addressUrl(LAND)],
    ['utop-contract-link', addressUrl(UTOP)],
    ['chain-faucet-link', NET.nativeFaucet],
  ];
  for (const [id, href] of links) {
    const link = document.getElementById(id);
    link.hidden = !href;
    if (href) link.href = href;
  }

  if (!NET.ready) {
    walletLink.textContent = 'mainnet pending';
    holdingsEl.innerHTML = '<p class="quiet-note">mainnet is disabled until the production release gates pass.</p>';
    marketEl.innerHTML = '<p class="quiet-note">' + NET.activationIssue + '.</p>';
  }
}

configurePage();
fit();
render();
if (NET.ready) {
  load();
  connect({ prompt: false }).catch(() => {});
} else {
  statusEl.textContent = NET.label + ' is not active · ' + NET.activationIssue + '. the preview city remains available.';
}
