#!/usr/bin/env bash
# Deploy UtopiaBuildings to Robinhood Chain mainnet.
# Free forever: fee = 0, no fee token. Owner = the Safe (can never alter anyone's
# building; can only set a fee, which stays 0). Prompts for the deployer key;
# validates it before doing anything.
set -u

RPC=https://rpc.mainnet.chain.robinhood.com
LAND=0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2
SAFE=0xBdD5507c1823b663f54353e47576685e3398eE72
DEPLOYER=0x81fEba4e619E5C9dF6CA317e4772EeDa29ABC7dA
FEE_TOKEN=0x0000000000000000000000000000000000000000
FEE=0

echo "will deploy UtopiaBuildings:"
echo "  land:          $LAND"
echo "  owner:         $SAFE (Safe)"
echo "  fee recipient: $SAFE (Safe)"
echo "  fee token:     none"
echo "  fee:           0 (free for every plot owner)"
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

forge create src/UtopiaBuildings.sol:UtopiaBuildings \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$LAND" "$FEE_TOKEN" "$FEE" "$SAFE" "$SAFE"
KEY=""
echo ""
echo "^ copy the 'Deployed to:' address and paste it to claude."
