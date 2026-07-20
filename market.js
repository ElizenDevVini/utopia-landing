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
  marketplace: '0xc3e53F4d16Ae77Db1c982e75a937B9f60FE63690',
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
  'function claimRewards()',
  'function pokeCheckpoint(address holder)',
  'function claimableRewards(address holder) view returns (uint256)',
  'function loyaltyMultiplierBps(address holder) view returns (uint256)',
  'function loyaltySince(address holder) view returns (uint256)',
  'function totalPaidToHolders() view returns (uint256)',
  'function operatorFeeBps() view returns (uint256)',
  'function poolFeeBps() view returns (uint256)',
]);
const SOLD = { type: 'event', name: 'Sold', inputs: [
  { indexed: true, name: 'tokenId', type: 'uint256' },
  { indexed: true, name: 'seller', type: 'address' },
  { indexed: true, name: 'buyer', type: 'address' },
  { indexed: false, name: 'price', type: 'uint256' },
  { indexed: false, name: 'fee', type: 'uint256' } ] };
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
const payrollEl = document.querySelector('#payroll .body');
const statsEl = document.querySelector('#citystats .body');
const walletLink = document.getElementById('wallet');

let account = null;
let listings = []; // {id, seller, price}
let stockFilter = 'all';

// ---- your land pays you: fee-share rewards + loyalty tier ----
const TIER1 = 30 * 86400, TIER2 = 90 * 86400;
async function refreshPayroll() {
  if (!account) return;
  try {
    const [claimable, multBps, since] = await Promise.all([
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'claimableRewards', args: [account] }),
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'loyaltyMultiplierBps', args: [account] }),
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'loyaltySince', args: [account] }),
    ]);
    const mult = Number(multBps) / 10000;
    let streak = '';
    if (Number(since) > 0) {
      const held = Math.floor(Date.now() / 1000) - Number(since);
      const days = Math.floor(held / 86400);
      if (held < TIER1) streak = 'held ' + days + 'd — 1.5× at 30 days';
      else if (held < TIER2) streak = 'held ' + days + 'd — 2.0× at 90 days';
      else streak = 'held ' + days + 'd — max tier';
    }
    payrollEl.innerHTML =
      '<div class="pay-row"><span>earned from trading</span><strong>' + fmtEth(claimable) + '</strong></div>' +
      '<div class="pay-row"><span>loyalty</span><strong>' + mult.toFixed(1) + '×</strong></div>' +
      (streak ? '<p class="pay-streak">' + streak + '</p>' : '') +
      (claimable > 0n
        ? '<button class="act pay-claim" id="claim-rewards">claim ' + fmtEth(claimable) + '</button>'
        : '<p class="quiet-note">rewards build as the city trades.</p>') +
      '<p class="pay-warning">selling any plot resets your streak.</p>';
  } catch {
    payrollEl.innerHTML = '<p class="quiet-note">could not read rewards.</p>';
  }
}
payrollEl.addEventListener('click', async e => {
  if (!e.target.closest('#claim-rewards')) return;
  try {
    const w = walletClient || await connect();
    if (!w) return;
    const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'claimRewards', account });
    const hash = await w.writeContract(request);
    e.target.textContent = 'claiming…';
    await pub.waitForTransactionReceipt({ hash });
    await refreshPayroll(); await refreshStats();
  } catch (err) {
    e.target.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 60);
  }
});

// ---- the city's books: floor, volume, paid to holders ----
async function refreshStats() {
  try {
    const [paid, soldLogs] = await Promise.all([
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'totalPaidToHolders' }),
      pub.getLogs({ address: MARKET, event: SOLD, fromBlock: 0n, toBlock: 'latest' }),
    ]);
    let volume = 0n, lastSale = null;
    for (const l of soldLogs) { volume += l.args.price; lastSale = l.args.price; }
    const floor = listings.length ? listings.reduce((m, l) => l.price < m ? l.price : m, listings[0].price) : null;
    statsEl.innerHTML =
      '<div class="pay-row"><span>floor</span><strong>' + (floor != null ? fmtEth(floor) : '—') + '</strong></div>' +
      '<div class="pay-row"><span>last sale</span><strong>' + (lastSale != null ? fmtEth(lastSale) : '—') + '</strong></div>' +
      '<div class="pay-row"><span>volume traded</span><strong>' + fmtEth(volume) + '</strong></div>' +
      '<div class="pay-row"><span>paid to holders</span><strong class="gold">' + fmtEth(paid) + '</strong></div>';
  } catch {
    statsEl.innerHTML = '<p class="quiet-note">could not read the books.</p>';
  }
}

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

  // the deeds: certificate cards, cheapest first, filtered by chosen stock
  const filtered = stockFilter === 'all' ? listings : listings.filter(l => SYMBOLS[tokenOf(l.id)] === stockFilter);
  const byPrice = [...filtered].sort((a, b) => (a.price < b.price ? -1 : 1));
  const DCOLORS = ['#e3c67b', '#6f9fd0', '#9ec4e8', '#4d7db0', '#c3dcf3'];
  const dIdx = id => { const x = id % SIDE, y = (id / SIDE) | 0, dx = x - 15.5, dy = y - 15.5;
    if (dx * dx + dy * dy < 64) return 0; if (dx < 0 && dy < 0) return 1; if (dx >= 0 && dy < 0) return 2; if (dx < 0 && dy >= 0) return 3; return 4; };
  listingsEl.innerHTML = byPrice.map(l => {
    const mine = account && l.seller.toLowerCase() === account.toLowerCase();
    const dc = DCOLORS[dIdx(l.id)];
    return '<article class="deed" id="plot-' + l.id + '">' +
      // survey banner: the diorama as the card's visual anchor
      '<div class="deed-survey">' +
        '<canvas class="deed-map" width="220" height="120" data-map="' + l.id + '"></canvas>' +
        '<span class="deed-no">deed №&nbsp;' + String(l.id).padStart(4, '0') + '</span>' +
      '</div>' +
      // title line
      '<div class="deed-name">' +
        '<h3>plot ' + l.id + '</h3>' +
        '<span class="deed-loc">' + coords(l.id) + '</span>' +
      '</div>' +
      '<p class="deed-district"><i style="background:' + dc + '"></i>' + districtName(l.id) + '</p>' +
      // ledger facts
      '<dl class="deed-facts">' +
        '<div><dt>streams</dt><dd>' + SYMBOLS[tokenOf(l.id)] + ' &middot; ' + (apyOf(l.id) / 100).toFixed(2) + '%</dd></div>' +
        '<div><dt>per year</dt><dd>' + fmtEth(annualYield(l.id)) + '</dd></div>' +
        '<div><dt>held by</dt><dd><a href="' + addressUrl(l.seller) + '" target="_blank" rel="noopener">' + short(l.seller) + '</a>' + (mine ? ' <em>· you</em>' : '') + '</dd></div>' +
      '</dl>' +
      // price + action, as one settled foot
      '<div class="deed-foot">' +
        '<div class="deed-ask"><span>asking</span><strong>' + fmtEth(l.price) + '</strong></div>' +
        (mine
          ? '<button class="act cancel" data-cancel="' + l.id + '">withdraw</button>'
          : '<button class="act buy" data-buy="' + l.id + '" data-price="' + l.price + '">acquire<span class="arr">→</span></button>') +
      '</div>' +
      '<p class="tx" id="tx-' + l.id + '"></p></article>';
  }).join('') || '<p class="quiet-note">nothing listed for this stock right now.</p>';
  // staggered reveal
  [...listingsEl.querySelectorAll('.deed')].forEach((el, i) => {
    el.style.animationDelay = (i * 60) + 'ms';
    el.classList.add('deal-in');
  });
  drawDeedMaps();

  // who's selling
  drawSellers();
  // the ticker
  const track = document.querySelector('.ticker-track');
  if (track) {
    const items = byPrice.map(l => 'plot ' + l.id + ' <b>' + fmtEth(l.price) + '</b> · ' + districtName(l.id));
    const line = items.join('&nbsp;&nbsp;✦&nbsp;&nbsp;');
    track.innerHTML = line + '&nbsp;&nbsp;✦&nbsp;&nbsp;' + line; // doubled for seamless loop
  }
}

// deed diorama: a tiny isometric city with the plot as a lit beacon tower.
// animated — the beacon pulses and the surrounding blocks shimmer faintly.
const dioramas = [];
function drawDeedMaps() {
  dioramas.length = 0;
  for (const cv of document.querySelectorAll('.deed-map')) {
    dioramas.push({ cv, ctx: cv.getContext('2d'), id: Number(cv.dataset.map) });
  }
  if (!dioramas._running) { dioramas._running = true; requestAnimationFrame(tickDioramas); }
}
function tickDioramas(now) {
  const t = now / 1000;
  for (const d of dioramas) drawDiorama(d, t);
  requestAnimationFrame(tickDioramas);
}
function drawDiorama({ cv, ctx, id }, t) {
  const Wd = cv.width, Hd = cv.height;
  ctx.clearRect(0, 0, Wd, Hd);
  const G = 13; // grid cells shown (a window onto the city around the plot)
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
      let h = 4 + ((wx * 7 + wy * 13) % 6); // deterministic block height in px
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
  // faces
  ctx.fillStyle = lit ? 'rgba(210,225,245,0.55)' : 'rgba(30,55,92,0.6)';
  ctx.beginPath(); ctx.moveTo(x - hw, y); ctx.lineTo(x - hw, y - h); ctx.lineTo(x, y + hh - h); ctx.lineTo(x, y + hh); ctx.closePath(); ctx.fill();
  ctx.fillStyle = lit ? 'rgba(170,195,230,0.5)' : 'rgba(20,40,70,0.6)';
  ctx.beginPath(); ctx.moveTo(x + hw, y); ctx.lineTo(x + hw, y - h); ctx.lineTo(x, y + hh - h); ctx.lineTo(x, y + hh); ctx.closePath(); ctx.fill();
  // top
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + hw, y + hh - h); ctx.lineTo(x, y + th - h); ctx.lineTo(x - hw, y + hh - h); ctx.closePath(); ctx.fill();
  if (lit) { // beacon glow
    ctx.save(); ctx.globalAlpha = 0.4; ctx.shadowColor = '#e3c67b'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#e3c67b'; ctx.beginPath(); ctx.arc(x, y - h, 1.6, 0, 7); ctx.fill(); ctx.restore();
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
  account = addr; walletLink.textContent = short(addr); render(); refreshPayroll().catch(() => {});
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

document.getElementById('stock-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  stockFilter = tab.dataset.stock;
  for (const t of document.querySelectorAll('#stock-tabs .tab')) t.classList.toggle('active', t === tab);
  render();
});

loadListings().catch(err => { statusEl.textContent = 'could not read the marketplace.'; console.error(err); });
refreshStats().catch(() => {});
setInterval(() => { loadListings().catch(() => {}); refreshStats().catch(() => {}); if (account) refreshPayroll().catch(() => {}); }, 20000);

// ---- the city at dusk: two parallax layers of skyline drifting past a warm
// horizon glow, with a few lit windows flickering. calm, cinematic, not busy. ----
(function skyline() {
  const cv = document.getElementById('skyline');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  // a repeating band of buildings, generated deterministically
  function band(seed, count, minH, maxH) {
    const b = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const r = Math.abs(Math.sin((i + 1) * seed * 12.9898)) % 1;
      const w = 10 + r * 26;
      const h = minH + Math.abs(Math.sin((i + 1) * seed * 4.1)) * (maxH - minH);
      const gold = (i * 3 + Math.floor(seed * 7)) % 17 === 0;
      b.push({ x, w, h, gold, windows: Math.floor(h / 14) });
      x += w + 4;
    }
    return { blocks: b, width: x };
  }
  const far = band(1.7, 40, 26, 70);
  const near = band(3.3, 30, 40, 108);

  function fit() {
    W = cv.clientWidth; H = cv.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function drawBand(layer, speed, time, baseY, faceLo, faceHi, capCol) {
    const off = (time * speed) % layer.width;
    for (let pass = -1; pass <= Math.ceil(W / layer.width) + 1; pass++) {
      const shiftX = pass * layer.width - off;
      for (const blk of layer.blocks) {
        const x = shiftX + blk.x;
        if (x + blk.w < -40 || x > W + 40) continue;
        const y = baseY - blk.h;
        // body
        const g = ctx.createLinearGradient(0, y, 0, baseY);
        g.addColorStop(0, blk.gold ? faceHi.g : faceHi.n);
        g.addColorStop(1, blk.gold ? faceLo.g : faceLo.n);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, blk.w, blk.h);
        // roof cap line
        ctx.fillStyle = blk.gold ? capCol.g : capCol.n;
        ctx.fillRect(x, y, blk.w, 2);
        // a couple of warm lit windows, flickering slowly
        for (let wnd = 0; wnd < blk.windows; wnd++) {
          const wy = y + 8 + wnd * 12;
          const flick = Math.sin(time * 0.7 + blk.x + wnd * 2) > 0.4;
          if (!flick) continue;
          ctx.fillStyle = 'rgba(240,210,140,0.5)';
          ctx.fillRect(x + blk.w * 0.28, wy, 3, 4);
          if (blk.w > 22) ctx.fillRect(x + blk.w * 0.62, wy, 3, 4);
        }
      }
    }
  }
  function draw(now) {
    const time = now / 1000;
    ctx.clearRect(0, 0, W, H);
    // dusk horizon glow
    const glow = ctx.createRadialGradient(W * 0.5, H, 0, W * 0.5, H, W * 0.55);
    glow.addColorStop(0, 'rgba(140,110,70,0.30)');
    glow.addColorStop(0.5, 'rgba(60,70,110,0.14)');
    glow.addColorStop(1, 'rgba(12,35,64,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // far layer (slow, dim), then near (faster, sharper)
    drawBand(far, 6, time, H - 6,
      { n: 'rgba(24,44,76,0.7)', g: 'rgba(90,74,40,0.6)' },
      { n: 'rgba(40,64,104,0.7)', g: 'rgba(150,120,60,0.6)' },
      { n: 'rgba(70,100,150,0.5)', g: 'rgba(210,180,110,0.6)' });
    drawBand(near, 16, time, H,
      { n: 'rgba(16,34,62,0.92)', g: 'rgba(70,56,28,0.9)' },
      { n: 'rgba(30,54,92,0.92)', g: 'rgba(130,104,50,0.9)' },
      { n: 'rgba(90,120,170,0.7)', g: 'rgba(227,198,123,0.9)' });
    requestAnimationFrame(draw);
  }
  fit(); requestAnimationFrame(draw);
  window.addEventListener('resize', fit);
})();
