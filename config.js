// Network profiles. Production defaults to mainnet; use ?net=testnet or
// ?net=testnet-v2 only for an explicit test preview. A host may set
// window.UTOPIA_RUNTIME = { network, rpcUrl, landAddress, eligibilityUrl }
// before modules load. Mainnet fails closed without every production value.

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const NETWORKS = {
  testnet: {
    key: 'testnet',
    label: 'robinhood chain · preview',
    chainId: 46630,
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    // ETH-priced UtopiaLand. The UTOP-priced V2 (0x6ceB2212…) sits ready for
    // the token launch; buying is native ETH until then.
    land: '0x9087704c85912cb288abbd1a7a9661577d5e586f',
    // UTOP exists but is benched until the real token launches
    utop: '0xB0Ff1Be3dd5b04F285e82a502Fcc30D216Bd4977',
    symbols: ['TSLA', 'AMD', 'PLTR', 'AMZN', 'NFLX'],
    landVersion: 1,
    payment: 'native',
    utopFaucet: false,
    nativeFaucet: 'https://faucet.testnet.chain.robinhood.com',
    requiresEligibility: false,
    eligibilityUrl: '',
  },
  'testnet-v2': {
    key: 'testnet-v2',
    label: 'robinhood chain · preview · UTOP V2',
    chainId: 46630,
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    land: '0x6ceB22129eB8EBf3Ad1F9828F5c585Fa3A390cFd',
    utop: '0xB0Ff1Be3dd5b04F285e82a502Fcc30D216Bd4977',
    symbols: ['TSLA', 'AMD', 'PLTR', 'AMZN', 'NFLX'],
    landVersion: 2,
    payment: 'utop',
    utopFaucet: true,
    nativeFaucet: 'https://faucet.testnet.chain.robinhood.com',
    requiresEligibility: false,
    eligibilityUrl: '',
  },
  mainnet: {
    key: 'mainnet',
    label: 'robinhood chain',
    chainId: 4663,
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    // filled in after the mainnet deploy (contracts/MAINNET.md)
    // Fill only after every gate in contracts/MAINNET.md passes.
    land: '',
    utop: '',
    symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN'],
    landVersion: 4,
    payment: 'native',
    utopFaucet: false,
    nativeFaucet: '',
    requiresEligibility: true,
    eligibilityUrl: '',
  },
};

const runtime = globalThis.UTOPIA_RUNTIME || {};
const pick = runtime.network || new URLSearchParams(location.search).get('net');
const selected = NETWORKS[pick] || NETWORKS.mainnet;
const rpc = runtime.rpcUrl || selected.rpc;
const land = runtime.landAddress || selected.land;
const eligibilityUrl = runtime.eligibilityUrl || selected.eligibilityUrl;
const publicMainnetRpc = 'https://rpc.mainnet.chain.robinhood.com';
const hasDeployment = Boolean(land && (selected.payment === 'native' || selected.utop));
const hasProductionProvider = selected.key !== 'mainnet' || rpc !== publicMainnetRpc;
const hasEligibilityFlow = !selected.requiresEligibility || Boolean(eligibilityUrl);

export const NET = Object.freeze({
  ...selected,
  rpc,
  land,
  eligibilityUrl,
  ready: hasDeployment && hasProductionProvider && hasEligibilityFlow,
  activationIssue: !hasDeployment
    ? 'verified mainnet deployment pending'
    : !hasProductionProvider
      ? 'production RPC pending'
      : !hasEligibilityFlow ? 'eligibility flow pending' : '',
});

export function addressUrl(address) {
  return address ? `${NET.explorer}/address/${address}` : null;
}

export function withNetwork(path) {
  return NET.key === 'testnet' ? path : `${path}?net=${encodeURIComponent(NET.key)}`;
}
