#!/usr/bin/env bash
# Send the full stock basket from the deployer wallet into the land treasury,
# deepening the real-asset backing behind every plot. Transfers only, no trades.
# Prompts for the deployer key; validates it before sending anything.
set -u

RPC=https://rpc.mainnet.chain.robinhood.com
LAND=0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2
DEP=0x81fEba4e619E5C9dF6CA317e4772EeDa29ABC7dA

# token -> amount (current full balances)
TSLA=0x322F0929c4625eD5bAd873c95208D54E1c003b2d; TSLA_AMT=303216231902051812
AAPL=0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9; AAPL_AMT=348205508589070834
NVDA=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC; NVDA_AMT=554318735141818880
MSFT=0xe93237C50D904957Cf27E7B1133b510C669c2e74; MSFT_AMT=280173340513604215
AMZN=0x12f190a9F9d7D37a250758b26824B97CE941bF54; AMZN_AMT=460801089732478027

printf "deployer private key (input hidden): "
read -rs KEY
echo
ADDR=$(cast wallet address --private-key "$KEY" 2>/dev/null || true)
if [ "$(echo "$ADDR" | tr 'A-F' 'a-f')" != "$(echo "$DEP" | tr 'A-F' 'a-f')" ]; then
  echo "key derives ${ADDR:-nothing}, expected $DEP. nothing sent."
  exit 1
fi
echo "key OK. funding the treasury..."

send() { # token amount label
  echo ""; echo "-> $3 to treasury"
  OUT=$(cast send "$1" 'transfer(address,uint256)' "$LAND" "$2" --private-key "$KEY" --rpc-url "$RPC" 2>&1)
  echo "$OUT" | grep -q "status.*1" && echo "   sent" || { echo "   FAILED:"; echo "$OUT" | head -4; }
  sleep 3
}
send $TSLA $TSLA_AMT "TSLA 0.303"
send $AAPL $AAPL_AMT "AAPL 0.348"
send $NVDA $NVDA_AMT "NVDA 0.554"
send $MSFT $MSFT_AMT "MSFT 0.280"
send $AMZN $AMZN_AMT "AMZN 0.461"
KEY=""
echo ""; echo "done. treasury reserves now:"
for i in 0 1 2 3 4; do
  T=($TSLA $AAPL $NVDA $MSFT $AMZN); N=(TSLA AAPL NVDA MSFT AMZN)
  echo "  ${N[$i]}: $(cast call ${T[$i]} 'balanceOf(address)(uint256)' $LAND --rpc-url $RPC 2>/dev/null | head -1)"
  sleep 1
done
