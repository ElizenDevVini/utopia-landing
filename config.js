// Active network config. Points at the deployed, verifiable land contract so
// connect + buy + claim all function. A host may override via
// window.UTOPIA_RUNTIME = { rpcUrl, landAddress } before modules load.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const active = {
  key: 'live',
  label: 'robinhood chain',
  chainId: 46630,
  rpc: 'https://rpc.testnet.chain.robinhood.com',
  explorer: 'https://explorer.testnet.chain.robinhood.com',
  land: '0x9087704c85912cb288abbd1a7a9661577d5e586f',
  utop: '0xB0Ff1Be3dd5b04F285e82a502Fcc30D216Bd4977',
  symbols: ['TSLA', 'AMD', 'PLTR', 'AMZN', 'NFLX'],
  landVersion: 1,
  payment: 'native',
  requiresEligibility: false,
  eligibilityUrl: '',
  nativeFaucet: 'https://faucet.testnet.chain.robinhood.com',
};

export const NETWORKS = { live: active };

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
