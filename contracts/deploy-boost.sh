#!/usr/bin/env bash
# Deploy UtopiaBoost to Robinhood Chain mainnet.
# Owner = the Safe. Boost end = the land reward end. Prompts for the deployer
# key; validates it before doing anything.
set -u

RPC=https://rpc.mainnet.chain.robinhood.com
LAND=0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2
SAFE=0xBdD5507c1823b663f54353e47576685e3398eE72
DEPLOYER=0x81fEba4e619E5C9dF6CA317e4772EeDa29ABC7dA
UTOPIA=0x164d9da79722c5294369e79807980e0bff257777
# $utopia amount that yields half of the 3x incremental boost; design parameter, set before launch.
HALF_SATURATION=SET_BEFORE_LAUNCH

BOOST_END_RAW=$(cast call "$LAND" 'rewardEnd()(uint64)' --rpc-url "$RPC" 2>/dev/null || true)
BOOST_END=${BOOST_END_RAW%% *}
if ! [[ "$BOOST_END" =~ ^[0-9]+$ ]]; then
  echo "could not read land.rewardEnd() from $RPC. nothing deployed."
  exit 1
fi
NOW=$(date +%s)
if [ "$BOOST_END" -lt "$((NOW + 30 * 24 * 60 * 60))" ]; then
  echo "land reward window has under 30 days remaining. nothing deployed."
  exit 1
fi

echo "will deploy UtopiaBoost:"
echo "  land:            $LAND"
echo "  utopia:          $UTOPIA"
echo "  half saturation: $HALF_SATURATION"
echo "  boost end:       $BOOST_END (land reward end)"
echo "  initial owner:   $SAFE (Safe)"
echo ""

if [ "$HALF_SATURATION" = SET_BEFORE_LAUNCH ]; then
  echo "set HALF_SATURATION to the launch design parameter before deploying. nothing deployed."
  exit 1
fi

printf "deployer private key (input hidden): "
read -rs KEY
echo
ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null || true)
if [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$DEPLOYER" | tr 'A-F' 'a-f')" ]; then
  echo "key derives ${ADDR:-nothing}, expected deployer $DEPLOYER. nothing deployed."
  exit 1
fi
echo "key OK ($ADDR). building + deploying..."

if ! forge create src/UtopiaBoost.sol:UtopiaBoost \
  --rpc-url "$RPC" --private-key "$KEY" --broadcast \
  --constructor-args "$LAND" "$UTOPIA" "$HALF_SATURATION" "$BOOST_END" "$SAFE"; then
  KEY=""
  echo "deployment failed. nothing deployed."
  exit 1
fi
KEY=""
echo ""
echo "^ copy the 'Deployed to:' address, then:"
echo "  1. fund each of the 5 stock reserves by plain transfer."
echo "  2. verify a small test stake + claim end-to-end on-chain before announcing."
echo "     stock tokens are restricted: confirm the boost contract can receive and send them."
echo "  3. wire the deployed address into the frontend config."
