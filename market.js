// Utopia marketplace: browse listings, compare earnings, see sellers, buy/list.
// Reads listings from the marketplace contract's events; plot attributes are
// computed locally (identical to the land contract) so it loads without heavy reads.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=12';
import { NET, addressUrl } from './config.js?v=12';

// --- demo/runtime config: point at the local fork for the walkthrough, or set
// window.UTOPIA_MARKET = { rpc, marketplace } to override for mainnet ---
const MARKET_CFG = globalThis.UTOPIA_MARKET || {
  rpc: 'http://localhost:8545',
  marketplace: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933',
};
const LAND = NET.land;
const MARKET = MARKET_CFG.marketplace;
const SIDE = 32, PLOTS = 1024;
const WAD = 10n ** 18n;

const chain = defineChain({
  id: NET.chainId, name: NET.label,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [MARKET_CFG.rpc] } },
});
const pub = createPublicClient({ chain, transport: http(MARKET_CFG.rpc, { timeout: 20000 }) });

const marketAbi = parseAbi([
  'function buy(uint256 tokenId) payable',
  'function list(uint256 tokenId, uint256 price)',
  'function cancel(uint256 tokenId)',
  'function isListingValid(uint256 tokenId) view returns (bool)',
  'function listings(uint256) view returns (address seller, uint96 price)',
  'function feeBps() view returns (uint256)',
]);
const LISTED = { type: 'event', name: 'Listed', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' },
  { indexed: false, name: 'price', type: 'uint256' } ] };
const landAbi = parseAbi(['function setApprovalForAll(address op, bool ok)', 'function ownerOf(uint256) view returns (address)']);

// --- local plot attributes (match the land contract) ---
function h256(salt, id) { return BigInt(keccak256(encodePacked(['string', 'uint256'], [salt, BigInt(id)]))); }
const SYMBOLS = NET.symbols;
function tokenOf(id) {
  if (NET.rewardMode < 5) return NET.rewardMode;
  const x = id % SIDE, y = (id / SIDE) | 0, dx = 2 * x - 31, dy = 2 * y - 31;
  if (dx * dx + dy * dy < 256) return 2;
  if (dx < 0 && dy < 0) return 0; if (dx >= 0 && dy < 0) return 1; if (dx < 0 && dy >= 0) return 3; return 4;
}
function priceOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  const base = 500000000000000n + (h256('utopia/price/v1', id) % 2000000000000000n);
  const premium = (2500000000000000n * 300n) / (300n + BigInt(x * x + y * y));
  const raw = base + premium; return raw - (raw % 10000000000000n);
}
function apyOf(id) { return Number(310n + (h256('utopia/apy/v1', id) % 271n)); }
// annual reward valued in ETH-equivalent: mint price * rate
function annualYield(id) { return (priceOf(id) * BigInt(apyOf(id))) / 10000n; }

function fmtEth(wei) { return parseFloat((Number(wei) / 1e18).toFixed(5)) + ' ETH'; }
function short(a) { return a.slice(0, 6) + '…' + a.slice(-4); }
function coords(id) { return '(' + (id % SIDE) + ', ' + ((id / SIDE) | 0) + ')'; }
function districtName(id) { return ['silicon heights', 'motorworks', 'cupertino row', 'the cloudworks', 'the marketplace'][
  (() => { const x = id % SIDE, y = (id / SIDE) | 0, dx = x - 15.5, dy = y - 15.5;
    if (dx * dx + dy * dy < 64) return 0; if (dx < 0 && dy < 0) return 1; if (dx >= 0 && dy < 0) return 2; if (dx < 0 && dy >= 0) return 3; return 4; })()]; }

const statusEl = document.getElementById('market-status');
const earnersEl = document.querySelector('#earners .body');
const listingsEl = document.querySelector('#listings .body');
const sellersEl = document.querySelector('#sellers .body');
const walletLink = document.getElementById('wallet');

let account = null;
let listings = []; // {id, seller, price}

async function loadListings() {
  // every Listed event, then keep only the ones still valid on-chain
  const logs = await pub.getLogs({ address: MARKET, event: LISTED, fromBlock: 0n, toBlock: 'latest' });
  const latest = new Map(); // tokenId -> {seller, price} (last Listed wins)
  for (const l of logs) latest.set(Number(l.args.tokenId), { seller: l.args.seller, price: l.args.price });
  const ids = [...latest.keys()];
  const valid = await Promise.all(ids.map(id =>
    pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'isListingValid', args: [BigInt(id)] }).catch(() => false)
  ));
  listings = ids.map((id, i) => valid[i] ? { id, ...latest.get(id) } : null).filter(Boolean);
  render();
}

function render() {
  if (!listings.length) {
    statusEl.textContent = 'no active listings yet.';
    for (const el of [earnersEl, listingsEl, sellersEl]) el.innerHTML = '<p class="quiet-note">nothing listed right now.</p>';
    return;
  }
  statusEl.textContent = listings.length + ' plot' + (listings.length === 1 ? '' : 's') + ' listed by ' +
    new Set(listings.map(l => l.seller.toLowerCase())).size + ' owner' + (new Set(listings.map(l => l.seller.toLowerCase())).size === 1 ? '' : 's') + '.';

  // highest streams: listed plots ranked by annual reward stream
  const byYield = [...listings].sort((a, b) => (annualYield(b.id) < annualYield(a.id) ? -1 : 1));
  earnersEl.innerHTML = '<ol class="rank-list">' + byYield.slice(0, 8).map(l =>
    '<li><a href="#plot-' + l.id + '">plot ' + l.id + '</a>' +
    '<span class="val">' + fmtEth(annualYield(l.id)) + ' / yr</span>' +
    '<span class="sub">' + SYMBOLS[tokenOf(l.id)] + ' · ' + (apyOf(l.id) / 100).toFixed(2) + '%</span></li>').join('') + '</ol>';

  // the deeds: certificate cards, cheapest first
  const byPrice = [...listings].sort((a, b) => (a.price < b.price ? -1 : 1));
  const DCOLORS = ['#e3c67b', '#6f9fd0', '#9ec4e8', '#4d7db0', '#c3dcf3'];
  const dIdx = id => { const x = id % SIDE, y = (id / SIDE) | 0, dx = x - 15.5, dy = y - 15.5;
    if (dx * dx + dy * dy < 64) return 0; if (dx < 0 && dy < 0) return 1; if (dx >= 0 && dy < 0) return 2; if (dx < 0 && dy >= 0) return 3; return 4; };
  listingsEl.innerHTML = byPrice.map(l => {
    const mine = account && l.seller.toLowerCase() === account.toLowerCase();
    return '<article class="deed" id="plot-' + l.id + '">' +
      '<div class="deed-top">' +
        '<div class="deed-title">plot ' + l.id +
          '<span class="coords">' + coords(l.id) + ' · deed no. ' + String(l.id).padStart(4, '0') + '</span></div>' +
        '<canvas class="deed-map" width="32" height="32" style="width:64px;height:64px" data-map="' + l.id + '"></canvas>' +
      '</div>' +
      '<p class="deed-district"><i style="background:' + DCOLORS[dIdx(l.id)] + '"></i>' + districtName(l.id) + '</p>' +
      '<dl class="deed-rows">' +
        '<dt>streams</dt><dd>' + SYMBOLS[tokenOf(l.id)] + ' · ' + (apyOf(l.id) / 100).toFixed(2) + '% · ' + fmtEth(annualYield(l.id)) + '/yr</dd>' +
        '<dt>seller</dt><dd><a href="' + addressUrl(l.seller) + '" target="_blank" rel="noopener">' + short(l.seller) + '</a>' + (mine ? ' · you' : '') + '</dd>' +
      '</dl>' +
      '<div class="deed-price"><span class="label">asking</span><span class="amount">' + fmtEth(l.price) + '</span></div>' +
      (mine
        ? '<button class="act cancel" data-cancel="' + l.id + '">cancel listing</button>'
        : '<button class="act buy" data-buy="' + l.id + '" data-price="' + l.price + '">acquire this deed</button>') +
      '<p class="tx" id="tx-' + l.id + '"></p></article>';
  }).join('');
  drawDeedMaps();

  // who's selling
  drawSellers();
}

// mini-map stamp: the whole city faint, this plot burning bright
function drawDeedMaps() {
  for (const cv of document.querySelectorAll('.deed-map')) {
    const id = Number(cv.dataset.map);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0a1e38'; ctx.fillRect(0, 0, 32, 32);
    // a faint checker so it reads as the city grid, gold ring only at the core edge
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5, d = dx * dx + dy * dy;
      if ((x + y) % 2 === 0) { ctx.fillStyle = 'rgba(140,170,210,0.10)'; ctx.fillRect(x, y, 1, 1); }
      if (d >= 52 && d < 64) { ctx.fillStyle = 'rgba(227,198,123,0.22)'; ctx.fillRect(x, y, 1, 1); }
    }
    const px = id % 32, py = (id / 32) | 0;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(px - 2, py, 2, 1); ctx.fillRect(px + 1, py, 2, 1);
    ctx.fillRect(px, py - 2, 1, 2); ctx.fillRect(px, py + 1, 1, 2); // surveyor's cross
    ctx.fillStyle = '#e3c67b'; ctx.fillRect(px, py, 1, 1);
  }
}

function drawSellers() {
  const bySeller = new Map();
  for (const l of listings) {
    const s = bySeller.get(l.seller) || { count: 0, floor: l.price };
    s.count += 1; if (l.price < s.floor) s.floor = l.price; bySeller.set(l.seller, s);
  }
  const sellers = [...bySeller.entries()].sort((a, b) => b[1].count - a[1].count);
  sellersEl.innerHTML = '<ol class="rank-list">' + sellers.map(([addr, s]) =>
    '<li><a href="' + addressUrl(addr) + '" target="_blank" rel="noopener">' + short(addr) + '</a>' +
    '<span class="sub">from ' + fmtEth(s.floor) + '</span>' +
    '<span class="val">' + s.count + ' listed</span></li>').join('') + '</ol>';
}

// --- wallet + buy/cancel/list ---
let walletClient = null, provider = null;
window.addEventListener('eip6963:announceProvider', e => { provider = provider || e.detail.provider; });
window.dispatchEvent(new Event('eip6963:requestProvider'));

async function connect() {
  provider = provider || window.ethereum;
  if (!provider) { statusEl.textContent = 'install a wallet to trade.'; return null; }
  walletClient = createWalletClient({ chain, transport: custom(provider) });
  const [addr] = await walletClient.requestAddresses();
  account = addr; walletLink.textContent = short(addr); render();
  return walletClient;
}
walletLink.addEventListener('click', async e => { e.preventDefault(); try { await connect(); } catch {} });

listingsEl.addEventListener('click', async e => {
  const buyBtn = e.target.closest('[data-buy]');
  const cancelBtn = e.target.closest('[data-cancel]');
  if (!buyBtn && !cancelBtn) return;
  const id = Number((buyBtn || cancelBtn).dataset.buy || (buyBtn || cancelBtn).dataset.cancel);
  const txEl = document.getElementById('tx-' + id);
  try {
    const w = walletClient || await connect();
    if (!w) return;
    if (buyBtn) {
      txEl.textContent = 'confirm in your wallet…';
      const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'buy', args: [BigInt(id)], value: BigInt(buyBtn.dataset.price), account });
      const hash = await w.writeContract(request);
      txEl.textContent = 'buying…';
      await pub.waitForTransactionReceipt({ hash });
      txEl.textContent = 'bought. the deed is yours.';
    } else {
      const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'cancel', args: [BigInt(id)], account });
      const hash = await w.writeContract(request);
      await pub.waitForTransactionReceipt({ hash });
      txEl.textContent = 'listing cancelled.';
    }
    await loadListings();
  } catch (err) {
    txEl.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 120);
  }
});

loadListings().catch(err => { statusEl.textContent = 'could not read the marketplace.'; console.error(err); });
setInterval(() => loadListings().catch(() => {}), 20000);
