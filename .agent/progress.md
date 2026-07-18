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
- Reframed the launch contract around the requested real mainnet outcome. A live
  production claim now requires verified deployments, reserve solvency, compliant
  Stock Token distribution, and a fresh-wallet chain-4663 transaction trace.
- Audited the UTOP launchpad state: its launch lifecycle passes on a pinned mainnet
  fork, but no UTOP deployment was broadcast and its own production gates remain.

## Next

- Harden the land contract around a finite, fully reserved reward program and an
  explicit eligibility gate; add invariants for both.
- Finish wallet Stock Token portfolio visibility and fail-closed receipt handling.
- Add a machine-readable mainnet preflight and an operator deployment/funding runbook.

## Blocked

- Activation is blocked until the operator supplies/approves a production RPC,
  multisig owner, compliance/eligibility authority, reward duration/rates, and
  exact canonical Stock Token reserve funding.
- The current UTOP launchpad records a NO-GO pending Launcher v3 audit mapping,
  three source-verification gaps, and dependency isolation/remediation.
