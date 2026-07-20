// Shared read layer for the marketplace pages (/market, /my-land, /activity).
// One place loads listings, sales, and floors — pages consume, never re-fetch
// per card. All reads go through the configured RPC (caching proxy in prod,
// local fork in the demo); event scans are bounded, never from block 0.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=12';
import { NET, addressUrl } from './config.js?v=12';

// demo default: the local fork. production sets window.UTOPIA_MARKET.
export const MARKET_CFG = globalThis.UTOPIA_MARKET || {
  rpc: 'http://localhost:8545',
  marketplace: '0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690',
};
export const LAND = NET.land;
export const MARKET = MARKET_CFG.marketplace;
export const SIDE = 32;
export const PLOTS = 1024;
export const SYMBOLS = NET.symbols;
export { addressUrl };

export const chain = defineChain({
  id: NET.chainId, name: NET.label,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [MARKET_CFG.rpc] } },
});
export const pub = createPublicClient({ chain, transport: http(MARKET_CFG.rpc, { timeout: 20000 }) });

export const marketAbi = parseAbi([
  'function buy(uint256 tokenId) payable',
  'function list(uint256 tokenId, uint256 price)',
  'function updatePrice(uint256 tokenId, uint256 price)',
  'function cancel(uint256 tokenId)',
  'function isListingValid(uint256 tokenId) view returns (bool)',
  'function listings(uint256) view returns (address seller, uint96 price)',
  'function claimRewards()',
  'function pokeCheckpoint(address holder)',
  'function claimableRewards(address holder) view returns (uint256)',
  'function loyaltyMultiplierBps(address holder) view returns (uint256)',
  'function loyaltySince(address holder) view returns (uint256)',
  'function totalPaidToHolders() view returns (uint256)',
]);
export const landAbi = parseAbi([
  'function setApprovalForAll(address op, bool ok)',
  'function isApprovedForAll(address owner, address op) view returns (bool)',
  'function ownerOf(uint256) view returns (address)',
  'function plotsOf(address) view returns (uint256[4])',
  'function claimable(uint256 id) view returns (uint256)',
  'function isEligible(address) view returns (bool)',
]);

export const LISTED_EVT = { type: 'event', name: 'Listed', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' },
  { indexed: false, name: 'price', type: 'uint256' } ] };
export const SOLD_EVT = { type: 'event', name: 'Sold', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' },
  { indexed: true, name: 'buyer', type: 'address' },
  { indexed: false, name: 'price', type: 'uint256' },
  { indexed: false, name: 'fee', type: 'uint256' } ] };
export const CANCELLED_EVT = { type: 'event', name: 'Cancelled', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' } ] };

// ---- deterministic plot attributes (identical to the live land contract) ----
function h256(salt, id) { return BigInt(keccak256(encodePacked(['string', 'uint256'], [salt, BigInt(id)]))); }
export function tokenOf(id) {
  if (NET.rewardMode < 5) return NET.rewardMode;
  const x = id % SIDE, y = (id / SIDE) | 0, dx = 2 * x - 31, dy = 2 * y - 31;
  if (dx * dx + dy * dy < 256) return 2;
  if (dx < 0 && dy < 0) return 0; if (dx >= 0 && dy < 0) return 1; if (dx < 0 && dy >= 0) return 3; return 4;
}
export function mintPriceOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  const base = 500000000000000n + (h256('utopia/price/v1', id) % 2000000000000000n);
  const premium = (2500000000000000n * 300n) / (300n + BigInt(x * x + y * y));
  const raw = base + premium; return raw - (raw % 10000000000000n);
}
export function apyOf(id) { return Number(310n + (h256('utopia/apy/v1', id) % 271n)); }
export function annualYield(id) { return (mintPriceOf(id) * BigInt(apyOf(id))) / 10000n; }
export const DCOLORS = ['#e3c67b', '#6f9fd0', '#9ec4e8', '#4d7db0', '#c3dcf3'];
export function districtIdx(id) {
  const x = id % SIDE, y = (id / SIDE) | 0, dx = x - 15.5, dy = y - 15.5;
  if (dx * dx + dy * dy < 64) return 0;
  if (dx < 0 && dy < 0) return 1; if (dx >= 0 && dy < 0) return 2; if (dx < 0 && dy >= 0) return 3; return 4;
}
export function districtName(id) {
  return ['silicon heights', 'motorworks', 'cupertino row', 'the cloudworks', 'the marketplace'][districtIdx(id)];
}
export function coords(id) { return '(' + (id % SIDE) + ', ' + ((id / SIDE) | 0) + ')'; }
export function fmtEth(wei) { return parseFloat((Number(wei) / 1e18).toFixed(5)) + ' ETH'; }
export function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

// ---- bounded loaders (cached in-module; pages call refresh*) ----
const SCAN_BLOCKS = 200000n; // ~recent history only; never from genesis

async function boundedLogs(event) {
  const latest = await pub.getBlockNumber();
  const from = latest > SCAN_BLOCKS ? latest - SCAN_BLOCKS : 0n;
  return pub.getLogs({ address: MARKET, event, fromBlock: from, toBlock: 'latest' });
}

export let listings = []; // {id, seller, price}
export async function refreshListings() {
  const logs = await boundedLogs(LISTED_EVT);
  const latest = new Map();
  for (const l of logs) latest.set(Number(l.args.tokenId), { seller: l.args.seller, price: l.args.price });
  const ids = [...latest.keys()];
  const valid = await Promise.all(ids.map(id =>
    pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'isListingValid', args: [BigInt(id)] }).catch(() => false)
  ));
  listings = ids.map((id, i) => valid[i] ? { id, ...latest.get(id) } : null).filter(Boolean);
  return listings;
}

export let sales = []; // {id, seller, buyer, price, block} newest first
export async function refreshSales() {
  const logs = await boundedLogs(SOLD_EVT);
  sales = logs.map(l => ({
    id: Number(l.args.tokenId), seller: l.args.seller, buyer: l.args.buyer,
    price: l.args.price, block: l.blockNumber,
  })).reverse();
  return sales;
}

// per-district floor prices + global floor, from current listings
export function floors() {
  const f = { global: null, byDistrict: [null, null, null, null, null] };
  for (const l of listings) {
    if (f.global == null || l.price < f.global) f.global = l.price;
    const d = districtIdx(l.id);
    if (f.byDistrict[d] == null || l.price < f.byDistrict[d]) f.byDistrict[d] = l.price;
  }
  return f;
}

export function lastSaleFor(id) {
  return sales.find(s => s.id === id) || null;
}

// decode a plotsOf bitmap into plot ids
export function bitmapToIds(words) {
  const ids = [];
  for (let i = 0; i < PLOTS; i++) {
    if ((words[i >> 8] >> BigInt(i & 255)) & 1n) ids.push(i);
  }
  return ids;
}

// ---- wallet (shared minimal connector) ----
export let account = null;
export let walletClient = null;
let provider = null;
window.addEventListener('eip6963:announceProvider', e => { provider = provider || e.detail.provider; });
window.dispatchEvent(new Event('eip6963:requestProvider'));

export async function connect() {
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r => setTimeout(r, 200));
  provider = provider || window.ethereum;
  if (!provider) return null;
  walletClient = createWalletClient({ chain, transport: custom(provider) });
  const [addr] = await walletClient.requestAddresses();
  account = addr || null;
  return account ? walletClient : null;
}

// ---- the deed diorama renderer (shared by market + my-land cards) ----
const dioramas = [];
let dioramaLoop = false;
export function mountDioramas(root) {
  dioramas.length = 0;
  for (const cv of root.querySelectorAll('.deed-map')) {
    dioramas.push({ cv, ctx: cv.getContext('2d'), id: Number(cv.dataset.map) });
  }
  if (!dioramaLoop) { dioramaLoop = true; requestAnimationFrame(tick); }
}
function tick(now) {
  const t = now / 1000;
  for (const d of dioramas) drawDiorama(d, t);
  requestAnimationFrame(tick);
}
function drawDiorama({ cv, ctx, id }, t) {
  const Wd = cv.width, Hd = cv.height;
  ctx.clearRect(0, 0, Wd, Hd);
  const G = 13;
  const px = id % SIDE, py = (id / SIDE) | 0;
  const cx0 = Math.max(0, Math.min(SIDE - G, px - (G >> 1)));
  const cy0 = Math.max(0, Math.min(SIDE - G, py - (G >> 1)));
  const tw = Wd / (G + 1), th = tw * 0.5;
  const ox = Wd / 2, oy = Hd * 0.24;
  const iso = (gx, gy) => [ox + (gx - gy) * tw * 0.5, oy + (gx + gy) * th * 0.5];
  for (let s = 0; s <= 2 * (G - 1); s++) {
    for (let gx = Math.max(0, s - G + 1); gx <= Math.min(G - 1, s); gx++) {
      const gy = s - gx;
      const wx = cx0 + gx, wy = cy0 + gy;
      const isPlot = wx === px && wy === py;
      const dcx = wx - 15.5, dcy = wy - 15.5, core = dcx * dcx + dcy * dcy < 64;
      let h = 4 + ((wx * 7 + wy * 13) % 6);
      let top;
      if (isPlot) { h = 20 + Math.sin(t * 2.6) * 4; top = '#ffffff'; }
      else if (core) top = 'rgba(227,198,123,0.35)';
      else top = 'rgba(120,150,195,' + (0.14 + ((wx + wy) % 2) * 0.06) + ')';
      const [x, y] = iso(gx, gy);
      block(ctx, x, y, tw, th, h, top, isPlot);
    }
  }
}
function block(ctx, x, y, tw, th, h, top, lit) {
  const hw = tw * 0.5, hh = th * 0.5;
  ctx.fillStyle = lit ? 'rgba(210,225,245,0.55)' : 'rgba(30,55,92,0.6)';
  ctx.beginPath(); ctx.moveTo(x - hw, y); ctx.lineTo(x - hw, y - h); ctx.lineTo(x, y + hh - h); ctx.lineTo(x, y + hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = lit ? 'rgba(170,195,230,0.5)' : 'rgba(20,40,70,0.6)';
  ctx.beginPath(); ctx.moveTo(x + hw, y); ctx.lineTo(x + hw, y - h); ctx.lineTo(x, y + hh - h); ctx.lineTo(x, y + hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + hw, y + hh - h); ctx.lineTo(x, y + th - h); ctx.lineTo(x - hw, y + hh - h); ctx.closePath(); ctx.fill();
  if (lit) {
    ctx.save(); ctx.globalAlpha = 0.4; ctx.shadowColor = '#e3c67b'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#e3c67b'; ctx.beginPath(); ctx.arc(x, y - h, 1.6, 0, 7); ctx.fill(); ctx.restore();
  }
}
