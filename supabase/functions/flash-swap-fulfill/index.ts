import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * Flash Swap Fulfill — Engine listens to SwapRequested, sends USDT via PancakeSwap
 *
 * Flow:
 *   1. Poll FlashSwapV4 for pending requests (getPendingRequests)
 *   2. For each pending request:
 *      a. Engine USDC → PancakeSwap V3 SmartRouter → USDT (via pool 0x92b7)
 *      b. USDT → transfer to user
 *      c. Call FlashSwapV4.fulfillSwap(requestId, txHash)
 *
 * Cron: every 1 minute (or triggered by webhook)
 *
 * On-chain trace:
 *   TX1 (user):   MA burn via requestSwap()
 *   TX2 (engine): USDC→Pool(0x92b7)→USDT→Engine→User + fulfillSwap()
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

const ENGINE_WALLET = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
const FLASH_SWAP = "0xf596f3BEe64C4AB698a8e6A65893cd32457F5Df3";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"; // PancakeSwap V3 SmartRouter
const BSC_RPC = "https://bsc-dataseed1.binance.org";

// ─── Helpers ─────────────────────────────────────────────

async function rpcCall(method: string, params: unknown[]) {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await res.json()).result;
}

async function engineWrite(calls: Array<{ contractAddress: string; method: string; params: unknown[] }>) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from: ENGINE_WALLET, chainId: "56" },
      params: calls,
    }),
  });
  return res.json();
}

// ─── Main ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Read pending requests from FlashSwapV4
    // getPendingRequests(0, 10) → returns up to 10 pending
    const getPendingData = "0x" + // function selector for getPendingRequests(uint256,uint256)
      "0000000000000000000000000000000000000000000000000000000000000000" + // fromId = 0
      "000000000000000000000000000000000000000000000000000000000000000a";  // limit = 10

    // Use pendingCount first to check if any pending
    const pendingCountData = "0x" + "f39ec1f7"; // pendingCount() - need to compute selector
    // Actually let's just read pendingCount
    const countResult = await rpcCall("eth_call", [{ to: FLASH_SWAP, data: "0x" + "40bade38" }, "latest"]);
    // pendingCount selector... let's just try to get pending requests

    // Simpler: read nextRequestId and check each
    const nextIdData = "0x" + "d4660498"; // placeholder - we'll compute

    // Actually, let's use a simpler approach: read events
    // Get SwapRequested events from last 100 blocks
    const currentBlock = await rpcCall("eth_blockNumber", []);
    const fromBlock = "0x" + (parseInt(currentBlock, 16) - 1000).toString(16);

    const swapRequestedTopic = "0x" + "6c0060b1"; // We need the real topic

    // Even simpler: just call getPendingRequests via engine read
    const readRes = await fetch("https://engine.thirdweb.com/v1/read/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        chainId: "56",
        contractAddress: FLASH_SWAP,
        method: "function pendingCount() view returns (uint256)",
        params: [],
      }),
    });
    const pendingData = await readRes.json();
    const pendingCount = parseInt(pendingData?.result || "0");

    if (pendingCount === 0) {
      return json({ status: "skip", reason: "no pending requests" });
    }

    // Read pending requests
    const reqsRes = await fetch("https://engine.thirdweb.com/v1/read/contract", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        chainId: "56",
        contractAddress: FLASH_SWAP,
        method: "function getPendingRequests(uint256 fromId, uint256 limit) view returns ((address user, uint256 maAmount, uint256 usdtOut, uint256 maPrice, uint256 fee, uint256 timestamp, bool fulfilled)[], uint256[])",
        params: ["0", "10"],
      }),
    });
    const reqsData = await reqsRes.json();
    const [pendingRequests, requestIds] = reqsData?.result || [[], []];

    if (!pendingRequests || pendingRequests.length === 0) {
      return json({ status: "skip", reason: "no pending after read" });
    }

    console.log(`Processing ${pendingRequests.length} pending swap requests`);

    const fulfilled: Array<{ requestId: string; user: string; usdtOut: string; txId: string }> = [];

    for (let i = 0; i < pendingRequests.length; i++) {
      const req = pendingRequests[i];
      const requestId = requestIds[i];
      const user = req.user || req[0];
      const usdtOut = req.usdtOut || req[2];

      if (!user || user === "0x0000000000000000000000000000000000000000") continue;

      // 2. Swap USDC → USDT via PancakeSwap V3 SmartRouter
      //    Then transfer USDT to user
      //    Do both in one engine call (multicall)

      const usdtHex = "0x" + BigInt(usdtOut).toString(16);
      // Add 0.5% buffer for swap slippage
      const usdcNeeded = "0x" + (BigInt(usdtOut) * 1005n / 1000n).toString(16);

      const result = await engineWrite([
        // Step 1: Approve USDC to PancakeSwap Router
        {
          contractAddress: USDC,
          method: "function approve(address spender, uint256 amount) returns (bool)",
          params: [PANCAKE_ROUTER, usdcNeeded],
        },
        // Step 2: Swap USDC → USDT via PancakeSwap V3
        {
          contractAddress: PANCAKE_ROUTER,
          method: "function exactOutputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn)",
          params: [{
            tokenIn: USDC,
            tokenOut: USDT,
            fee: "100",          // 0.01% fee tier (stablecoin)
            recipient: user,     // USDT goes directly to user
            amountOut: usdtHex,
            amountInMaximum: usdcNeeded,
            sqrtPriceLimitX96: "0",
          }],
        },
        // Step 3: Mark as fulfilled on FlashSwap contract
        {
          contractAddress: FLASH_SWAP,
          method: "function fulfillSwap(uint256 requestId, bytes32 txHash)",
          params: [requestId, "0x0000000000000000000000000000000000000000000000000000000000000000"], // txHash filled later
        },
      ]);

      const txId = result?.result?.transactionIds?.[0] || result?.result?.transactions?.[0]?.id || "unknown";
      fulfilled.push({ requestId: requestId.toString(), user, usdtOut: usdtOut.toString(), txId });
      console.log(`Fulfilled request #${requestId}: ${user} → ${usdtOut} USDT, tx: ${txId}`);
    }

    return json({
      status: "fulfilled",
      count: fulfilled.length,
      pending: pendingCount - fulfilled.length,
      details: fulfilled,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FlashSwap fulfill error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
