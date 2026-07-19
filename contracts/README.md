# Utopia contracts

The production contracts are:

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
