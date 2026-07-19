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
- 2026-07-18: Implemented production candidates `UtopiaLandMainnet` and
  `UtopiaEligibility`: finite immutable rewards, sale-time full commitments,
  locked committed reserves, current-eligibility checks, constant-time bitmaps,
  bounded batches, direct multisig ownership, and no market oracle.
- 2026-07-18: Official Robinhood asset API and chain-4663 reads matched TSLA/AAPL/
  NVDA/MSFT/AMZN addresses; each reported active, correct symbol, 18 decimals, and
  non-empty proxy runtime.
- 2026-07-18: Full Forge suite passed 73/73, including 512 combined fuzz runs for
  sale and repeated-claim reserve invariants. Deployment script simulated on chain
  4663 with explicit non-production inputs; estimated gas was 4,457,788. No broadcast.
- 2026-07-18: Frontend now checks receipt status, simulates buy/claim, asserts the
  purchased plot appears in the wallet bitmap, and renders five wallet Stock Token
  balances. Removed the up-to-1,024-call city-wide accrual poll.
- 2026-07-18: Chrome smoke loaded live testnet state with an injected read-only
  wallet: six deeds, claimables, five wallet-token rows, and no page exceptions.
  Mainnet-disabled Chrome smoke passed at desktop and a true 390px viewport; document
  width equaled viewport width and keyboard focus reached `mainnet pending`.
- 2026-07-19 [codex]: Re-ran JavaScript syntax checks and the full Forge suite. JavaScript passed;
  Forge tests passed 25/25. `forge fmt --check` still fails on pre-existing formatting in
  `test/UtopiaLandCity.t.sol`.
- 2026-07-19 [codex]: Confirmed chain 4663 and live bytecode at the configured land address.
  Current ownership is 5 plots; the configured legacy contract contains 6 plots; the merged
  city contains 10 unique plots. `app.js` merges legacy ownership, but landing `chain.js` does not,
  so five earlier purchases disappear from the landing map/count.
- 2026-07-19 [codex]: Headless Chrome desktop smoke rendered the landing and dashboard with live
  chain state. A 390x844 landing capture exposed clipped navigation and hero text because the
  desktop flex navigation has no mobile layout and `.hero` hides the overflow.
- 2026-07-19 [codex]: No production files changed. Findings only, per diagnosis scope.
- 2026-07-19 [codex]: User authorized fixes for landing ownership, mobile clipping,
  and eligible wallets being unable to buy land.
- 2026-07-19 [codex]: Patched landing ownership to OR configured legacy bitmaps into
  current ownership. Patched the mobile hero to constrain copy and hide duplicate nav
  links at 760px and below.
- 2026-07-19 [codex]: Changed frontend eligibility gating to block only confirmed false
  reads and added a 15-second refresh so newly approved wallets unlock without reload.
  Contract simulation remains the authoritative preflight and onchain `NotEligible`
  enforcement is unchanged.
- 2026-07-19 [codex]: Live read-only `buy(752)` simulation from an eligible current owner
  succeeded with exact value; no transaction was broadcast.
- 2026-07-19 [codex]: Final CDP browser regression at 390px reported viewport/scroll width
  390, visible headline/nav, landing and dashboard ownership count 11, active eligibility,
  a visible buy action for open plot 723, and zero page exceptions.
- 2026-07-19 [codex]: Final verification passed: JS syntax, shell syntax, `git diff --check`,
  `forge fmt --check`, and 25/25 Forge tests.
- 2026-07-19 [codex]: User requested full post-purchase verification across eligible-wallet
  gating, receipt handling, map ownership, and Your Land hydration. Starting a local-fork
  transaction test; no mainnet broadcast authorized.
- 2026-07-19 [codex]: Enumerated six current plots across three unique owners; all three
  owners are currently eligible. An ineligible control returned false and its buy call
  reverted with the exact `NotEligible()` selector.
- 2026-07-19 [codex]: Live plot 723 preflight found price 0.00128 ETH, NVDA reward
  commitment about 0.00001858 token, and about 0.0905 token uncommitted reserve. One
  eligible owner simulated successfully; two other eligible owners lacked enough live ETH.
- 2026-07-19 [codex]: On a Robinhood-mainnet Anvil fork, funded and impersonated all three
  eligible owners. Buys of plots 723, 722, and 721 each returned receipt status `0x1`,
  and `ownerOf` matched the expected buyer. No mainnet transaction was sent.
- 2026-07-19 [codex]: Full dashboard fork smoke bought plot 723 through the actual wallet
  flow. UI ownership count advanced 11 -> 12, selected heading became `yours`, Your Land
  contained plot 723, onchain fork owner matched, and Chrome reported zero exceptions.
