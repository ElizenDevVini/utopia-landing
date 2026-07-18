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
