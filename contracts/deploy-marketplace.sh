#!/usr/bin/env bash
# Deploy UtopiaMarketplace v2 to Robinhood Chain mainnet.
# Owner + fee recipient = the Safe. Fee split: 1% operator, 2% holder pool.
# Prompts for the deployer key; validates it before doing anything.
set -u

RPC=https://rpc.mainnet.chain.robinhood.com
LAND=0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2
SAFE=0xBdD5507c1823b663f54353e47576685e3398eE72
DEPLOYER=0x81fEba4e619E5C9dF6CA317e4772EeDa29ABC7dA
OPERATOR_FEE=100   # 1.0%
POOL_FEE=200       # 2.0%

echo "will deploy UtopiaMarketplace:"
echo "  land:          $LAND"
echo "  owner:         $SAFE (Safe)"
echo "  fee recipient: $SAFE (Safe)"
echo "  fee split:     1% operator + 2% holder pool"
echo ""

printf "deployer private key (input hidden): "
read -rs KEY
echo
ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null || true)
if [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" ]; then
  echo "key derives ${ADDR:-nothing}, expected deployer $DEPLOYER. nothing deployed."
  exit 1
fi
echo "key OK ($ADDR). building + deploying..."

forge create src/UtopiaMarketplace.sol:UtopiaMarketplace \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$LAND" "$OPERATOR_FEE" "$POOL_FEE" "$SAFE" "$SAFE"
KEY=""
echo ""
echo "^ copy the 'Deployed to:' address and paste it to claude."
echo "  also note the current block for the frontend startBlock:"
cast block-number --rpc-url "$RPC" 2>/dev/null
