// Network profiles. Default is testnet; append ?net=mainnet to preview the
// deliberately disabled mainnet state. A host may set
// window.UTOPIA_RUNTIME = { network, rpcUrl } before modules load.

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

export const NETWORKS = {
  testnet: {
    key: 'testnet',
    label: 'robinhood chain testnet',
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
  },
  'testnet-v2': {
    key: 'testnet-v2',
    label: 'robinhood chain testnet · UTOP V2',
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
  },
  mainnet: {
    key: 'mainnet',
    label: 'robinhood chain',
    chainId: 4663,
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    // filled in after the mainnet deploy (contracts/MAINNET.md)
    land: '',
    utop: '',
    symbols: ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'AMZN'],
    landVersion: 3,
    payment: 'utop',
    utopFaucet: false,
    nativeFaucet: '',
  },
};

const runtime = globalThis.UTOPIA_RUNTIME || {};
const pick = runtime.network || new URLSearchParams(location.search).get('net');
const selected = NETWORKS[pick] || NETWORKS.testnet;

export const NET = Object.freeze({
  ...selected,
  rpc: runtime.rpcUrl || selected.rpc,
  ready: Boolean(selected.land && (selected.payment === 'native' || selected.utop)),
});

export function addressUrl(address) {
  return address ? `${NET.explorer}/address/${address}` : null;
}

export function withNetwork(path) {
  return NET.key === 'testnet' ? path : `${path}?net=${encodeURIComponent(NET.key)}`;
}
