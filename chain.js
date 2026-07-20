// Read-only live land map. Wallet actions live on the dashboard.

// vendored tree-shaken viem 2.21.19 bundle; the site itself has no build step
import {
  createPublicClient, custom, defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=14';

import { addressUrl, MULTICALL3, NET, resilientReadTransport, withNetwork } from './config.js?v=14';

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
});

const abi = parseAbi([
  'function multiplierWad() view returns (uint256)',
  'function marketMultiplierWad() view returns (uint256)',
  'function ownershipBitmap() view returns (uint256[4])',
  'function plotsPacked() view returns (uint256[1024])',
]);

const BUILDINGS = NET.buildings || '';
const buildingsAbi = parseAbi([
  'function getBuildings(uint256[] ids) view returns ((bool set,uint24 color,uint8 style,uint8 height)[], string[])',
]);
let builds = new Array(PLOTS).fill(null); // owner-set cosmetics, mirrored from the dashboard

const pub = createPublicClient({
  chain,
  batch: { multicall: { wait: 16, batchSize: 4096 } },
  transport: resilientReadTransport(custom),
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
let currentOwned = new Uint8Array(PLOTS);
let ownedCount = 0;
let currentOwnedCount = 0;
const legacyLandForPlot = new Array(PLOTS).fill(null);
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
  if (builds[id]) return 0.6 + builds[id].height * 0.55 + (builds[id].style === 1 ? 0.8 : 0);
  return 0.35 + U.hash(x + 7, y + 13) * 0.85;
}

// footprint inset per style: spire slim, dome mid, plaza flat-wide
function styleInset(id) {
  const c = builds[id];
  if (!c) return U.IN;
  if (c.style === 1) return 0.28;
  if (c.style === 3) return 0.16;
  if (c.style === 4) return 0.02;
  return U.IN;
}

function render() {
  ctx.fillStyle = U.BG;
  ctx.fillRect(0, 0, view.w, view.h);
  for (let s = 0; s <= 2 * SIDE - 2; s++) {
    for (let x = Math.max(0, s - SIDE + 1); x <= Math.min(SIDE - 1, s); x++) {
      const y = s - x;
      const id = y * SIDE + x;
      let z = zOf(id);
      let top;
      if (owned[id] && builds[id]) top = builds[id].color;
      else top = owned[id] ? U.CLAIMED_TOP : U.TOPS[(U.hash(x, y) * 997) % 3 | 0];
      if (id === selected) z += 0.35;
      if (id === hoverId && id !== selected) top = U.HOVER_TOP;
      const inset = owned[id] ? styleInset(id) : U.IN;
      U.prism(ctx, view, x + inset, y + inset, x + 1 - inset, y + 1 - inset, z, top);
    }
  }
  drawBuildingLabels();
}

// building names float above owner-customized plots
function drawBuildingLabels() {
  let any = false;
  for (let i = 0; i < PLOTS; i++) if (builds[i] && builds[i].name) { any = true; break; }
  if (!any) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 ' + Math.max(8, view.tw * 0.42) + "px 'Archivo', sans-serif";
  for (let id = 0; id < PLOTS; id++) {
    const c = builds[id];
    if (!c || !c.name) continue;
    const x = id % SIDE, y = (id / SIDE) | 0;
    const sx = view.ox + (x + 0.5 - (y + 0.5)) * (view.tw / 2);
    const sy = view.oy + (x + 0.5 + y + 0.5) * (view.th / 2) - (zOf(id) + 0.5) * view.th;
    ctx.fillStyle = 'rgba(12,35,64,0.9)';
    ctx.fillText(c.name, sx + 1, sy + 1);
    ctx.fillStyle = '#f0f5fb';
    ctx.fillText(c.name, sx, sy);
  }
  ctx.restore();
}

async function refreshBuildings() {
  if (!BUILDINGS) return;
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (owned[i]) ids.push(i);
  if (!ids.length) { builds = new Array(PLOTS).fill(null); return; }
  try {
    const [bs, ns] = await pub.readContract({
      address: BUILDINGS, abi: buildingsAbi, functionName: 'getBuildings', args: [ids.map(BigInt)],
    });
    const next = new Array(PLOTS).fill(null);
    ids.forEach((id, i) => {
      const b = bs[i];
      if (b.set) {
        next[id] = {
          color: '#' + Number(b.color).toString(16).padStart(6, '0'),
          style: Number(b.style), height: Number(b.height), name: ns[i] || '',
        };
      }
    });
    builds = next;
    schedule();
  } catch {}
}

let raf = 0;
function schedule() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
}

// ---- chain reads ----

// deterministic plot attributes, computed locally (matches the contract) so
// the map loads instantly without a heavy plotsPacked RPC call
function contractTokenOf(id) {
  if (NET.rewardMode < 5) return NET.rewardMode;
  const x = id % SIDE, y = (id / SIDE) | 0;
  const dx = 2 * x - 31, dy = 2 * y - 31;
  if (dx * dx + dy * dy < 256) return 2;
  if (dx < 0 && dy < 0) return 0;
  if (dx >= 0 && dy < 0) return 1;
  if (dx < 0 && dy >= 0) return 3;
  return 4;
}
function h256(salt, id) {
  return BigInt(keccak256(encodePacked(['string', 'uint256'], [salt, BigInt(id)])));
}
function loadStatic() {
  prices = new Array(PLOTS);
  apys = new Uint16Array(PLOTS);
  tokIdx = new Uint8Array(PLOTS);
  for (let id = 0; id < PLOTS; id++) {
    const x = id % SIDE, y = (id / SIDE) | 0;
    const base = 500000000000000n + (h256('utopia/price/v1', id) % 2000000000000000n);
    const premium = (2500000000000000n * 300n) / (300n + BigInt(x * x + y * y));
    const raw = base + premium;
    prices[id] = raw - (raw % 10000000000000n);
    apys[id] = Number(310n + (h256('utopia/apy/v1', id) % 271n));
    tokIdx[id] = contractTokenOf(id);
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
  unpackBits(bm, currentOwned);
  owned.set(currentOwned);
  currentOwnedCount = currentOwned.reduce((sum, bit) => sum + bit, 0);
  legacyLandForPlot.fill(null);
  // codex: keep the public landing map consistent with the dashboard by
  // preserving purchases made against configured earlier land contracts.
  for (const legacy of NET.legacyLands || []) {
    try {
      const legacyBitmap = await pub.readContract({
        address: legacy,
        abi,
        functionName: 'ownershipBitmap',
      });
      orBits(legacyBitmap, owned);
      for (let i = 0; i < PLOTS; i++) {
        if (!currentOwned[i] && ((legacyBitmap[i >> 8] >> BigInt(i & 255)) & 1n)) {
          legacyLandForPlot[i] ||= legacy;
        }
      }
    } catch {}
  }
  ownedCount = owned.reduce((sum, bit) => sum + bit, 0);
  const contractLink = document.createElement('a');
  contractLink.href = addressUrl(LAND);
  contractLink.target = '_blank';
  contractLink.rel = 'noopener';
  contractLink.textContent = 'contract';
  statusEl.replaceChildren(
    document.createTextNode(
      ownedCount + ' of 1,024 plots owned · ' + currentOwnedCount + ' current + ' +
      (ownedCount - currentOwnedCount) + ' legacy · ' + NET.label + ' · '
    ),
    contractLink,
  );
  schedule();
  refreshBuildings().catch(() => {});
}

async function load() {
  if (!NET.ready) return;
  if (!prices) loadStatic(); // local + instant, no RPC
  loaded = true;
  schedule();
  refreshOwnership().catch(() => setTimeout(() => refreshOwnership().catch(() => {}), 8000));
}

// ---- panel / interactions ----

function setPanel(html) {
  panel.innerHTML = html;
  panel.hidden = false;
}

// the landing map is read-only; buying and claiming live on the dashboard
function panelFor(id) {
  const name = 'plot ' + id;
  if (owned[id] && !currentOwned[id]) {
    const legacyLand = legacyLandForPlot[id];
    const legacyLink = legacyLand
      ? EXPLORER + '/token/' + legacyLand + '/instance/' + id
      : null;
    // codex: legacy deeds remain visible, but never inherit current-contract
    // reward copy or explorer links on the public landing page.
    setPanel('<b>' + name + ' · legacy deed</b>' +
      '<p>owned on an earlier land contract · not part of the current reward stream</p>' +
      (legacyLink ? '<p><a href="' + legacyLink + '" target="_blank" rel="noopener">legacy deed on the explorer</a></p>' : ''));
    return;
  }
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

function inTopFace(mx, my, x, y, z) {
  const cx = view.ox + (x - y) * (view.tw / 2);
  const cy = view.oy + (x + y + 1) * (view.th / 2) - z * view.th;
  return Math.abs(mx - cx) / (view.tw / 2) + Math.abs(my - cy) / (view.th / 2) <= 1;
}

function pick(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const a = (mx - view.ox) / (view.tw / 2);
  const b = (my - view.oy) / (view.th / 2);
  const bx = Math.floor((a + b) / 2), by = Math.floor((b - a) / 2);
  let best = -1, bestScore = -1;
  for (let dy = -1; dy <= 4; dy++) {
    for (let dx = -1; dx <= 4; dx++) {
      const x = bx + dx, y = by + dy;
      if (x < 0 || x >= SIDE || y < 0 || y >= SIDE) continue;
      const id = y * SIDE + x;
      if (!inTopFace(mx, my, x, y, zOf(id))) continue;
      const score = (x + y) * 10 + zOf(id);
      if (score > bestScore) { bestScore = score; best = id; }
    }
  }
  return best;
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
    pollTimer = setInterval(() => refreshOwnership().catch(() => {}), 10000);
  }
}).observe(canvas);

window.addEventListener('resize', () => { fit(); schedule(); });

function configureCopy() {
  const liveCopy = document.getElementById('live-copy');
  const faqTry = document.getElementById('faq-try');
  const faqBacking = document.getElementById('faq-backing');
  const faqLive = document.getElementById('faq-live');
  const footerCopy = document.getElementById('footer-copy');
  const contractLink = document.createElement('a');
  contractLink.href = addressUrl(LAND) || '#';
  contractLink.target = '_blank';
  contractLink.rel = 'noopener';
  contractLink.textContent = 'configured contract';
  const dashboardLink = document.createElement('a');
  dashboardLink.href = withNetwork('app.html');
  dashboardLink.textContent = 'dashboard';

  if (!NET.ready) {
    liveCopy.textContent = 'The mainnet profile is intentionally disabled: ' + NET.activationIssue + '. Activation also requires verified contracts, full reserve coverage, and a recorded fresh-wallet proof.';
    faqTry.textContent = 'Use the preview profile today. Mainnet wallet actions stay disabled until every production gate passes.';
    faqBacking.textContent = 'The production contract reserves each sold plot’s complete finite reward obligation and prevents the owner from removing committed Stock Tokens. It is not deployed or audited yet.';
    document.getElementById('chain-copy').append(' The mainnet Utopia deployment is still pending.');
    faqLive.textContent = 'The preview loop is live and verifiable. The mainnet profile is not active until every release gate passes.';
    footerCopy.textContent = 'utopia mainnet is not active. use the funded preview prototype to inspect the current product loop.';
    return;
  }

  const profileText = NET.landVersion === 4
    ? 'This grid reads the production ETH-priced city: 1,024 plots on the '
    : NET.landVersion === 1
      ? 'This grid reads the ETH-priced preview prototype: 1,024 plots on the '
      : 'This grid reads the funded UTOP-priced preview: 1,024 plots on the ';
  const economicText = NET.landVersion === 4
    ? ' Each sold plot’s finite Stock Token reward is reserved in full. Purchases, transfers, and claims require current eligibility. Open the '
    : NET.landVersion === 1
      ? ' Plots use preview ETH. The dashboard checks all five reward reserves live and warns when claims can only accrue as unpaid debt. Open the '
      : ' Plots use preview UTOP. V2 scales both plot prices and reward rates with its preview-only market multiplier. Open the ';
  liveCopy.replaceChildren(
    document.createTextNode(profileText),
    contractLink,
    document.createTextNode('.' + economicText),
    dashboardLink,
    document.createTextNode(' to inspect or interact.'),
  );
  faqTry.textContent = NET.landVersion === 4
    ? 'Complete the eligibility flow, connect an eligible wallet with ETH, then select an open plot on the dashboard.'
    : NET.payment === 'native'
      ? 'Get preview ETH for gas and plot payment, then open the dashboard and select an empty plot.'
    : 'Get preview ETH for gas and preview UTOP from the dashboard faucet, then select an empty plot.';
  faqBacking.textContent = NET.landVersion === 4
    ? 'Every sold plot is backed through the immutable reward deadline. Committed Stock Tokens cannot be withdrawn by the owner; balances and commitments are public.'
    : 'Only Stock Tokens already held by the land contract can fund payouts. The dashboard reads those reserves live and reports any unpaid debt after a claim.';
  if (NET.landVersion === 4) {
    faqLive.textContent = 'Yes. This profile reads the verified Robinhood Chain mainnet contracts and their funded reserve state.';
    footerCopy.textContent = 'utopia runs on Robinhood Chain mainnet. Eligibility is required. Stock Tokens are restricted tokenized debt securities.';
  }
}

fit();
render();
configureCopy();
walletLink.href = withNetwork('app.html');
walletLink.textContent = NET.ready ? 'open dashboard' : 'mainnet pending';
document.querySelectorAll('a[href="app.html"]').forEach(link => { link.href = withNetwork('app.html'); });

if (!NET.ready) {
  statusEl.textContent = 'mainnet is not active · ' + NET.activationIssue + '.';
}
