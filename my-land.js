// My land: see every plot you hold, what it earns, and list/manage sales.

import {
  pub, marketAbi, landAbi, LAND, MARKET, SYMBOLS,
  tokenOf, apyOf, annualYield, districtIdx, districtName, DCOLORS, coords,
  fmtEth, short, addressUrl, bitmapToIds, floors,
  refreshListings, listings, lastSaleFor, refreshSales,
  claimablesFor, holderMarketSummary, connect, mountDioramas,
} from './market-data.js?v=3';
import * as MD from './market-data.js?v=3';

const statusEl = document.getElementById('page-status');
const earningsEl = document.getElementById('earnings');
const holdingsEl = document.querySelector('#holdings .body');
const walletLink = document.getElementById('wallet');
const claimBtn = document.getElementById('claim-rewards');
const streakWarn = document.getElementById('streak-warning');

let myPlots = []; // ids
let myClaimables = new Map(); // id -> stock wei
let myListings = new Map(); // id -> price

async function loadMine(forceMarket = false) {
  if (!MD.account) return;
  statusEl.textContent = 'reading your land…';
  const [words] = await Promise.all([
    pub.readContract({ address: LAND, abi: landAbi, functionName: 'plotsOf', args: [MD.account] }),
    refreshListings(forceMarket).catch(() => {}),
    refreshSales(forceMarket).catch(() => {}),
  ]);
  myPlots = bitmapToIds(words);
  myListings = new Map(listings.filter(l => l.seller.toLowerCase() === MD.account.toLowerCase()).map(l => [l.id, l.price]));
  // accrued stock per plot, batched
  const vals = await claimablesFor(myPlots);
  myClaimables = new Map(myPlots.map((id, i) => [id, vals[i]]));
  await refreshEarnings();
  render();
}

async function refreshEarnings() {
  try {
    const { claimable, multiplierBps: multBps, loyaltySince: since } = await holderMarketSummary(MD.account);
    earningsEl.hidden = false;
    streakWarn.hidden = false;
    document.getElementById('e-plots').textContent = myPlots.length;
    document.getElementById('e-earned').textContent = fmtEth(claimable);
    document.getElementById('e-tier').textContent = (Number(multBps) / 10000).toFixed(1) + '×';
    const s = Number(since);
    let streak = '';
    if (s > 0) {
      const days = Math.floor((Date.now() / 1000 - s) / 86400);
      const held = Date.now() / 1000 - s;
      if (held < 30 * 86400) streak = 'held ' + days + 'd · 1.5× at 30d';
      else if (held < 90 * 86400) streak = 'held ' + days + 'd · 2.0× at 90d';
      else streak = 'held ' + days + 'd · max tier';
    }
    document.getElementById('e-streak').textContent = streak;
    claimBtn.hidden = claimable === 0n;
    if (claimable > 0n) claimBtn.textContent = 'claim ' + fmtEth(claimable);
  } catch {}
}

function render() {
  if (!myPlots.length) {
    statusEl.textContent = 'this wallet holds no plots.';
    holdingsEl.innerHTML = '<div class="empty-state"><p>no land yet.</p>' +
      '<a class="act browse-link" href="market.html">browse the market →</a></div>';
    return;
  }
  statusEl.textContent = myPlots.length + ' plot' + (myPlots.length === 1 ? '' : 's') + ' held by ' + short(MD.account) + '.';
  const f = floors();
  holdingsEl.innerHTML = myPlots.map(id => {
    const listed = myListings.get(id);
    const accrued = myClaimables.get(id);
    const d = districtIdx(id);
    const floor = f.byDistrict[d];
    const last = lastSaleFor(id);
    return '<article class="deed" id="plot-' + id + '">' +
      '<div class="deed-survey">' +
        '<canvas class="deed-map" width="220" height="120" data-map="' + id + '"></canvas>' +
        '<span class="deed-no">deed №&nbsp;' + String(id).padStart(4, '0') + '</span>' +
        (listed ? '<span class="deed-flag">listed · ' + fmtEth(listed) + '</span>' : '') +
      '</div>' +
      '<div class="deed-name"><h3>plot ' + id + '</h3><span class="deed-loc">' + coords(id) + '</span></div>' +
      '<p class="deed-district"><i style="background:' + DCOLORS[d] + '"></i>' + districtName(id) + '</p>' +
      '<dl class="deed-facts">' +
        '<div><dt>streams</dt><dd>' + SYMBOLS[tokenOf(id)] + ' · ' + (apyOf(id) / 100).toFixed(2) + '%</dd></div>' +
        '<div><dt>accrued</dt><dd>' + (accrued != null ? (Number(accrued) / 1e18).toFixed(8) + ' ' + SYMBOLS[tokenOf(id)] : '…') + '</dd></div>' +
        '<div><dt>market</dt><dd>' + (floor != null ? 'district floor ' + fmtEth(floor) : 'no district listings') +
          (last ? ' · last sale ' + fmtEth(last.price) : '') + '</dd></div>' +
      '</dl>' +
      (listed
        ? '<div class="deed-foot">' +
            '<div class="deed-ask"><span>listed at</span><strong>' + fmtEth(listed) + '</strong></div>' +
            '<button class="act cancel" data-cancel="' + id + '">delist</button>' +
            '<button class="act" data-edit="' + id + '">reprice</button>' +
          '</div>'
        : '<div class="deed-foot">' +
            '<div class="deed-ask"><span>not listed</span><strong>&nbsp;</strong></div>' +
            '<button class="act buy" data-list="' + id + '">list for sale<span class="arr">→</span></button>' +
          '</div>') +
      '<div class="list-form" id="form-' + id + '" hidden></div>' +
      '<p class="tx" id="tx-' + id + '"></p></article>';
  }).join('');
  mountDioramas(holdingsEl);
}

// ---- sell flow ----
function showListForm(id, isReprice) {
  const form = document.getElementById('form-' + id);
  const f = floors();
  const d = districtIdx(id);
  const hint = [
    f.byDistrict[d] != null ? 'district floor ' + fmtEth(f.byDistrict[d]) : null,
    lastSaleFor(id) ? 'last sale ' + fmtEth(lastSaleFor(id).price) : null,
  ].filter(Boolean).join(' · ') || 'no comparable sales yet';
  form.hidden = false;
  form.innerHTML =
    '<label>price in ETH <input type="number" step="0.001" min="0" placeholder="0.03" id="price-' + id + '"></label>' +
    '<p class="quiet-note">' + hint + ' · 3% fee on sale</p>' +
    '<button class="act buy" data-confirm-list="' + id + '" data-reprice="' + (isReprice ? '1' : '') + '">' +
      (isReprice ? 'update price' : 'confirm listing') + '</button>';
  form.querySelector('input').focus();
}

async function doList(id, isReprice) {
  const txEl = document.getElementById('tx-' + id);
  const input = document.getElementById('price-' + id);
  const eth = parseFloat(input.value);
  if (!eth || eth <= 0) { txEl.textContent = 'enter a price.'; return; }
  const price = BigInt(Math.round(eth * 1e6)) * 10n ** 12n;
  try {
    const w = MD.walletClient || await connect();
    if (!w) return;
    if (!isReprice) {
      const approved = await pub.readContract({
        address: LAND, abi: landAbi, functionName: 'isApprovedForAll', args: [MD.account, MARKET],
      });
      if (!approved) {
        txEl.textContent = 'step 1 of 2 · approve the registry once in your wallet…';
        const { request } = await pub.simulateContract({
          address: LAND, abi: landAbi, functionName: 'setApprovalForAll', args: [MARKET, true], account: MD.account,
        });
        const h = await w.writeContract(request);
        await pub.waitForTransactionReceipt({ hash: h });
      }
    }
    txEl.textContent = (isReprice ? 'updating price…' : 'listing…') + ' confirm in your wallet';
    const fn = isReprice ? 'updatePrice' : 'list';
    const { request } = await pub.simulateContract({
      address: MARKET, abi: marketAbi, functionName: fn, args: [BigInt(id), price], account: MD.account,
    });
    const h2 = await w.writeContract(request);
    await pub.waitForTransactionReceipt({ hash: h2 });
    txEl.textContent = isReprice ? 'price updated.' : 'listed. buyers can now acquire this deed.';
    await loadMine(true);
  } catch (err) {
    txEl.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 120);
  }
}

async function doCancel(id) {
  const txEl = document.getElementById('tx-' + id);
  try {
    const w = MD.walletClient || await connect();
    if (!w) return;
    const { request } = await pub.simulateContract({
      address: MARKET, abi: marketAbi, functionName: 'cancel', args: [BigInt(id)], account: MD.account,
    });
    const h = await w.writeContract(request);
    txEl.textContent = 'delisting…';
    await pub.waitForTransactionReceipt({ hash: h });
    txEl.textContent = 'delisted.';
    await loadMine(true);
  } catch (err) {
    txEl.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 120);
  }
}

holdingsEl.addEventListener('click', e => {
  const confirm = e.target.closest('[data-confirm-list]');
  if (confirm) { doList(Number(confirm.dataset.confirmList), confirm.dataset.reprice === '1'); return; }
  const list = e.target.closest('[data-list]');
  if (list) { showListForm(Number(list.dataset.list), false); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) { showListForm(Number(edit.dataset.edit), true); return; }
  const cancel = e.target.closest('[data-cancel]');
  if (cancel) { doCancel(Number(cancel.dataset.cancel)); return; }
});

claimBtn.addEventListener('click', async () => {
  try {
    const w = MD.walletClient || await connect();
    if (!w) return;
    const { request } = await pub.simulateContract({
      address: MARKET, abi: marketAbi, functionName: 'claimRewards', account: MD.account,
    });
    const h = await w.writeContract(request);
    claimBtn.textContent = 'claiming…';
    await pub.waitForTransactionReceipt({ hash: h });
    await refreshEarnings();
  } catch (err) {
    claimBtn.textContent = (err?.shortMessage || 'failed').toLowerCase().slice(0, 40);
  }
});

walletLink.addEventListener('click', async e => {
  e.preventDefault();
  try {
    const w = await connect();
    if (w) { walletLink.textContent = short(MD.account); await loadMine(); }
  } catch { statusEl.textContent = 'wallet connection failed.'; }
});

// auto-connect if a wallet is already authorized
(async () => {
  try {
    const w = await connect();
    if (w && MD.account) { walletLink.textContent = short(MD.account); await loadMine(); }
  } catch {}
})();
setInterval(() => { if (MD.account && !document.hidden) loadMine().catch(() => {}); }, 30000);
