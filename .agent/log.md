# Log

- 2026-07-18: Initial worktree had clean tracked frontend plus four untracked V2 files.
- 2026-07-18: `forge test` passed 42/42; JavaScript syntax checks passed.
- 2026-07-18: V1 address responded but held zero Stock Tokens despite accrued claimable yield.
- 2026-07-18: Concurrent edits switched the frontend to funded V2 land
  `0x6ceB...0cFd` and UTOP `0xB0Ff...4977`; preserved without modification.
- 2026-07-18: V2 live read showed multiplier 1x, one owned plot, 221 UTOP collected,
  and roughly 5 tokens of each configured test Stock Token in treasury.
- 2026-07-18: `forge fmt --check` failed on existing formatting in three Solidity files.
- 2026-07-18: Current V2 oracle is unset. The intended fixed-supply launcher
  graduates to a canonical Uniswap v4 pool, incompatible with V2's v3 `slot0()` interface.
- 2026-07-18: Robinhood docs confirm the public RPC is rate-limited and Stock Tokens
  have jurisdictional restrictions; both are release gates, not footer-only concerns.
- 2026-07-18: Added an undeployed V3 mainnet candidate: fixed UTOP land prices,
  adapter-based checkpointed reward multipliers, visible payout shortfalls, bounded
  batches, immutable Stock Token reserves, and two-step ownership. Focused tests 12/12 pass.
- 2026-07-18: A concurrent session switched the default back to ETH-priced V1 and
  committed the shared work as `322ea93`; preserved that product choice.
- 2026-07-18: Re-read all five V1 token addresses and balances from chain ID 46630;
  every reward balance is zero. The frontend now labels the reserve shortfall instead
  of claiming that rewards are currently payable.
- 2026-07-18: During browser verification, another session funded V1. A second live
  read showed about 5 units of each Stock Token; the dashboard updated without a code
  change, confirming that reserve health is derived from chain state rather than copy.
- 2026-07-18: Chrome smoke passed for desktop/mobile landing, V1 dashboard, and the
  disabled mainnet state. A CDP 390px check reported viewport/scroll widths both 390px;
  keyboard Tab focus reached the visible mainnet control.
- 2026-07-18: Final V1 live read: chain ID 46630, deployed bytecode present, plot 528
  accrues token index 4, claimable about 0.0000000408 versus about 5 tokens reserved.
- 2026-07-18: User requested the proven buy -> claimed plot -> dashboard rewards ->
  wallet Stock Token loop on Robinhood mainnet. Replaced the testnet-oriented done
  criteria with production activation gates: verified chain-4663 deployments,
  bounded/pre-funded rewards, eligible distribution, production RPC, multisig,
  receipt-safe UI, and a fresh-wallet mainnet trace.
- 2026-07-18: Re-audited `/Users/ash/utopia-launchpad`. UTOP creation and auction
  work is fork-only; no token exists on mainnet from this repository. Its recorded
  release status remains NO-GO on audit/source-verification/dependency gates.
