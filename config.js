// Live on Robinhood Chain mainnet. A host may override via
// window.UTOPIA_RUNTIME = { rpcUrl, landAddress } before modules load.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const active = {
  key: 'mainnet',
  label: 'robinhood chain',
  chainId: 4663,
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  land: '0x5b9D835d00721aD80a22fcb62c349702264489c2',
  utop: '',
  symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN'],
  landVersion: 4,
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
