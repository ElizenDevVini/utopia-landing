// Shared read layer for the marketplace pages (/market, /my-land, /activity).
// One place loads listings, sales, and floors — pages consume, never re-fetch
// per card. All reads go through the configured RPC (caching proxy in prod,
// local fork in the demo); event scans are bounded, never from block 0.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=12';
import { NET, MULTICALL3, addressUrl } from './config.js?v=12';

// demo default: the local fork. production sets window.UTOPIA_MARKET.
export const MARKET_CFG = globalThis.UTOPIA_MARKET || {
  rpc: 'http://localhost:8545',
  marketplace: '0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690',
  // codex: the fork deployment block bounds event history without ever
  // falling back to a genesis-wide scan. Update this with a redeployment.
  startBlock: 14412544,
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
  contracts: { multicall3: { address: MULTICALL3 } },
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
  'function operatorFeeBps() view returns (uint256)',
  'function poolFeeBps() view returns (uint256)',
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
export const PRICE_UPDATED_EVT = { type: 'event', name: 'PriceUpdated', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' },
  { indexed: false, name: 'price', type: 'uint256' } ] };
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
// RPCs on this chain reject or stall on wide log ranges. Start at the known
// marketplace deployment and walk in fixed chunks; never ask from block zero.
const LOG_CHUNK = 5000n;
const CACHE_MS = 5000;

async function boundedMarketLogs() {
  // Transaction receipts can arrive inside viem's default block-number cache
  // window; force a fresh head so a just-listed/repriced/cancelled deed renders.
  const latest = await pub.getBlockNumber({ cacheTime: 0 });
  let cursor = BigInt(MARKET_CFG.startBlock || 1);
  if (cursor < 1n) cursor = 1n;
  if (cursor > latest) return [];
  const logs = [];
  while (cursor <= latest) {
    const toBlock = cursor + LOG_CHUNK - 1n < latest ? cursor + LOG_CHUNK - 1n : latest;
    logs.push(...await pub.getLogs({
      address: MARKET,
      events: [LISTED_EVT, PRICE_UPDATED_EVT, CANCELLED_EVT, SOLD_EVT],
      fromBlock: cursor,
      toBlock,
    }));
    cursor = toBlock + 1n;
  }
  return logs;
}

export let listings = []; // {id, seller, price}
export let sales = []; // {id, seller, buyer, price, block} newest first
let marketLoadedAt = 0;
let marketLoad = null;

export async function refreshMarketData(force = false) {
  if (!force && marketLoadedAt && Date.now() - marketLoadedAt < CACHE_MS) return { listings, sales };
  if (marketLoad) return marketLoad;
  marketLoad = (async () => {
    const logs = await boundedMarketLogs();
    const active = new Map();
    const sold = [];
    for (const log of logs) {
      const id = Number(log.args.tokenId);
      if (log.eventName === 'Listed') {
        active.set(id, { id, seller: log.args.seller, price: log.args.price, block: log.blockNumber });
      } else if (log.eventName === 'PriceUpdated') {
        const listing = active.get(id);
        if (listing && listing.seller.toLowerCase() === log.args.seller.toLowerCase()) {
          active.set(id, { ...listing, price: log.args.price, block: log.blockNumber });
        }
      } else if (log.eventName === 'Cancelled') {
        active.delete(id);
      } else if (log.eventName === 'Sold') {
        active.delete(id);
        sold.push({
          id, seller: log.args.seller, buyer: log.args.buyer,
          price: log.args.price, fee: log.args.fee, block: log.blockNumber,
          logIndex: log.logIndex,
        });
      }
    }

    const candidates = [...active.values()];
    const checks = candidates.length ? await pub.multicall({
      allowFailure: true,
      contracts: candidates.map(listing => ({
        address: MARKET, abi: marketAbi, functionName: 'isListingValid', args: [BigInt(listing.id)],
      })),
    }) : [];
    listings = candidates.filter((_, i) => checks[i]?.status === 'success' && checks[i].result === true);
    sales = sold.sort((a, b) => a.block === b.block
      ? Number(b.logIndex || 0) - Number(a.logIndex || 0)
      : a.block < b.block ? 1 : -1);
    marketLoadedAt = Date.now();
    return { listings, sales };
  })();
  try { return await marketLoad; }
  finally { marketLoad = null; }
}

export async function refreshListings(force = false) {
  await refreshMarketData(force);
  return listings;
}

export async function refreshSales(force = false) {
  await refreshMarketData(force);
  return sales;
}

// codex: one aggregate3 eth_call for a concentrated holder, not one HTTP RPC
// request per deed.
export async function claimablesFor(ids) {
  if (!ids.length) return [];
  const results = await pub.multicall({
    allowFailure: true,
    contracts: ids.map(id => ({
      address: LAND, abi: landAbi, functionName: 'claimable', args: [BigInt(id)],
    })),
  });
  return results.map(item => item.status === 'success' ? item.result : null);
}

export async function holderMarketSummary(holder) {
  const calls = ['claimableRewards', 'loyaltyMultiplierBps', 'loyaltySince'].map(functionName => ({
    address: MARKET, abi: marketAbi, functionName, args: [holder],
  }));
  const results = await pub.multicall({ allowFailure: false, contracts: calls });
  return { claimable: results[0], multiplierBps: results[1], loyaltySince: results[2] };
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
