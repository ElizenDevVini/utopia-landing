# Utopia contracts

The repository keeps three generations separate:

- `UtopiaLand.sol`: live ETH-priced testnet prototype. Rewards can become debt.
- `UtopiaLandV2.sol` / `UtopiaLandV3.sol`: testnet and undeployed market-linked
  experiments. Neither is the production contract.
- `UtopiaLandMainnet.sol`: finite ETH-priced release candidate. A plot cannot be
  sold unless its full remaining reward is reserved, committed Stock Tokens
  cannot be withdrawn, and purchases/transfers/claims require eligibility.
- `UtopiaEligibility.sol`: expiry-based registry owned by the compliance Safe.

Run the local verification:

```sh
forge fmt --check
forge test
```

Mainnet is a gated operator release, not a normal development deploy. Read
[`MAINNET.md`](MAINNET.md) end to end. `DeployMainnet.s.sol` has no fallback
owner, deadline, or rates and does not enroll users or transfer Stock Tokens.
