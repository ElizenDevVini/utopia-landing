// Production mainnet configuration. The site has no preview or test network mode.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const NETWORKS = {
  mainnet: {
    key: 'mainnet',
    label: 'robinhood chain mainnet',
    chainId: 4663,
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    land: '',
    utop: '',
    symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN'],
    landVersion: 4,
    payment: 'native',
    requiresEligibility: true,
    eligibilityUrl: '',
  },
};

const runtime = globalThis.UTOPIA_RUNTIME || {};
const selected = NETWORKS.mainnet;
const rpc = runtime.rpcUrl || selected.rpc;
const land = runtime.landAddress || selected.land;
const eligibilityUrl = runtime.eligibilityUrl || selected.eligibilityUrl;
const hasDeployment = Boolean(land);
const hasProductionProvider = rpc === selected.rpc;
const hasEligibilityFlow = Boolean(eligibilityUrl);

export const NET = Object.freeze({
  ...selected, rpc, land, eligibilityUrl,
  ready: hasDeployment && hasProductionProvider && hasEligibilityFlow,
  activationIssue: !hasDeployment ? 'verified mainnet deployment pending' : !hasEligibilityFlow ? 'eligibility flow pending' : '',
});

export function addressUrl(address) { return address ? `${NET.explorer}/address/${address}` : null; }
export function withNetwork(path) { return path; }
