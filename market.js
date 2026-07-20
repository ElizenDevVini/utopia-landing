// Utopia marketplace: browse listings, compare earnings, see sellers, buy/list.
// Reads listings from the marketplace contract's events; plot attributes are
// computed locally (identical to the land contract) so it loads without heavy reads.

import {
  pub, marketAbi, landAbi, LAND, MARKET, SIDE, SYMBOLS,
  tokenOf, apyOf, annualYield, districtIdx, districtName, coords,
  fmtEth, short, addressUrl, refreshListings, refreshSales, listings, sales,
  floors, holderMarketSummary, connect,
} from './market-data.js?v=3';
import * as MD from './market-data.js?v=3';

const statusEl = document.getElementById('market-status');
const earnersEl = document.querySelector('#earners .body');
const listingsEl = document.querySelector('#listings .body');
const sellersEl = document.querySelector('#sellers .body');
const payrollEl = document.querySelector('#payroll .body');
const statsEl = document.querySelector('#citystats .body');
const walletLink = document.getElementById('wallet');

let stockFilter = 'all';

// ---- your land pays you: fee-share rewards + loyalty tier ----
const TIER1 = 30 * 86400, TIER2 = 90 * 86400;
async function refreshPayroll() {
  if (!MD.account) return;
  try {
    const { claimable, multiplierBps: multBps, loyaltySince: since } = await holderMarketSummary(MD.account);
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
    const w = MD.walletClient || await connect();
    if (!w) return;
    const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'claimRewards', account: MD.account });
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
    const [poolFeeBps] = await Promise.all([
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'poolFeeBps' }),
      refreshSales(),
    ]);
    let volume = 0n, generatedForHolders = 0n, lastSale = null;
    for (const sale of sales) {
      volume += sale.price;
      generatedForHolders += (sale.price * poolFeeBps) / 10000n;
      if (lastSale == null) lastSale = sale.price;
    }
    const floor = floors().global;
    statsEl.innerHTML =
      '<div class="pay-row"><span>floor</span><strong>' + (floor != null ? fmtEth(floor) : '—') + '</strong></div>' +
      '<div class="pay-row"><span>last sale</span><strong>' + (lastSale != null ? fmtEth(lastSale) : '—') + '</strong></div>' +
      '<div class="pay-row"><span>volume traded</span><strong>' + fmtEth(volume) + '</strong></div>' +
      '<div class="pay-row"><span>paid to holders</span><strong class="gold">' + fmtEth(generatedForHolders) + '</strong></div>';
  } catch {
    statsEl.innerHTML = '<p class="quiet-note">could not read the books.</p>';
  }
}

async function loadListings(force = false) {
  await refreshListings(force);
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
  const sortMode = document.getElementById('sort')?.value || 'price-asc';
  const byPrice = [...filtered].sort((a, b) => {
    if (sortMode === 'price-desc') return a.price < b.price ? 1 : -1;
    if (sortMode === 'yield-desc') return annualYield(b.id) < annualYield(a.id) ? -1 : 1;
    return a.price < b.price ? -1 : 1;
  });
  const DCOLORS = ['#e3c67b', '#6f9fd0', '#9ec4e8', '#4d7db0', '#c3dcf3'];
  listingsEl.innerHTML = byPrice.map(l => {
    const mine = MD.account && l.seller.toLowerCase() === MD.account.toLowerCase();
    const dc = DCOLORS[districtIdx(l.id)];
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
walletLink.addEventListener('click', async e => {
  e.preventDefault();
  try {
    const wallet = await connect();
    if (!wallet) { statusEl.textContent = 'install a wallet to trade.'; return; }
    walletLink.textContent = short(MD.account);
    render();
    refreshPayroll().catch(() => {});
  } catch {}
});

// ---- buy flow: confirm sheet with fee breakdown + preflight checks ----
const confirmEl = document.getElementById('confirm');

async function openConfirm(id, price) {
  const w = MD.walletClient || await connect();
  if (!w) return;
  walletLink.textContent = short(MD.account);
  confirmEl.hidden = false;
  confirmEl.innerHTML = '<div class="confirm-card"><p class="quiet-note">checking…</p></div>';
  // preflight: eligibility + native ETH balance (the two real-world failures)
  let eligible = null, balance = null;
  try {
    [eligible, balance] = await Promise.all([
      pub.readContract({ address: LAND, abi: landAbi, functionName: 'isEligible', args: [MD.account] }),
      pub.getBalance({ address: MD.account }),
    ]);
  } catch {}
  const fee = BigInt(price) * 300n / 10000n;
  const toHolders = BigInt(price) * 200n / 10000n;
  let blocker = '';
  if (eligible === false) {
    blocker = '<p class="confirm-block">this wallet isn’t approved yet. open the <a href="app.html">dashboard</a> — access sets up automatically in about a minute, then come back.</p>';
  } else if (balance != null && balance < BigInt(price)) {
    blocker = '<p class="confirm-block">not enough native ETH on robinhood chain. if your bridge gave you WETH, unwrap it — plots are paid for in native ETH.</p>';
  }
  confirmEl.innerHTML =
    '<div class="confirm-card">' +
      '<h3>acquire plot ' + id + '</h3>' +
      '<dl class="confirm-rows">' +
        '<div><dt>you pay</dt><dd>' + fmtEth(price) + '</dd></div>' +
        '<div><dt>streams</dt><dd>' + SYMBOLS[tokenOf(id)] + ' · ' + (apyOf(id) / 100).toFixed(2) + '%</dd></div>' +
        '<div><dt>seller receives</dt><dd>' + fmtEth(BigInt(price) - fee) + '</dd></div>' +
        '<div><dt>shared with all landholders</dt><dd class="gold">' + fmtEth(toHolders) + '</dd></div>' +
      '</dl>' +
      (blocker ||
        '<button class="act buy confirm-go" data-go="' + id + '" data-price="' + price + '">confirm · ' + fmtEth(price) + '<span class="arr">→</span></button>') +
      '<button class="confirm-close" data-close>close</button>' +
      '<p class="tx" id="confirm-tx"></p>' +
    '</div>';
}

confirmEl.addEventListener('click', async e => {
  if (e.target.closest('[data-close]') || e.target === confirmEl) { confirmEl.hidden = true; return; }
  const go = e.target.closest('[data-go]');
  if (!go) return;
  const id = Number(go.dataset.go);
  const txEl = document.getElementById('confirm-tx');
  try {
    const w = MD.walletClient || await connect();
    if (!w) return;
    txEl.textContent = 'confirm in your wallet…';
    const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'buy', args: [BigInt(id)], value: BigInt(go.dataset.price), account: MD.account });
    const hash = await w.writeContract(request);
    txEl.textContent = 'buying…';
    await pub.waitForTransactionReceipt({ hash });
    txEl.innerHTML = 'the deed is yours. <a href="my-land.html">see it in my land →</a>';
    await loadListings(true);
  } catch (err) {
    txEl.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 120);
  }
});

listingsEl.addEventListener('click', async e => {
  const buyBtn = e.target.closest('[data-buy]');
  const cancelBtn = e.target.closest('[data-cancel]');
  if (buyBtn) { openConfirm(Number(buyBtn.dataset.buy), buyBtn.dataset.price); return; }
  if (!cancelBtn) return;
  const id = Number(cancelBtn.dataset.cancel);
  const txEl = document.getElementById('tx-' + id);
  try {
    const w = MD.walletClient || await connect();
    if (!w) return;
    const { request } = await pub.simulateContract({ address: MARKET, abi: marketAbi, functionName: 'cancel', args: [BigInt(id)], account: MD.account });
    const hash = await w.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    txEl.textContent = 'listing cancelled.';
    await loadListings(true);
  } catch (err) {
    txEl.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 120);
  }
});
document.getElementById('sort').addEventListener('change', render);

document.getElementById('stock-tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  stockFilter = tab.dataset.stock;
  for (const t of document.querySelectorAll('#stock-tabs .tab')) t.classList.toggle('active', t === tab);
  render();
});

loadListings().then(() => refreshStats()).catch(err => { statusEl.textContent = 'could not read the marketplace.'; console.error(err); });
setInterval(() => { loadListings(true).catch(() => {}); refreshStats().catch(() => {}); if (MD.account) refreshPayroll().catch(() => {}); }, 20000);

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
