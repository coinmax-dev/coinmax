#!/bin/bash
# CoinMax Auto Bridge + Flush Cron
# Runs every 10 minutes: SW → BatchBridge → swapAndBridge → ARB flushAll
#
# crontab: */10 * * * * /Users/macbookpro/WebstormProjects/coinmax-dev/contracts/scripts/cron-bridge-flush.sh >> /Users/macbookpro/WebstormProjects/coinmax-dev/logs/bridge-cron.log 2>&1

set -e
cd /Users/macbookpro/WebstormProjects/coinmax-dev/contracts

SUPABASE_URL="https://enedbksmftcgtszrkppc.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3OTMxMjAsImV4cCI6MjA4OTM2OTEyMH0.B1cyUgbpV5JopebVHlLWCnwRwhqa0TRICRB9btQ23vU"
MIN_BRIDGE=50
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Use nvm node if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo "$LOG_PREFIX ══════ Bridge Cron Start ══════"

# Step 1: Check BatchBridge USDT balance
BB_BAL=$(curl -s -X POST https://bsc-dataseed1.binance.org \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x55d398326f99059fF775485246999027B3197955","data":"0x70a0823100000000000000000000000096dBfe3aAa877A4f9fB41d592f1D990368a4B2C1"},"latest"],"id":1}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin).get('result','0x0'); print(int(r,16)/1e18)")

echo "$LOG_PREFIX BatchBridge USDT: $BB_BAL"

# Step 2: If BatchBridge is empty, transfer from Server Wallet
if (( $(echo "$BB_BAL < $MIN_BRIDGE" | bc -l) )); then
  echo "$LOG_PREFIX Triggering SW → BatchBridge transfer..."
  TRANSFER=$(curl -s -X POST "$SUPABASE_URL/functions/v1/vault-bridge-flush" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ANON_KEY")

  STATUS=$(echo "$TRANSFER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  BALANCE=$(echo "$TRANSFER" | python3 -c "import sys,json; print(json.load(sys.stdin).get('balance',0))" 2>/dev/null)

  echo "$LOG_PREFIX Transfer: $STATUS (\$$BALANCE)"

  if [ "$STATUS" = "skipped" ]; then
    echo "$LOG_PREFIX Nothing to bridge. Done."
    exit 0
  fi

  if [ "$STATUS" != "TRANSFERRED" ]; then
    echo "$LOG_PREFIX Transfer failed. Aborting."
    exit 1
  fi

  # Wait for transfer to confirm
  sleep 15

  # Re-check balance
  BB_BAL=$(curl -s -X POST https://bsc-dataseed1.binance.org \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x55d398326f99059fF775485246999027B3197955","data":"0x70a0823100000000000000000000000096dBfe3aAa877A4f9fB41d592f1D990368a4B2C1"},"latest"],"id":1}' \
    | python3 -c "import sys,json; r=json.load(sys.stdin).get('result','0x0'); print(int(r,16)/1e18)")

  echo "$LOG_PREFIX BatchBridge USDT after transfer: $BB_BAL"
fi

if (( $(echo "$BB_BAL < $MIN_BRIDGE" | bc -l) )); then
  echo "$LOG_PREFIX Below min ($MIN_BRIDGE). Done."
  exit 0
fi

# Step 3: BSC swapAndBridge
echo "$LOG_PREFIX Running swapAndBridge on BSC..."
BSC_OUT=$(npx hardhat run scripts/bridge-continue.js --network bsc 2>&1)
echo "$BSC_OUT" | grep -E "SUCCESS|REVERTED|Error|USDT|USDC|Done"

if echo "$BSC_OUT" | grep -q "BRIDGE SUCCESS"; then
  echo "$LOG_PREFIX BSC bridge successful. Waiting 150s for Stargate..."
  sleep 150

  # Step 4: ARB flushAll
  echo "$LOG_PREFIX Running flushAll on ARB..."
  ARB_OUT=$(npx hardhat run scripts/bridge-continue.js --network arbitrum 2>&1)
  echo "$ARB_OUT" | grep -E "FLUSH|USDC|Error|funds|Wallet"

  if echo "$ARB_OUT" | grep -q "FLUSH SUCCESS"; then
    echo "$LOG_PREFIX ✅ Full cycle complete: BSC → ARB → 5 wallets"
  else
    echo "$LOG_PREFIX ⚠️ Bridge ok but flush pending (Stargate may still be in transit)"
  fi
else
  echo "$LOG_PREFIX ❌ BSC bridge failed or no funds"
fi

echo "$LOG_PREFIX ══════ Bridge Cron End ══════"
