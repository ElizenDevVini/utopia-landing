# mainnet runbook

Going live on Robinhood Chain mainnet (chain id 4663). Every command here is
run by the operator, with the operator's keys and money. Nothing in this file
is automated on purpose: deploying spends real ETH and the reward treasury is
real tokenized securities.

## read this first

- The reward mechanic streams real Robinhood Stock Tokens to any wallet that
  buys a plot. Stock Tokens are tokenized debt securities offered under a
  prospectus, not available to US persons. Redistributing them as rewards is
  a securities-law question, not a code question. Get legal advice before
  pointing real users at this.
- The contract is unaudited. It is small and tested (54 tests, fork tests
  against the live chain), but unaudited is unaudited.
- Reward rates are fixed at deploy (no oracle). If stock or ETH prices move,
  the streamed amounts stay frozen at the deploy-time snapshot. Edit the
  rates in `script/DeployMainnet.s.sol` right before deploying.
- The treasury only pays what it holds. Reserves are visible on the dashboard
  and shortfalls accrue as debt (`owed`) rather than disappearing — but the
  operator is the only one refilling it. Budget accordingly: at ~4.5% average
  base rate, every 1 ETH of sold land streams ~0.045 ETH-equivalent of stock
  per year.
- Never use a key that has been pasted into a chat, a ticket, or a screen
  share. Generate fresh, keep it in an encrypted keystore.

## 1. operator key

```sh
cast wallet new                          # note the address, keep the key off disk
cast wallet import utopia-mainnet --interactive   # paste key, choose a strong password
```

Fund the address with ETH on Robinhood Chain mainnet (bridge per
https://docs.robinhood.com/chain/bridging). Deploy gas is small (~0.0005 ETH
at typical L2 prices); the real budget is the treasury.

## 2. deploy + verify

Recheck the rates in `script/DeployMainnet.s.sol` (comments explain the
formula), then:

```sh
cd contracts
forge test                                # must be green
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --account utopia-mainnet --broadcast

forge verify-contract <DEPLOYED_ADDRESS> src/UtopiaLand.sol:UtopiaLand \
  --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api \
  --chain-id 4663 \
  --constructor-args $(cast abi-encode 'constructor(address[5],uint256[5])' \
    '[0x322F0929c4625eD5bAd873c95208D54E1c003b2d,0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9,0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,0xe93237C50D904957Cf27E7B1133b510C669c2e74,0x12f190a9F9d7D37a250758b26824B97CE941bF54]' \
    '[9000000000000000000,15000000000000000000,22000000000000000000,8000000000000000000,17000000000000000000]')
```

If you edited the rates, mirror the change in the abi-encode args.

## 3. seed the reward treasury

You need real TSLA/AAPL/NVDA/MSFT/AMZN Stock Tokens in the operator wallet.
They trade permissionlessly on the chain's DEXes (Uniswap is live on
mainnet), but whether you may hold and redistribute them is jurisdiction-
dependent — see "read this first".

```sh
# per token: transfer whatever reserve you decided on
cast send <TOKEN> 'transfer(address,uint256)' <LAND_ADDRESS> <AMOUNT_WEI> \
  --rpc-url https://rpc.mainnet.chain.robinhood.com --account utopia-mainnet
```

The dashboard's "reward reserves" row reads these balances live; an empty
reserve shows users exactly what they'd get: nothing, carried as debt.

## 4. point the site at mainnet

In `config.js`, fill the mainnet profile's `land` address. The mainnet
profile is already wired for native-ETH pricing. Then either keep testnet as
the default and share `app.html?net=mainnet`, or flip the default network.
Redeploy the static site.

## 5. smoke test with pocket change

From a second wallet: connect on the dashboard, buy the cheapest plot, wait
ten minutes, claim, confirm the stock token lands. Only then tell anyone
about it.

## ongoing

- Watch reserves (dashboard, or `cast call <TOKEN> 'balanceOf(address)' <LAND>`).
- Sale proceeds accumulate in the contract; `withdrawEth(to)` is onlyOwner.
- `rescueTokens` can rebalance or wind down the treasury at any time.
