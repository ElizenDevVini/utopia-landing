# Contract

## Mission

Launch the proven Utopia land loop on Robinhood Chain mainnet without turning a
testnet demo into an unfunded or misleading production claim. A wallet holder
buys land with ETH, sees the plot become claimed after a successful receipt,
sees the deed and accrued rewards in the dashboard, and can claim canonical
Robinhood Stock Tokens that appear in the same wallet.

## Done

- The mainnet land contract is source-verified on chain 4663, uses canonical
  Robinhood Stock Token addresses, and has an operator-approved multisig owner.
- Rewards are time-bounded and pre-funded (or otherwise provably solvent); the
  contract cannot sell a reward-bearing plot without sufficient token reserves.
- Production uses an eligibility/compliance gate appropriate for transfers of
  tokenized securities and does not offer Stock Tokens to prohibited users.
- The production profile fails closed until chain ID, bytecode, owner, payment,
  Stock Token addresses, reward deadline, reserve coverage, and RPC are verified.
- Connect -> buy -> successful receipt -> white claimed plot -> deed
  in Your Land -> accrue -> claim -> wallet Stock Token balance is verified end
  to end on Robinhood Chain mainnet with a fresh eligible wallet.
- Landing copy, dashboard balances, explorer links, deployed addresses, and
  contract behavior agree; failures never display a successful purchase/claim.
- Contract invariants cover reserve commitments, ownership, accrual deadline,
  eligibility, transfers, and batches. Frontend checks cover desktop, 390px,
  wallet/network errors, receipt failures, and keyboard use.
- Production traffic uses an operator-supplied production RPC, not Robinhood's
  rate-limited public endpoint.

## Constraints

- Preserve the existing restrained architectural-model visual direction.
- Keep testnet assets and forward-looking mainnet economics unmistakably distinct.
- Do not deploy or move tokens without explicit operator authorization.
- Preserve concurrent user edits and the current untracked V2 work.
- The first mainnet release mirrors the proven ETH purchase path. A later UTOP
  migration is separate from launchpad work and must not silently change pricing.
- Market-linked reward scaling is excluded from the first mainnet release unless
  its oracle and maximum liability are reviewed and fully covered; a fixed rate
  is safer than an unbounded promise.
- Mainnet stays disabled until the launch inputs, production RPC, compliance
  decision, verified deployments, and funded reserves are all recorded.
- Never ask for, print, or commit a private key. Deployment and funding remain
  wallet/operator-signed release actions with explicit addresses and amounts.

## Verification

- `cd contracts && forge fmt --check && forge test`
- `node --check art.js && node --check chain.js && node --check app.js && node --check iso.js`
- Automated browser smoke at 390px and 1440px, including keyboard-only use.
- Read-only mainnet preflight for chain ID, bytecode, source verification, owner,
  Stock Token identity, deadline, reserve commitments, wallet balances, and
  claimable/payout state.
- Operator-signed fresh-wallet mainnet smoke with recorded transaction hashes is
  required before the production profile can be marked ready.

## Codex fix scope — 2026-07-19

- Merge configured legacy land ownership into the public landing map and count.
- Make the landing hero and navigation usable without clipping at 390px.
- Fix the eligible-wallet buy path so frontend eligibility state, simulation,
  transaction submission, receipt handling, and ownership refresh agree.
- Mark production changes with concise `codex:` comments.

## Codex end-to-end purchase verification — 2026-07-19

- Verify every currently discoverable eligible owner can simulate a funded open-plot buy.
- Verify an ineligible address remains rejected.
- On a local fork only, submit a signed eligible-wallet buy through the dashboard and
  prove the receipt, current ownership bitmap, white/mine state, Your Land entry,
  and ownership count all update without reload.
- Never broadcast this verification purchase to mainnet.

## Codex automatic onboarding — 2026-07-19

- A confirmed-false eligibility read automatically submits the current wallet to the existing webhook once per browser address.
- Unknown eligibility never submits, and manual request controls remain available as retries.
- Requested wallets poll every five seconds for at most three minutes, then return to the normal fifteen-second cadence.
- A true eligibility transition re-renders the buy state and shows one quiet activation note; no buying is automated.
- Preserve the eight-plot cap, transaction behavior, contracts, network configuration, and premium-district work.
- Verify with a headless injected wallet and intercepted webhook/eligibility responses; never mutate the live Sheet or broadcast a transaction.

## Codex live approval verification — 2026-07-19

- Read-only verify approver health/cadence, registry ownership, controller approver, Sheet eligibility coverage, one approved-wallet buy simulation, and an ineligible-control rejection.
- Verify both frontend eight-plot guards and a live headless eligible-wallet dashboard with no signing or webhook mutation.
- Change only cache-busting query tags, keep shared tags synchronized, run JavaScript syntax checks, and commit the intended files on `main`.
- Never sign, broadcast, deploy, move funds, or alter contract/frontend logic.

## Codex marketplace three-page loop — 2026-07-20

- On branch `marketplace`, verify and repair the fork-only market, my-land, and
  activity journeys for connected wallets, transaction state, bounded/batched
  reads, sorting/filtering, disconnected state, and <=700px layouts.
- Run at most five gather/fix/retest rounds and record the first passing round
  for each of the nine user criteria.
- Use only Anvil chain 4663 at `localhost:8545` and the local static server;
  never deploy or broadcast to mainnet, merge, or push from a dirty worktree.
- Preserve unrelated `app.css`, `app.html`, and `app.js` edits and commit only
  marketplace fixes plus the requested `[codex]` verification log.
- Verification: full Forge suite, real EIP-1193 fork wallet UI journeys,
  on-chain fork assertions, RPC request accounting, console-error checks, and
  desktop/mobile screenshots.
