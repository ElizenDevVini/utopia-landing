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
- Added the ETH-priced `UtopiaLandMainnet` release candidate and expiry-based
  `UtopiaEligibility` registry. Rewards end at an immutable deadline; each sale
  reserves its full remaining obligation; committed Stock Tokens cannot be removed.
- Replaced the snapshot-rate V1 mainnet script with a fail-closed deployment that
  requires an existing contract multisig plus explicit deadline and five rates.
- Added an official-asset-registry/source/owner/deadline/full-reserve preflight and
  rewrote the operator runbook. No deploy, enrollment, or token move is automated.
- Added receipt-status checks, transaction simulation, post-buy ownership assertion,
  wallet Stock Token portfolio balances, eligibility states, and add-token actions.
- Removed city-wide 10-second claim polling; production reads are scoped to connected
  wallet holdings and periodic treasury state.
- Verified the five active mainnet Stock Token addresses against Robinhood's official
  asset API and onchain symbol/decimals/runtime reads.
- Passed all 73 Forge tests, chain-4663 dry-run deployment simulation, JS/shell syntax,
  live testnet wallet-state browser smoke, disabled-mainnet desktop smoke, true 390px
  no-overflow check, and keyboard focus to the mainnet control.

## Next

- Independent contract/security and securities-distribution review.
- Operator approval of Safe, eligibility process, production RPC, deadline, rates,
  and exact Stock Token budget; then operator-signed deploy, verification, funding,
  enrollment, preflight, and fresh-wallet transaction trace.

## Blocked

- Activation is blocked until the operator supplies/approves a production RPC,
  multisig owner, compliance/eligibility authority, reward duration/rates, and
  exact canonical Stock Token reserve funding.
- Mainnet is also blocked on independent review and the operator-signed transaction
  sequence. UTOP launchpad gates are not on the ETH-priced first-release path.

## Codex diagnosis — 2026-07-19

- Fixed landing ownership merging so it matches the dashboard and preserves legacy purchases.
- Fixed mobile landing hero/navigation clipping at 390px.
- Fixed stale/unknown eligibility handling and added periodic eligibility refresh for open dashboards.
- Full Forge behavior tests pass 25/25; formatting, JavaScript syntax, and diff checks pass.
- Browser regression passed with live chain state and a read-only eligible-wallet injection.

## Codex purchase lifecycle — 2026-07-19

- Verified all three unique current mainnet plot owners remain eligible onchain.
- Verified a funded open plot has sufficient Stock Token reserve coverage.
- Verified all three eligible addresses can buy when funded: three local-fork receipts
  succeeded and each `ownerOf` matched its buyer.
- Verified the real dashboard lifecycle on a local fork: count 11 -> 12, selected plot
  changed to `yours`, Your Land gained the plot, and contract ownership matched.
- An ineligible control still reverts with `NotEligible()`.
- Two eligible mainnet wallets currently lack enough ETH for the tested plot; this is a
  funding prerequisite, not an eligibility or application failure.

## Codex legacy safety — 2026-07-19

- Fixed mixed current/legacy Claim All batches so only current-contract plots are claimed.
- Legacy-only wallets retain visible deeds but receive no invalid current claim action.
- Current streaming count is separate from displayed legacy deed count.
- Landing and dashboard identify legacy deeds and link to their actual source contract.
- Mixed-wallet fork claim paid successfully; legacy-only and normal post-buy regressions passed.
- Live browser state during final smoke: 24 total plots, 19 current and 5 legacy.
