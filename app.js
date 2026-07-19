// Network-aware Utopia dashboard. Mainnet fails closed until the production
// deployment, provider, reserves, and eligibility flow are configured.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi, keccak256, encodePacked,
} from './vendor/viem.js?v=3';
import { BG, TOPS, HOVER_TOP, CLAIMED_TOP, IN, hash, prism, makeTip } from './iso.js?v=3';
import { addressUrl, MULTICALL3, NET, withNetwork } from './config.js?v=3';

const LAND = NET.land;
const UTOP = NET.utop;
const EXPLORER = NET.explorer;
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = NET.symbols;
const MINE_TOP = '#ffffff';
const WAD = 10n ** 18n;
const MAX_CLAIM_BATCH = 64;
// utopia token — used to rank access requests by holdings (biggest holders first)
const UTOPIA_TOKEN = '0x164d9da79722c5294369e79807980e0bff257777';
// where access requests get sent (form services block crypto solicitation)
const ACCESS_HANDLE = '@Utopiadet';
const ACCESS_HANDLE_URL = 'https://x.com/Utopiadet';
// optional: paste your Google Apps Script web-app URL here to auto-collect
// requests into a Sheet. Leave '' to use the copy-to-DM flow only. See
// contracts/../ACCESS_COLLECTION.md for the 4-line script + deploy steps.
const ACCESS_WEBHOOK = 'https://script.google.com/macros/s/AKfycbxCTc6Njp2nRwfXo2t5SbH0jE-Ft9sV0LuQpCG-04ByPlXj1KCWneCp3BJtjjlxXHQP_w/exec';
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

const pub = createPublicClient({
  chain,
  batch: { multicall: { wait: 16, batchSize: 4096 } },
  transport: http(NET.rpc, { retryCount: 1, timeout: 7000 }),
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

const view = { w: 0, h: 0, tw: 30, th: 15, ox: 0, oy: 0 };

let basePrices = null; // bigint[] in configured payment-token wei
let apys = null;
let tokIdx = null;
let tiers = null; // Uint8Array 0..3
let owned = new Uint8Array(PLOTS);
let mine = new Uint8Array(PLOTS);
let ownedCount = 0;
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
function fundedTokenNames() {
  const out = [];
  for (let i = 0; i < 5; i++) { const a = tokenAvailable(i); if (a && a > 0n) out.push(SYMBOLS[i]); }
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
  const tw = Math.min((w * 0.96) / SIDE, (2 * (h * 0.82)) / SIDE);
  view.tw = tw;
  view.th = tw / 2;
  view.ox = w / 2;
  view.oy = (h - SIDE * view.th) / 2 + view.th * 1.5;
}

function zOf(id) {
  const x = id % SIDE, y = (id / SIDE) | 0;
  if (!owned[id]) return 0.08;
  // sold plots rise as skyscrapers — deterministic height so everyone sees the
  // same skyline, taller toward the center
  const near = Math.exp(-((x - 15.5) ** 2 + (y - 15.5) ** 2) / 260);
  return 1.3 + hash(x + 7, y + 13) * 1.8 + near * 1.6;
}

function render() {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, view.w, view.h);
  for (let s = 0; s <= 2 * SIDE - 2; s++) {
    for (let x = Math.max(0, s - SIDE + 1); x <= Math.min(SIDE - 1, s); x++) {
      const y = s - x;
      const id = y * SIDE + x;
      const demo = DEMO_SKYLINE ? demoById.get(id) : null;
      let z = demo ? demo.h : zOf(id);
      let top;
      if (demo) top = MINE_TOP;
      else if (owned[id]) top = mine[id] ? MINE_TOP : CLAIMED_TOP;
      else if (DISTRICTS_ON) top = DISTRICTS[districtOf(x, y)].color;
      else top = tiers ? TIER_TOPS[tiers[id]] : TOPS[(hash(x, y) * 997) % 3 | 0];
      if (id === selected) z += 0.35;
      if (id === hoverId && id !== selected) top = HOVER_TOP;
      prism(ctx, view, x + IN, y + IN, x + 1 - IN, y + 1 - IN, z, top);
    }
  }
  if (DISTRICTS_ON) drawDistrictLabels();
  if (DEMO_SKYLINE) drawSkylineLabels();
}

function drawSkylineLabels() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = "600 " + Math.max(9, view.tw * 0.5) + "px 'Archivo', sans-serif";
  for (const p of DEMO_PLOTS) {
    const sx = view.ox + (p.x + 0.5 - (p.y + 0.5)) * (view.tw / 2);
    const sy = view.oy + (p.x + 0.5 + p.y + 0.5) * (view.th / 2) - (p.h + 0.7) * view.th;
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
  ctx.font = "600 " + Math.max(11, view.tw * 0.62) + "px 'Instrument Serif', serif";
  for (let i = 0; i < DISTRICTS.length; i++) {
    const [cx, cy] = DISTRICT_CENTROIDS[i];
    const sx = view.ox + (cx - cy) * (view.tw / 2);
    const sy = view.oy + (cx + cy) * (view.th / 2) - 1.6 * view.th;
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

async function refreshEligibility() {
  if (!NET.requiresEligibility || !account) {
    accountEligible = NET.requiresEligibility ? null : true;
  } else {
    // null = read failed / unknown (don't hard-block); true/false = confirmed
    accountEligible = await pub.readContract({
      address: LAND, abi, functionName: 'isEligible', args: [account],
    }).catch(() => null);
  }
  renderHoldings();
  if (selected >= 0) renderSel();
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
  unpackBits(bm, owned);
  // merge in plots bought on earlier contracts so nobody's purchase disappears
  for (const legacy of NET.legacyLands || []) {
    try {
      const lbm = await pub.readContract({ address: legacy, abi, functionName: 'ownershipBitmap' });
      orBits(lbm, owned);
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
    unpackBits(my, mine);
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
}

async function refreshClaimables() {
  if (!NET.ready) return;
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
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
    await wallet.addChain({ chain });
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
  const list = discovered();
  if (!list.length) {
    selEl.innerHTML = '<h3>no wallet</h3><p class="quiet-note">install MetaMask or Phantom to buy. the map stays readable without one.</p>';
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
    // this plot's reward token must have reserve, or the buy reverts on-chain
    const avail = tokenAvailable(tokIdx[id]);
    const unfunded = avail != null && avail <= 0n;
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
        ? 'request access to buy'
        : account ? 'buy for ' + fmtPrice(priceNow(id)) : 'connect wallet to buy';
      selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
        '<button id="' + (needsAccess ? 'reqaccess' : 'act') + '" data-act="buy">' + label + '</button>' +
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
      (blocked ? '<p><a href="#" id="reqaccess">request access</a></p>' : '') +
      '<p class="txstate"></p>';
  } else {
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · owned</h3>' + rows +
      '<p><a href="' + EXPLORER + '/token/' + LAND + '/instance/' + id + '" target="_blank" rel="noopener">deed on the explorer</a></p>';
  }
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
      mine[ids[0]] = 1;
      ownedCount = owned.reduce((a, b) => a + b, 0);
    }
    await refreshTreasury();
    await Promise.all([refreshOwnership(), refreshEligibility()]);
    // re-assert after refresh in case the node's plotsOf read hadn't caught up
    if (act === 'buy') { owned[ids[0]] = 1; mine[ids[0]] = 1; }
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
      txState('wallet not approved yet. request access below.', root);
      return;
    }
    txState(/rejected|denied/i.test(m) ? 'cancelled.' : m.toLowerCase().slice(0, 240), root);
  }
}

selEl.addEventListener('click', e => {
  const req = e.target.closest('#reqaccess');
  if (req) { e.preventDefault(); requestAccess(req); return; }
  const btn = e.target.closest('#act');
  if (btn && selected >= 0) doTx(btn.dataset.act, [selected], btn);
});

// send an access request to Formspree, tagged with the wallet's $utopia holdings
async function requestAccess(btn) {
  if (!account) {
    try { await connect({ prompt: true }); } catch {}
    if (!account) return;
  }
  if (btn) btn.disabled = true;
  let held = 0;
  try {
    const bal = await pub.readContract({ address: UTOPIA_TOKEN, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    held = Number(bal) / 1e18;
  } catch {}
  const line = account + ' · ' + held.toLocaleString() + ' $UTOPIA';
  // auto-collect to your own endpoint if configured (no-cors: fire-and-forget)
  if (ACCESS_WEBHOOK) {
    fetch(ACCESS_WEBHOOK, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ wallet: account, utopiaHeld: held, at: Date.now() }),
    }).catch(() => {});
  }
  try { await navigator.clipboard.writeText(line); } catch {}
  selEl.innerHTML = '<h3>request access</h3>' +
    '<p class="quiet-note">' + (ACCESS_WEBHOOK ? 'sent, and copied. ' : 'copied. ') +
    'send it to <a href="' + ACCESS_HANDLE_URL + '" target="_blank" rel="noopener">' +
    ACCESS_HANDLE + '</a> to get approved. bigger $utopia holders go first.</p>' +
    '<p class="quiet-note" style="word-break:break-all">' + line + '</p>';
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
        ? '<a href="#" id="reqaccess">required · request access</a>' : 'checking…') +
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
      '<span class="amt">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></li>';
  }).join('');
  const claimBlocked = NET.requiresEligibility && accountEligible === false;
  holdingsEl.innerHTML = bal + eligibility + '<ul class="holdlist">' + items + '</ul>' +
    '<button id="claimall"' + (claimBlocked ? ' disabled' : '') + '>' +
    (claimBlocked ? 'eligibility required to claim' : ids.length > MAX_CLAIM_BATCH ? 'claim first 64' : 'claim all') +
    '</button> ' + faucetBtn + nativeFaucet + portfolio + '<p class="txstate"></p>';
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
    for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
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
  const buyable = id => { const a = tokenAvailable(tokIdx[id]); return a == null || a > 0n; };
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
    ? 'fixed ETH prices · rewards stop on ' + formatRewardEnd() + ' · every sold plot is fully reserved.'
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
    '<div class="row"><span class="k">streaming now</span><span class="v">' + ownedCount + ' plots</span></div>' +
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

// is (mx,my) inside the drawn top face of tile (x,y) at height z
function inTopFace(mx, my, x, y, z) {
  const cx = view.ox + (x - y) * (view.tw / 2);
  const cy = view.oy + (x + y + 1) * (view.th / 2) - z * view.th;
  return Math.abs(mx - cx) / (view.tw / 2) + Math.abs(my - cy) / (view.th / 2) <= 1;
}

function pick(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  // ground-plane guess, then search nearby for the frontmost raised block
  // whose top face actually sits under the cursor
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
      const score = (x + y) * 10 + zOf(id); // frontmost (drawn last, on top) wins
      if (score > bestScore) { bestScore = score; best = id; }
    }
  }
  return best;
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

setInterval(() => { if (loaded && !document.hidden) refreshOwnership().catch(() => {}); }, 10000);
setInterval(() => { if (loaded && !document.hidden && account) refreshClaimables().catch(() => {}); }, 10000);
// codex: eligibility can be granted while the dashboard is already open; do
// not leave a previously-false wallet blocked until it reconnects or reloads.
setInterval(() => { if (loaded && !document.hidden && account) refreshEligibility().catch(() => {}); }, 15000);
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
