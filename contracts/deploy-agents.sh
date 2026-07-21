#!/usr/bin/env bash
# Deploy UtopiaStockSwap and UtopiaAgentVault to Robinhood Chain mainnet.
# Owner of both = the Safe. Prompts for the deployer key; validates it before
# doing anything.
set -u

RPC=https://rpc.mainnet.chain.robinhood.com
LAND=0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2
SAFE=0xBdD5507c1823b663f54353e47576685e3398eE72
DEPLOYER=0x81fEba4e619E5C9dF6CA317e4772EeDa29ABC7dA
FEE_BPS=30

echo "will deploy UtopiaStockSwap then UtopiaAgentVault:"
echo "  land:          $LAND"
echo "  swap fee:      $FEE_BPS bps"
echo "  owner of both: $SAFE (Safe)"
echo ""

printf "deployer private key (input hidden): "
read -rs KEY
echo
ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null || true)
if [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" ]; then
  KEY=""
  echo "key derives ${ADDR:-nothing}, expected deployer $DEPLOYER. nothing deployed."
  exit 1
fi
echo "key OK ($ADDR). building + deploying swap..."

if ! SWAP_OUTPUT=$(forge create src/UtopiaStockSwap.sol:UtopiaStockSwap \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$LAND" "$FEE_BPS" "$SAFE" 2>&1); then
  printf '%s\n' "$SWAP_OUTPUT"
  KEY=""
  echo "swap deployment failed. vault not deployed."
  exit 1
fi
printf '%s\n' "$SWAP_OUTPUT"
SWAP=$(printf '%s\n' "$SWAP_OUTPUT" | sed -n 's/^Deployed to:[[:space:]]*\(0x[[:xdigit:]]\{40\}\)[[:space:]]*$/\1/p' | tail -n 1)
if ! [[ "$SWAP" =~ ^0x[[:xdigit:]]{40}$ ]]; then
  KEY=""
  echo "could not parse the swap 'Deployed to:' address. vault not deployed."
  exit 1
fi
echo "swap deployed at $SWAP. building + deploying vault..."

if ! VAULT_OUTPUT=$(forge create src/UtopiaAgentVault.sol:UtopiaAgentVault \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$LAND" "$SWAP" "$SAFE" 2>&1); then
  printf '%s\n' "$VAULT_OUTPUT"
  KEY=""
  echo "vault deployment failed. swap remains deployed at $SWAP."
  exit 1
fi
printf '%s\n' "$VAULT_OUTPUT"
VAULT=$(printf '%s\n' "$VAULT_OUTPUT" | sed -n 's/^Deployed to:[[:space:]]*\(0x[[:xdigit:]]\{40\}\)[[:space:]]*$/\1/p' | tail -n 1)
KEY=""
if ! [[ "$VAULT" =~ ^0x[[:xdigit:]]{40}$ ]]; then
  echo "could not parse the vault 'Deployed to:' address. swap remains deployed at $SWAP."
  exit 1
fi
echo ""
echo "post-deploy checklist:"
echo "  1. fund swap inventory with each of the 5 stocks by plain transfer."
echo "  2. verify one small live swap and one agent activate + deposit + rebalance end-to-end before announcing."
echo "     stock tokens are restricted: confirm both contracts can hold and send them."
echo "  3. paste both addresses into config.js:"
echo "     stockSwap:  $SWAP"
echo "     agentVault: $VAULT"
