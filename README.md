# utopia landing

Static landing page and dashboard for Utopia land on Robinhood Chain.

## Networks

The checked-in default is the funded V2 testnet deployment. Chain IDs, RPCs,
explorers, and contract addresses live in `config.js`; do not duplicate them in
HTML or page modules.

Preview the intentionally disabled mainnet state with:

```text
http://localhost:4173/?net=mainnet
http://localhost:4173/app.html?net=mainnet
```

A production host can inject a provider endpoint before the module scripts:

```html
<script>
  window.UTOPIA_RUNTIME = { network: 'mainnet', rpcUrl: 'https://provider.example' };
</script>
```

Never place a secret provider key in this public static repository. Use an
origin-restricted provider credential or a caching server-side RPC proxy.

## Mainnet gate

Mainnet remains disabled until all of the following exist and are recorded in
`config.js`:

- fixed-supply UTOP deployment;
- reviewed Uniswap v4-compatible or external market-oracle adapter;
- reviewed and verified `UtopiaLandV3` deployment;
- funded Stock Token reserves and disclosed multisig/timelock owner;
- launchpad audit/source-verification gates and jurisdictional review completed.

`UtopiaLandV3.sol` is an undeployed candidate, not production approval.

## Verify

```sh
node --check art.js
node --check chain.js
node --check app.js
node --check iso.js
node --check config.js
cd contracts
forge test
```
