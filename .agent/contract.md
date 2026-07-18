# Contract

## Mission

Make onchain finance feel like a living city: land is the understandable asset,
UTOP is the city currency, and each deed visibly accrues a Robinhood Chain Stock
Token from a transparent treasury. The testnet product must prove this loop
honestly before any mainnet or market-linked claims.

## Done

- One documented V2 economic model defines UTOP supply, land pricing, yield,
  treasury solvency, transfers, market/oracle behavior, and admin powers.
- Landing copy, dashboard labels, deployed addresses, and contract behavior agree.
- Connect -> faucet -> approve -> buy -> accrue -> claim is verified end to end;
  transaction success reports the amount actually paid and any remaining debt.
- Treasury/oracle/network health is visible and failure states are actionable.
- Contract invariants cover solvency, ownership, accrual, oracle bounds, and batch
  behavior; the frontend has automated desktop/mobile, wallet, and accessibility
  smoke tests.
- Production traffic does not depend on Robinhood's rate-limited public RPC.

## Constraints

- Preserve the existing restrained architectural-model visual direction.
- Keep testnet assets and forward-looking mainnet economics unmistakably distinct.
- Do not deploy or move tokens without explicit operator authorization.
- Preserve concurrent user edits and the current untracked V2 work.

## Verification

- `cd contracts && forge fmt --check && forge test`
- `node --check art.js && node --check chain.js && node --check app.js && node --check iso.js`
- Automated browser smoke at 390px and 1440px, including keyboard-only use.
- Read-only live-chain smoke for configured chain ID, bytecode, ownership,
  multiplier/oracle, UTOP balance, treasury balances, and claimable/payout state.
