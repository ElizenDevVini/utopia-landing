#!/usr/bin/env bash
# Pull the access-request sheet, drop anyone already eligible on-chain, and print
# one Safe transaction (setEligibilityMany) that enrolls everyone still pending.
#
# Usage: ./enroll-pending.sh
# Then paste the printed To/Value/Data into the Safe transaction builder.
set -euo pipefail

SHEET=1o4HJSfshUboS9hbJyV8LbkacLHkhUHvKZwSuZGCpj0U
RPC=https://rpc.mainnet.chain.robinhood.com
REG=0x4e1810cD119e5b05329d6e6E84a0aC01B3dda6CB   # eligibility registry
EXPIRY=1815962466                                 # good until ~mid-2027

echo "reading sheet..." >&2
all=$(curl -sL "https://docs.google.com/spreadsheets/d/$SHEET/export?format=csv" \
  | grep -oiE '0x[0-9a-f]{40}' | tr 'A-F' 'a-f' | sort -u)

pending=()
for a in $all; do
  e=$(cast call "$REG" 'isEligible(address)(bool)' "$a" --rpc-url "$RPC" 2>/dev/null | head -1)
  if [ "$e" = "true" ]; then
    echo "  eligible already: $a" >&2
  else
    echo "  PENDING:          $a" >&2
    pending+=("$a")
  fi
  perl -e 'select(undef,undef,undef,0.6)'   # space calls so the RPC doesn't rate-limit
done

n=${#pending[@]}
if [ "$n" -eq 0 ]; then echo "nothing to enroll — everyone is already eligible." >&2; exit 0; fi
if [ "$n" -gt 200 ]; then echo "$n pending — over the 200 cap, split into batches." >&2; exit 1; fi

addrs=$(IFS=,; echo "${pending[*]}")
expiries=$(printf "%s," $(for _ in "${pending[@]}"; do echo "$EXPIRY"; done)); expiries="${expiries%,}"
data=$(cast calldata 'setEligibilityMany(address[],uint64[])' "[$addrs]" "[$expiries]")

echo >&2
echo "== Safe transaction ($n wallets) ==" >&2
echo "To:    $REG" >&2
echo "Value: 0" >&2
echo "Data:" >&2
echo "$data"
