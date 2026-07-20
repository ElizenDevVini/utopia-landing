// Live on Robinhood Chain mainnet. A host may override via
// window.UTOPIA_RUNTIME = { rpcUrl, landAddress } before modules load.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const active = {
  key: 'mainnet',
  label: 'robinhood chain',
  chainId: 4663,
  // site reads go through our caching proxy so many visitors don't each hit the
  // public RPC's Cloudflare rate limit; wallets get the official RPC (walletRpc)
  rpc: 'https://utopia-rpc-proxy.onrender.com',
  walletRpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  land: '0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2',
  buildings: '0x94Cb161B86D78bB80d0B7054f8671328769fe960',
  utop: '',
  symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN'],
  landVersion: 4,
  // 5 = district mode (stock by region); 0..4 = every plot pays that one stock
  // (NVDA = 2). Must match the deployed contract's rewardMode.
  rewardMode: 5, // must match the deployed contract (0xb93Ee2B0 is district mode)
  // earlier contracts people bought on; their plots are shown as owned so no
  // buyer's purchase disappears from the map
  legacyLands: ['0x7E062901CAdAF1692b9908b0bfE360fA94900E8E'],
  payment: 'native',
  requiresEligibility: true,
  eligibilityUrl: '',
  nativeFaucet: '',
};

export const NETWORKS = { mainnet: active };

const runtime = globalThis.UTOPIA_RUNTIME || {};
const rpc = runtime.rpcUrl || active.rpc;
const land = runtime.landAddress || active.land;

export const NET = Object.freeze({
  ...active,
  rpc,
  land,
  ready: Boolean(land),
  activationIssue: land ? '' : 'contract address pending',
});

export function addressUrl(address) {
  return address ? `${NET.explorer}/address/${address}` : null;
}
export function withNetwork(path) {
  return path;
}

// codex: prefer the caching proxy, but fail read-only JSON-RPC calls over to
// the official endpoint when Render is asleep or unhealthy. The short circuit
// breaker keeps a proxy outage from adding a timeout to every dashboard read.
export function resilientReadTransport(customTransport) {
  let proxyUnavailableUntil = 0;
  let requestId = 0;

  async function rpc(url, method, params, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params: params || [] }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`rpc http ${response.status}`);
      const body = await response.json();
      if (body.error) {
        const error = new Error(body.error.message || 'rpc request failed');
        error.code = body.error.code;
        error.data = body.error.data;
        throw error;
      }
      return body.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  return customTransport({
    async request({ method, params }) {
      if (Date.now() >= proxyUnavailableUntil) {
        try {
          return await rpc(NET.rpc, method, params, 3_000);
        } catch {
          proxyUnavailableUntil = Date.now() + 60_000;
        }
      }
      return rpc(NET.walletRpc || NET.rpc, method, params, 10_000);
    },
  }, { retryCount: 0 });
}
