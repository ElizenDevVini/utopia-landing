// Network-aware Utopia dashboard. Mainnet remains deliberately disabled until
// reviewed contract and oracle addresses are configured.

import {
  createPublicClient, createWalletClient, custom, http,
  defineChain, parseAbi,
} from './vendor/viem.js';
import { BG, TOPS, HOVER_TOP, CLAIMED_TOP, IN, hash, prism, makeTip } from './iso.js';
import { addressUrl, MULTICALL3, NET, withNetwork } from './config.js';

const LAND = NET.land;
const UTOP = NET.utop;
const EXPLORER = NET.explorer;
const SIDE = 32;
const PLOTS = 1024;
const SYMBOLS = NET.symbols;
const MINE_TOP = '#ffffff';
const WAD = 10n ** 18n;
const MAX_CLAIM_BATCH = 64;
const CLAIMED_TOPIC = '0x3e356ee9071ea983e847cc7da7b8b224b8f44262f7c9ce77262ea0e854a5442c';

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
  testnet: NET.key !== 'mainnet',
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
]);

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function faucet()',
]);

const pub = createPublicClient({
  chain,
  batch: { multicall: { wait: 16, batchSize: 4096 } },
  transport: http(NET.rpc),
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
let paymentBalance = null;
let treasuryBalances = null;

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
  if (!NET.ready) return;
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

async function refreshTreasury() {
  if (!NET.ready) return;
  const tokenAddresses = await Promise.all(Array.from({ length: 5 }, (_, i) =>
    pub.readContract({ address: LAND, abi, functionName: 'tokens', args: [BigInt(i)] })
  ));
  treasuryBalances = await Promise.all(tokenAddresses.map(token =>
    pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [LAND] })
      .catch(() => null)
  ));
  renderMarket();
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
  ownedCount = unpackBits(bm, owned);
  if (account) {
    const [my, bal] = await Promise.all([
      pub.readContract({ address: LAND, abi, functionName: 'plotsOf', args: [account] }),
      NET.payment === 'native'
        ? pub.getBalance({ address: account })
        : pub.readContract({ address: UTOP, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    ]);
    unpackBits(my, mine);
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
  const multiplierText = NET.landVersion === 1 ? '' : ' · market multiplier ' + fmtMult();
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

async function load() {
  if (!NET.ready) return;
  try {
    if (!basePrices) await loadStatic();
    await Promise.all([refreshOwnership(), refreshTreasury()]);
    loaded = true;
  } catch (e) {
    statusEl.textContent = 'the chain is not answering right now. retrying shortly.';
    setTimeout(load, 30000);
  }
}

// ---- wallet ----

function getWalletClient() {
  if (!walletClient && window.ethereum) {
    walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
  }
  return walletClient;
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

async function connect({ prompt = true } = {}) {
  if (!NET.ready) {
    selEl.innerHTML = '<h3>mainnet pending</h3><p class="quiet-note">the mainnet contracts and reviewed oracle are not deployed yet. the funded testnet remains available.</p>';
    return null;
  }
  if (!window.ethereum) {
    selEl.innerHTML = '<h3>no wallet</h3><p class="quiet-note">utopia needs a browser wallet like MetaMask or Rabby. the map stays readable without one.</p>';
    return null;
  }
  const wallet = getWalletClient();
  const addresses = prompt ? await wallet.requestAddresses() : await wallet.getAddresses();
  const addr = addresses[0];
  if (!addr) return null;
  await ensureWalletChain(wallet);
  account = addr;
  walletLink.textContent = short(addr);
  await refreshOwnership();
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

if (window.ethereum) {
  window.ethereum.on?.('accountsChanged', async accs => {
    account = accs[0] || null;
    walletLink.textContent = account ? short(account) : 'connect wallet';
    claimables.clear();
    if (NET.ready) await refreshOwnership().catch(() => {});
    if (NET.ready && account) await refreshClaimables().catch(() => {});
  });
  window.ethereum.on?.('chainChanged', chainIdHex => {
    if (Number(chainIdHex) !== chain.id) {
      account = null;
      mine.fill(0);
      claimables.clear();
      walletLink.textContent = 'switch network';
      renderHoldings();
      schedule();
    } else {
      connect({ prompt: false }).catch(() => {});
    }
  });
  window.ethereum.on?.('disconnect', () => {
    account = null;
    mine.fill(0);
    claimables.clear();
    walletLink.textContent = 'connect wallet';
    renderHoldings();
    schedule();
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
    '<div class="row"><span class="k">price</span><span class="v">' + fmtPrice(priceNow(id)) + '</span></div>' +
    '<div class="row"><span class="k">base reward rate</span><span class="v">' + (apys[id] / 100).toFixed(2) + '%</span></div>' +
    '<div class="row"><span class="k">reward token</span><span class="v">' + SYMBOLS[tokIdx[id]] + '</span></div>';
  if (!owned[id]) {
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + '</h3>' + rows +
      '<button id="act" data-act="buy">' + (account ? 'buy for ' + fmtPrice(priceNow(id)) : 'connect wallet to buy') + '</button>' +
      '<p class="txstate"></p>';
  } else if (mine[id]) {
    const c = claimables.get(id);
    selEl.innerHTML = '<h3>plot ' + id + ' ' + coords(id) + ' · yours</h3>' + rows +
      '<div class="row"><span class="k">claimable</span><span class="v">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></div>' +
      '<button id="act" data-act="claim">claim rewards</button>' +
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
    if (btn) btn.disabled = true;
    let hash_;
    if (act === 'buy') {
      const id = ids[0];
      const price = priceNow(id);
      if (paymentBalance != null && paymentBalance < price) {
        const message = NET.payment === 'native'
          ? 'not enough test ETH. use the faucet link below.'
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
          await pub.waitForTransactionReceipt({ hash: approvalHash });
        }
      }
      txState('confirm the buy in your wallet…', root);
      hash_ = await wallet.writeContract({
        address: LAND,
        abi,
        functionName: 'buy',
        args: [BigInt(id)],
        ...(NET.payment === 'native' ? { value: price } : {}),
        account,
      });
    } else if (act === 'claim') {
      hash_ = await wallet.writeContract({ address: LAND, abi, functionName: 'claim', args: [BigInt(ids[0])], account });
    } else if (act === 'claimMany') {
      hash_ = await wallet.writeContract({ address: LAND, abi, functionName: 'claimMany', args: [ids.map(BigInt)], account });
    } else {
      hash_ = await wallet.writeContract({ address: UTOP, abi: erc20Abi, functionName: 'faucet', account });
    }
    txPending(hash_, root);
    const receipt = await pub.waitForTransactionReceipt({ hash: hash_ });
    await Promise.all([refreshOwnership(), refreshTreasury()]);
    await refreshClaimables();
    renderSel();
    root = txRoot(act);
    const success = act === 'buy'
      ? 'yours. the block just rose.'
      : act === 'faucet' ? '1,000 testnet UTOP received.' : claimSummary(receipt);
    txState(success, root);
  } catch (err) {
    if (btn) btn.disabled = false;
    const m = (err?.shortMessage || err?.message || 'failed').split('\n')[0];
    txState(/rejected|denied/i.test(m) ? 'cancelled.' : m.toLowerCase().slice(0, 240), root);
  }
}

selEl.addEventListener('click', e => {
  const btn = e.target.closest('#act');
  if (btn && selected >= 0) doTx(btn.dataset.act, [selected], btn);
});

// ---- holdings ----

function renderHoldings() {
  if (!account) {
    holdingsEl.innerHTML = '<p class="quiet-note">connect a wallet to see your plots and rewards.</p>';
    return;
  }
  const paymentName = NET.payment === 'native' ? 'ETH balance' : 'UTOP balance';
  const bal = '<div class="row"><span class="k">' + paymentName + '</span><span class="v">' +
    (paymentBalance != null ? fmtPrice(paymentBalance) : '…') + '</span></div>';
  const faucetBtn = NET.utopFaucet ? '<button id="getutop">get 1,000 UTOP</button>' : '';
  const nativeFaucet = NET.nativeFaucet
    ? '<p><a href="' + NET.nativeFaucet + '" target="_blank" rel="noopener">get test ETH for gas</a></p>'
    : '';
  const ids = [];
  for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
  if (!ids.length) {
    holdingsEl.innerHTML = bal + '<p class="quiet-note">no plots yet. click an open one on the map.</p>' +
      faucetBtn + nativeFaucet + '<p class="txstate"></p>';
    return;
  }
  const items = ids.map(id => {
    const c = claimables.get(id);
    return '<li><button class="plotlink" data-id="' + id + '">plot ' + id + '</button>' +
      '<span class="amt">' + (c != null ? fmtTok(c, tokIdx[id]) : '…') + '</span></li>';
  }).join('');
  holdingsEl.innerHTML = bal + '<ul class="holdlist">' + items + '</ul>' +
    '<button id="claimall">' + (ids.length > MAX_CLAIM_BATCH ? 'claim first 64' : 'claim all') + '</button> ' +
    faucetBtn + nativeFaucet + '<p class="txstate"></p>';
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
    const btn = e.target.closest('#claimall');
    const ids = [];
    for (let i = 0; i < PLOTS; i++) if (mine[i]) ids.push(i);
    if (ids.length) doTx('claimMany', ids.slice(0, MAX_CLAIM_BATCH), btn);
    return;
  }
  const faucet = e.target.closest('#getutop');
  if (faucet) doTx('faucet', [], faucet);
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
  const reserves = treasuryBalances == null
    ? '<p class="quiet-note">checking reward reserves…</p>'
    : treasuryBalances.every(balance => balance === 0n)
      ? '<p class="reserve-warning">reward treasury empty · claims accrue as debt but cannot pay out</p>'
      : '<p class="quiet-note">reward reserves · ' + treasuryBalances.map((balance, i) =>
        balance == null ? SYMBOLS[i] + ' unavailable' : fmtTok(balance, i)
      ).join(' · ') + '</p>';
  const marketNote = NET.landVersion === 1
    ? 'plot prices are fixed in test ETH. reward rates are reference streaming rates, not investment APY.'
    : NET.landVersion === 2
      ? 'testnet V2 scales both UTOP plot prices and reward rates with its current market multiplier.'
      : 'mainnet-candidate plot prices stay fixed in UTOP; checkpointed market growth affects only future reward intervals.';
  const multiplierRow = NET.landVersion === 1 ? '' :
    '<div class="row"><span class="k">multiplier</span><span class="v">' + fmtMult() + '</span></div>';
  marketEl.innerHTML =
    '<div class="row"><span class="k">open plots</span><span class="v">' + (PLOTS - ownedCount) + '</span></div>' +
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
      const l1 = 'plot ' + id + (owned[id] ? (mine[id] ? ' · yours' : ' · owned') : ' · ' + fmtPrice(priceNow(id)));
      const l2 = (apys[id] / 100).toFixed(2) + '% base rate · rewards in ' + SYMBOLS[tokIdx[id]];
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
setInterval(() => { if (loaded && !document.hidden) refreshTreasury().catch(() => {}); }, 60000);

window.addEventListener('resize', () => { fit(); schedule(); });

function configurePage() {
  document.querySelector('.crumb').textContent = 'dashboard · ' + NET.label;
  document.querySelector('.wordmark').href = withNetwork('./');

  const disclaimer = document.getElementById('network-disclaimer');
  disclaimer.textContent = NET.key === 'mainnet'
    ? 'mainnet preview only. contracts and reviewed oracle are not deployed.'
    : 'testnet only. test ETH and testnet Stock Tokens have no value. not an offer of anything.';

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
    holdingsEl.innerHTML = '<p class="quiet-note">mainnet contracts are not deployed yet.</p>';
    marketEl.innerHTML = '<p class="quiet-note">mainnet deployment and reviewed oracle pending.</p>';
  }
}

configurePage();
fit();
render();
if (NET.ready) {
  load();
  connect({ prompt: false }).catch(() => {});
} else {
  statusEl.textContent = 'utopia is not deployed on ' + NET.label + ' yet. the testnet city is live.';
}
