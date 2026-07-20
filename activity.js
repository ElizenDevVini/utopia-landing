// Activity: a bounded live feed of the city's trades and listings.

import {
  pub, marketAbi, MARKET, SYMBOLS,
  tokenOf, districtName, coords, fmtEth, short, addressUrl,
  refreshListings, refreshSales, listings, sales,
} from './market-data.js?v=1';

const statusEl = document.getElementById('page-status');
const feedEl = document.querySelector('#feed .body');

async function load() {
  try {
    const [paid] = await Promise.all([
      pub.readContract({ address: MARKET, abi: marketAbi, functionName: 'totalPaidToHolders' }),
      refreshSales(),
      refreshListings(),
    ]);
    let volume = 0n;
    for (const s of sales) volume += s.price;
    document.getElementById('a-paid').textContent = fmtEth(paid);
    document.getElementById('a-volume').textContent = fmtEth(volume);
    document.getElementById('a-sales').textContent = sales.length;
    document.getElementById('a-listed').textContent = listings.length;
    statusEl.textContent = sales.length
      ? 'recent city activity, newest first.'
      : 'no sales yet — the register is young.';

    // merge sales + current listings into one feed, newest first
    const items = [];
    for (const s of sales.slice(0, 40)) {
      items.push({ block: s.block, html:
        '<div class="feed-row sale">' +
          '<span class="feed-what">sold</span>' +
          '<span class="feed-plot">plot ' + s.id + ' <em>' + districtName(s.id) + '</em></span>' +
          '<span class="feed-price gold">' + fmtEth(s.price) + '</span>' +
          '<span class="feed-who"><a href="' + addressUrl(s.seller) + '" target="_blank" rel="noopener">' + short(s.seller) + '</a> → ' +
            '<a href="' + addressUrl(s.buyer) + '" target="_blank" rel="noopener">' + short(s.buyer) + '</a></span>' +
        '</div>' });
    }
    for (const l of listings.slice(0, 20)) {
      items.push({ block: -1, html:
        '<div class="feed-row listing">' +
          '<span class="feed-what listed">listed</span>' +
          '<span class="feed-plot">plot ' + l.id + ' <em>' + districtName(l.id) + '</em></span>' +
          '<span class="feed-price">' + fmtEth(l.price) + '</span>' +
          '<span class="feed-who">by <a href="' + addressUrl(l.seller) + '" target="_blank" rel="noopener">' + short(l.seller) + '</a>' +
            ' · <a href="market.html">buy →</a></span>' +
        '</div>' });
    }
    feedEl.innerHTML = items.length
      ? items.map(i => i.html).join('')
      : '<p class="quiet-note">nothing yet. list a plot from <a href="my-land.html">my land</a>.</p>';
  } catch (e) {
    statusEl.textContent = 'could not read activity.';
  }
}

load();
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 25000);
