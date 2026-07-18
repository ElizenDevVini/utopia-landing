#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "PREFLIGHT FAIL: $*" >&2
  exit 1
}

for command_name in cast curl jq python3; do
  command -v "$command_name" >/dev/null || fail "$command_name is required"
done

: "${ROBINHOOD_RPC_URL:?set ROBINHOOD_RPC_URL to the production provider endpoint}"
: "${UTOPIA_LAND_ADDRESS:?set UTOPIA_LAND_ADDRESS}"
: "${UTOPIA_ELIGIBILITY_REGISTRY:?set UTOPIA_ELIGIBILITY_REGISTRY}"
: "${UTOPIA_OWNER:?set UTOPIA_OWNER}"

PUBLIC_RPC="https://rpc.mainnet.chain.robinhood.com"
EXPLORER="https://robinhoodchain.blockscout.com"
[[ "$ROBINHOOD_RPC_URL" != "$PUBLIC_RPC" ]] || fail "public Robinhood RPC is not a production provider"

[[ "$(cast chain-id --rpc-url "$ROBINHOOD_RPC_URL")" == "4663" ]] || fail "RPC is not chain 4663"
[[ "$(cast code "$UTOPIA_LAND_ADDRESS" --rpc-url "$ROBINHOOD_RPC_URL")" != "0x" ]] || fail "land has no bytecode"
[[ "$(cast code "$UTOPIA_ELIGIBILITY_REGISTRY" --rpc-url "$ROBINHOOD_RPC_URL")" != "0x" ]] || fail "registry has no bytecode"
[[ "$(cast code "$UTOPIA_OWNER" --rpc-url "$ROBINHOOD_RPC_URL")" != "0x" ]] || fail "owner is not a deployed multisig/timelock"

actual_owner=$(cast call "$UTOPIA_LAND_ADDRESS" 'owner()(address)' --rpc-url "$ROBINHOOD_RPC_URL")
registry_owner=$(cast call "$UTOPIA_ELIGIBILITY_REGISTRY" 'owner()(address)' --rpc-url "$ROBINHOOD_RPC_URL")
actual_registry=$(cast call "$UTOPIA_LAND_ADDRESS" 'eligibilityRegistry()(address)' --rpc-url "$ROBINHOOD_RPC_URL")
[[ "${actual_owner,,}" == "${UTOPIA_OWNER,,}" ]] || fail "land owner mismatch"
[[ "${registry_owner,,}" == "${UTOPIA_OWNER,,}" ]] || fail "registry owner mismatch"
[[ "${actual_registry,,}" == "${UTOPIA_ELIGIBILITY_REGISTRY,,}" ]] || fail "land registry mismatch"

reward_end=$(cast call "$UTOPIA_LAND_ADDRESS" 'rewardEnd()(uint64)' --rpc-url "$ROBINHOOD_RPC_URL")
[[ "$reward_end" -gt "$(date +%s)" ]] || fail "reward program has ended"

symbols=(TSLA AAPL NVDA MSFT AMZN)
expected=(
  0x322F0929c4625eD5bAd873c95208D54E1c003b2d
  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
  0xe93237C50D904957Cf27E7B1133b510C669c2e74
  0x12f190a9F9d7D37a250758b26824B97CE941bF54
)

requirements_json=$(cast call "$UTOPIA_LAND_ADDRESS" 'reserveRequiredForAllOpenPlots()(uint256[5])' \
  --rpc-url "$ROBINHOOD_RPC_URL" --json)
assets_json=$(curl -fsS https://api.robinhood.com/rhj/assets)

for i in 0 1 2 3 4; do
  token=$(cast call "$UTOPIA_LAND_ADDRESS" 'tokens(uint256)(address)' "$i" --rpc-url "$ROBINHOOD_RPC_URL")
  canonical=$(jq -r --arg symbol "${symbols[$i]}" \
    '.assets[] | select(.tokenSymbol == $symbol and .status == "ASSET_STATUS_ACTIVE") | .deployments[] | select(.chainId == 4663) | .contractAddress' \
    <<<"$assets_json")
  [[ -n "$canonical" ]] || fail "${symbols[$i]} missing from official active asset registry"
  [[ "${token,,}" == "${expected[$i],,}" ]] || fail "${symbols[$i]} contract constant mismatch"
  [[ "${token,,}" == "${canonical,,}" ]] || fail "${symbols[$i]} no longer matches official asset registry"
  [[ "$(cast call "$token" 'symbol()(string)' --rpc-url "$ROBINHOOD_RPC_URL" | tr -d '"')" == "${symbols[$i]}" ]] \
    || fail "${symbols[$i]} symbol mismatch"
  [[ "$(cast call "$token" 'decimals()(uint8)' --rpc-url "$ROBINHOOD_RPC_URL")" == "18" ]] \
    || fail "${symbols[$i]} decimals mismatch"

  balance=$(cast call "$token" 'balanceOf(address)(uint256)' "$UTOPIA_LAND_ADDRESS" \
    --rpc-url "$ROBINHOOD_RPC_URL" --json | jq -r '.[0]')
  committed=$(cast call "$UTOPIA_LAND_ADDRESS" 'totalCommittedByToken(uint256)(uint256)' "$i" \
    --rpc-url "$ROBINHOOD_RPC_URL" --json | jq -r '.[0]')
  required=$(jq -r ".[0][$i]" <<<"$requirements_json")
  python3 -c 'import sys; raise SystemExit(int(sys.argv[1]) < int(sys.argv[2]) + int(sys.argv[3]))' \
    "$balance" "$committed" "$required" || fail "${symbols[$i]} cannot cover sold plus all open plots"
done

for contract_address in "$UTOPIA_LAND_ADDRESS" "$UTOPIA_ELIGIBILITY_REGISTRY"; do
  curl -fsS "$EXPLORER/api/v2/smart-contracts/$contract_address" | jq -e '.is_verified == true' >/dev/null \
    || fail "$contract_address is not source verified on Blockscout"
done

echo "PREFLIGHT PASS: verified, owned, canonical, active, and fully reserved through $reward_end"
