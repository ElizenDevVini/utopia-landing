#!/usr/bin/env bash
# Turn a list of approved wallet addresses into calldata for one Safe
# transaction that enrolls them all (setEligibilityMany, up to 200 at once).
#
# Usage:
#   ./batch-enroll.sh 0xAddr1 0xAddr2 0xAddr3 ...
#
# Paste the printed calldata into the Safe app (New Transaction -> custom /
# transaction builder) with:
#   To:    0x4e1810cD119e5b05329d6e6E84a0aC01B3dda6CB   (the eligibility registry)
#   Value: 0
#   Data:  <printed below>
set -euo pipefail

EXPIRY=1815962466   # eligibility good until ~mid-2027; edit if you want shorter

if [ "$#" -eq 0 ]; then
  echo "give one or more wallet addresses as arguments" >&2
  exit 1
fi
if [ "$#" -gt 200 ]; then
  echo "max 200 addresses per batch (the registry cap). split into batches." >&2
  exit 1
fi

addrs=$(IFS=,; echo "$*")
expiries=$(printf "%s," $(for _ in "$@"; do echo "$EXPIRY"; done)); expiries="${expiries%,}"

cast calldata 'setEligibilityMany(address[],uint64[])' "[$addrs]" "[$expiries]"
