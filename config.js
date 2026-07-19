// Live on Robinhood Chain mainnet. A host may override via
// window.UTOPIA_RUNTIME = { rpcUrl, landAddress } before modules load.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const active = {
  key: 'mainnet',
  label: 'robinhood chain',
  chainId: 4663,
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  land: '0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2',
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
