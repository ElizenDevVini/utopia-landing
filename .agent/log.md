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
- 2026-07-19 [codex]: Continued legacy audit found a confirmed mixed-wallet failure: current
  plot 503 plus legacy-only plot 758 were both passed to current `claimMany`, reverting the
  entire batch with `NotMinted()`.
- 2026-07-19 [codex]: Separated merged display ownership from current reward ownership.
  Claimable reads and Claim All now use current IDs only; legacy deeds remain visible and are
  labeled with source-contract explorer links. Market counts current streams separately.
- 2026-07-19 [codex]: Mixed-wallet fork smoke claimed current plot 503 successfully while
  excluding legacy plot 758. Legacy-only wallet showed plots 100/133/165 with no Claim All.
  A normal fork buy still advanced count 22 -> 23 and added plot 623 to Your Land.
- 2026-07-19 [codex]: Final landing smoke showed 24 total = 19 current + 5 legacy; clicking
  legacy plot 100 used the old contract link and no current reward copy. Mobile width remained
  390px and Chrome reported zero exceptions.
- 2026-07-19 [codex]: Final JS/shell syntax, diff, Forge formatting, and 25/25 tests passed.
- 2026-07-19 [codex]: Started automatic buyer-onboarding work on clean `main`. Verification will intercept the live webhook and eligibility response so no Sheet row or transaction is produced.
- 2026-07-19 [codex]: Implemented confirmed-false auto-request with a lowercase-address localStorage timestamp guard, manual retry bypass, address-safe eligibility reads, and one non-overlapping 5s/15s scheduler. Removed clipboard/DM onboarding copy and bumped `app.js` to `v=10`.
- 2026-07-19 [codex]: Headless Chrome loaded the local dashboard against live chain reads with fresh unapproved `0x…dead` and `0x…beef` wallets. The webhook was intercepted: connect and accountsChanged each submitted exactly once; a forced unknown read submitted nothing; reload did not repeat the first request.
- 2026-07-19 [codex]: Browser timing measured 5,201ms while access was pending and 15,473ms after advancing beyond the three-minute window. A synthetic read-only eligible response showed “access active — you can buy now” and restored the buy button. No transaction method ran and Chrome reported zero JavaScript exceptions.
- 2026-07-19 [codex]: Site-half verification only. The approver is not deployed, so no end-to-end enrollment completed; no request reached the real Sheet and no chain transaction was broadcast.
- 2026-07-19 [codex]: Final `node --check app.js` and `git diff --check` passed. The only `doTx` change is the approved copy-only sentence; the eight-plot cap, simulations, writes, contracts, and network configuration are unchanged.
- 2026-07-19 [codex]: Live approver status was `ok` with zero failures/pending and more than 100 approvals. Latest observed status: last run `2026-07-20T02:15:14.791Z`, next run `2026-07-20T02:16:22.864Z`, approved total 130, tx `0xac2a9a76c61c55c5272709b3cf4cc57d9f9cc76c4acf19ab37f3252384ea8f71`. The service schedules 60 seconds after each completed cycle; the observed ~68-second start-to-next-start interval includes cycle execution and is not backoff.
- 2026-07-19 [codex]: Read proxy confirmed registry owner `0xd670bF168c2E76EC8F913C00418DC6012D424E28`; controller approver `0xfc6DDad53D9243253eD6454900aaa1adAcB768A2`; controller admin `0xBdD5507c1823b663f54353e47576685e3398Ee72`; and controller registry points back to the expected registry.
- 2026-07-19 [codex]: Sheet audit found 841 rows: 835 valid rows, six junk rows, and 138 unique valid wallets. The requested oldest/newest sample was 15/15 eligible; the full set was 138/138 eligible with zero failed reads and no wallet stuck false beyond three minutes.
- 2026-07-19 [codex]: State-override `eth_call` for approved zero-plot wallet `0xdf959e16950d180b4381b004f08d0d7bdede9bc4` buying open NVDA-core plot 341 at 0.00285 ETH returned `0x`. The same call from `0x000000000000000000000000000000000000dEaD` reverted with `NotEligible()` selector `0xf8eb54de`.
- 2026-07-19 [codex]: Static review confirmed the eight-plot guard in both `renderSel` and the `doTx('buy')` path. Live headless Chrome rendered 179/1,024 owned plots and two real buyable NVDA market suggestions; the impersonated eligible wallet showed a buy button with no access gate. There were zero page/console exceptions, signing methods, transaction methods, or webhook requests.
- 2026-07-19 [codex]: Synchronized `app.js`, `config.js`, `iso.js`, `vendor/viem.js`, `art.js`, and `chain.js` cache references to `v=12`. No existing user-facing reload instruction was present, so no new UI copy was added. `node --check app.js`, `node --check chain.js`, and `git diff --check` passed. No transaction was signed or broadcast and no funds moved.
- 2026-07-20 [codex]: Started the requested five-round marketplace verification loop on branch `marketplace`. Confirmed the local RPC reports chain 4663 and the static server responds on port 8471; no mainnet writes, merge, or push are authorized.
- 2026-07-20 [codex]: Marketplace loop round 1: criterion 1 passed (44/44 Forge tests); criterion 2 passed with a real EIP-6963 Anvil wallet (19 deeds/dioramas, earnings, tier, listed controls, screenshot, zero errors); criteria 7 and 9 passed (sort/filter/empty state, true 390px layout, disconnected `[hidden]`, zero overflow/errors). Criterion 4 failed because the read layer ignored `PriceUpdated`; criterion 8 failed static inspection (`market.js` from-block-zero scans and per-plot claimable reads). The remaining transaction journey was stopped at the first failing reprice assertion and will be rerun after the read-layer fix.
- 2026-07-20 [codex]: Marketplace loop round 2: replaced genesis-wide/duplicated market reads with the shared deployment-bounded event state machine, added `PriceUpdated`/cancel/sale handling, explicit Multicall3 listing and holder reads, fresh-head reads after receipts, and synchronized cache tags. Criteria 3–6 passed: existing approval listed in one transaction, a fresh holder approved+listed in two, reprice/delist rendered, both buy preflight blockers routed, plot 503 transferred to the eligible buyer, the newest SOLD row rendered, and holder fees moved 0.00134 -> 0.00204 ETH. Criterion 8 also passed with one bounded log request from deployment block 14412544 and four total `eth_call`s for a 19-plot holder; all page consoles were clean.
- 2026-07-20 [codex]: Marketplace loop round 3 final regression: 44/44 full Forge tests plus the non-skipped local-fork resale test passed; criteria 1–9 all remained green. Seeded one fork-only listing in every stock district and every tab matched; price asc/desc and empty states passed. CDP emulation at 390x844 showed wrapped nav, two-column earnings, one-column deeds, zero horizontal overflow, and zero console exceptions on market/my-land/activity. Six desktop/mobile screenshots are in `/tmp/utopia-marketplace-verification`. No mainnet write, deployment, merge, or push occurred.
- 2026-07-20 [codex]: Committed the marketplace fixes and loop records on branch `marketplace`; left unrelated dirty dashboard files untouched and did not push.
