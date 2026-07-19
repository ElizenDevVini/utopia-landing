# utopia landing

Static landing page and dashboard for Utopia land on Robinhood Chain.

## Networks

The checked-in default is the Robinhood Chain mainnet profile. It remains
fail-closed until the verified deployment, production RPC, eligibility flow, and
reserve preflight are configured. Testnet is available only as an explicit
preview (`?net=testnet` or `?net=testnet-v2`). Chain IDs, RPCs, explorers, and
contract addresses live in `config.js`; do not duplicate them in HTML or page
modules.

Preview the production gate or explicit testnets with:

```text
http://localhost:4173/
http://localhost:4173/app.html
http://localhost:4173/?net=mainnet
http://localhost:4173/app.html?net=mainnet
http://localhost:4173/?net=testnet-v2
http://localhost:4173/app.html?net=testnet-v2
```

A production host can inject the release values before the module scripts:

```html
<script>
  window.UTOPIA_RUNTIME = {
    network: 'mainnet',
    rpcUrl: 'https://provider.example',
    landAddress: '0xVerifiedLandContract',
    eligibilityUrl: 'https://eligibility.example'
  };
</script>
```

Never place a secret provider key in this public static repository. Use an
origin-restricted provider credential or a caching server-side RPC proxy.

## Mainnet gate

Mainnet deliberately mirrors the proven native-ETH purchase path; the UTOP
launch is a separate future release. Mainnet remains disabled until:

- `UtopiaLandMainnet` and `UtopiaEligibility` pass independent review and are
  source verified on chain 4663 with a disclosed Safe/multisig owner;
- the reward deadline and five immutable rates are approved;
- canonical Stock Token reserves cover sold and every open plot;
- an approved eligibility flow exists for the restricted Stock Tokens;
- a production RPC is configured and `contracts/script/preflight-mainnet.sh`
  passes; and
- an eligible fresh wallet proves buy -> white plot -> dashboard accrual ->
  claim -> increased wallet Stock Token balance on mainnet.

The full operator process is in [`contracts/MAINNET.md`](contracts/MAINNET.md).
No mainnet deployment or reserve transfer has been performed from this repo.

## Verify

```sh
node --check art.js
node --check chain.js
node --check app.js
node --check iso.js
node --check config.js
cd contracts
forge fmt --check
forge test
bash -n script/preflight-mainnet.sh
```
