# Progress

## Done

- Mapped the landing, dashboard, V1/V2 contracts, launchpad context, and city-game mission.
- Verified V1 and V2 contract tests: 42 passed.
- Verified current V2 deployments and funded five-token treasury on chain ID 46630.
- Identified product-copy drift, oracle/economic risk, RPC scaling risk, and UX/a11y gaps.
- Confirmed the planned launch graduates to Uniswap v4, while V2 expects a v3-style
  `slot0()` pool; the mainnet oracle path is therefore not integration-compatible.
- Added and tested an undeployed V3 candidate with fixed UTOP prices, checkpointed
  future-only reward multipliers, bounded batches, visible debt, and no reserve rescue.
- Added config-driven V1/V2/mainnet profiles, wallet-chain hardening, multicall batching,
  exact claim receipt reporting, live reserve health, and mainnet deployment gating.
- Preserved the concurrent decision to use ETH-priced V1 by default and made its
  five Stock Token reserves visible in the UI. A concurrent session funded them
  during verification; the latest read shows roughly 5 tokens of each.
- Passed Chrome smoke checks on the landing and dashboard at desktop/mobile sizes,
  including the disabled mainnet profile. CDP at a true 390px viewport showed no
  horizontal overflow and keyboard focus reached the visible mainnet control.

## Next

- Monitor default V1 reserve coverage and expose aggregate liabilities before launch.
- Add production RPC/indexing configuration and complete launchpad release gates.

## Blocked

- Mainnet launch remains a no-go in `utopia-launchpad` pending its recorded audit
  mapping and source-verification gates.
