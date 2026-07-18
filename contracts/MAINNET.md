# mainnet release runbook

This runbook activates the proven ETH -> land -> Stock Token reward loop on
Robinhood Chain mainnet (chain ID 4663). The repository is production-prepared,
but it is not deployed or live until every release gate below passes.

## hard gates

- Obtain an independent security review of `UtopiaLandMainnet.sol` and
  `UtopiaEligibility.sol`. Existing tests are evidence, not an audit.
- Approve the exact reward rates, end timestamp, reserve budget, and deployed
  Safe/multisig address. Rates are immutable and have no source-code defaults.
- Implement the offchain eligibility process and have counsel approve the flow.
  Robinhood Stock Tokens are tokenized debt securities and are restricted in a
  number of jurisdictions, including for US persons. The onchain registry only
  records an eligibility decision; it does not perform KYC.
- Use a paid production RPC. Robinhood's public endpoint is rate-limited and is
  explicitly refused by the release preflight.

Relevant primary documentation:

- <https://docs.robinhood.com/chain/stock-tokens/>
- <https://docs.robinhood.com/chain/contracts/>
- <https://docs.robinhood.com/chain/connecting/>
- <https://docs.robinhood.com/chain/terms-of-service/>

## 1. configure and simulate

Never put a private key in an environment variable, repository, chat, or command
history. Use a Foundry encrypted keystore and a fresh deployment account.

```sh
cd contracts
export ROBINHOOD_RPC_URL='https://your-production-provider.example'
export UTOPIA_OWNER='0xYourDeployedSafe'
export UTOPIA_REWARD_END='1798761600'
export UTOPIA_TSLA_PER_ETH_WAD='operator-approved-value'
export UTOPIA_AAPL_PER_ETH_WAD='operator-approved-value'
export UTOPIA_NVDA_PER_ETH_WAD='operator-approved-value'
export UTOPIA_MSFT_PER_ETH_WAD='operator-approved-value'
export UTOPIA_AMZN_PER_ETH_WAD='operator-approved-value'

forge fmt --check
forge test
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url "$ROBINHOOD_RPC_URL" --account utopia-mainnet
```

The simulation must show chain 4663, the expected Safe, and the approved end
timestamp. The script validates the five canonical token contracts, symbols, and
18-decimal interface before deployment.

## 2. operator-signed deploy and verification

After review of the simulation, the operator may run the same command with
`--broadcast --verify`:

```sh
forge script script/DeployMainnet.s.sol:DeployMainnet \
  --rpc-url "$ROBINHOOD_RPC_URL" \
  --account utopia-mainnet \
  --broadcast --verify \
  --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api
```

Record the eligibility and land addresses plus deployment transaction hashes.
Ownership is assigned directly to `UTOPIA_OWNER`; there is no deployer-owner
handoff window.

## 3. fund the finite reward program

The contract will reject an individual plot sale unless that plot's entire
remaining reward obligation is available and uncommitted. For a public launch,
fund enough to cover every open plot:

```sh
cast call "$UTOPIA_LAND_ADDRESS" \
  'reserveRequiredForAllOpenPlots()(uint256[5])' \
  --rpc-url "$ROBINHOOD_RPC_URL"
```

Acquire and transfer exactly the counsel- and treasury-approved canonical Stock
Token amounts. This runbook intentionally does not automate acquisition or token
movement. Committed rewards cannot be withdrawn; only surplus above all sold-plot
commitments is withdrawable.

## 4. enroll the smoke wallet

After the offchain eligibility decision, the compliance Safe records an expiry:

```sh
cast calldata 'setEligibility(address,uint64)' 0xEligibleSmokeWallet 1798761600
```

Submit that calldata to the Safe targeting `UTOPIA_ELIGIBILITY_REGISTRY`. Do not
use a deployer EOA as the compliance authority.

## 5. fail-closed preflight

```sh
export UTOPIA_LAND_ADDRESS='0x...'
export UTOPIA_ELIGIBILITY_REGISTRY='0x...'
export UTOPIA_OWNER='0xYourDeployedSafe'
bash script/preflight-mainnet.sh
```

It fails unless both contracts are source verified, ownership and registry wiring
match, the reward window is active, the official Robinhood asset registry still
matches all five token addresses, and reserves cover sold plus every open plot.

## 6. site activation and fresh-wallet proof

Only after the preflight passes, provide the production RPC, land address, and
eligibility application URL to the frontend runtime configuration. Then use the
eligible smoke wallet to record:

1. Wallet connected to chain 4663.
2. Plot purchase receipt succeeded.
3. The selected plot is white and appears under **your land**.
4. Claimable reward increases before the immutable deadline.
5. Claim receipt reports the exact paid Stock Token amount.
6. The dashboard and wallet both show the increased canonical token balance.

Do not mark the mainnet profile ready or advertise a live launch before this trace
and its explorer links are recorded in `.agent/log.md`.
