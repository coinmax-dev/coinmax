import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * V4 FlashSwap — 轮换钱包 USDC→PancakeSwap(121)→USDT 给用户
 *
 * Master 钱包充值 USDC，分配给 5 个轮换钱包
 * 每次闪兑自动选有余额的轮换钱包执行 swap
 * 余额不足时从 Master 补充
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";

const MASTER_WALLET = "0x426A6a90Bc1cbB91a3BaccF17D6a42534C3f40F6";
const ROTATION_WALLETS = [
  "0xb5E9dFb8E1375dAB63B0bE9E8DB916bD5fc49535",
  "0x4FaE1a307B1947ab257ef3D7da9347BBc0A65b2D",
  "0xE2b4da89709348b45935597046192bDa627a47aa",
  "0x562a92Fb0b2bC8787a5C3dE4424745fEF8fCbc80",
  "0x54671ae6627F654A8718Ac7B65AF2DAb489361c4",
];

const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_RPC = "https://bsc-dataseed1.binance.org";
const ORACLE = "0x35580292fA5c8b7110034EA1a1521952E6F42bbb";

const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

// ── Engine write ──
async function engineWrite(from: string, call: { contractAddress: string; method: string; params: unknown[] }) {
  const res = await fetch("https://engine.thirdweb.com/v1/write/contract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      executionOptions: { type: "EOA", from, chainId: "56" },
      params: [call],
    }),
  });
  return res.json();
}

// ── Read USDC balance ──
async function getUSDCBalance(wallet: string): Promise<number> {
  const data = "0x70a08231000000000000000000000000" + wallet.slice(2).toLowerCase();
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: USDC, data }, "latest"] }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e18;
}

// ── Read USDC allowance ──
async function getUSDCAllowance(wallet: string): Promise<bigint> {
  const data = "0xdd62ed3e"
    + wallet.slice(2).toLowerCase().padStart(64, "0")
    + PANCAKE_ROUTER.slice(2).toLowerCase().padStart(64, "0");
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: USDC, data }, "latest"] }),
  });
  const d = await res.json();
  return BigInt(d.result || "0x0");
}

// ── Oracle price ──
async function getOraclePrice(): Promise<number> {
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: ORACLE, data: "0x98d5fdca" }, "latest"] }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e6;
}

// ── Select rotation wallet with sufficient balance ──
async function selectWallet(amountNeeded: number): Promise<string | null> {
  // Try rotation wallets first (round-robin based on swap count)
  for (const w of ROTATION_WALLETS) {
    const bal = await getUSDCBalance(w);
    if (bal >= amountNeeded) return w;
  }
  // Fallback to master
  const masterBal = await getUSDCBalance(MASTER_WALLET);
  if (masterBal >= amountNeeded) return MASTER_WALLET;
  return null;
}

// ── Distribute USDC from Master to Rotation wallets ──
async function distributeFromMaster(amountNeeded: number): Promise<string | null> {
  const masterBal = await getUSDCBalance(MASTER_WALLET);
  if (masterBal < amountNeeded) return null;

  // Pick the rotation wallet with lowest balance
  let targetWallet = ROTATION_WALLETS[0];
  let minBal = Infinity;
  for (const w of ROTATION_WALLETS) {
    const bal = await getUSDCBalance(w);
    if (bal < minBal) { minBal = bal; targetWallet = w; }
  }

  // Transfer from Master to target (send enough for this swap + buffer)
  const transferAmount = Math.min(amountNeeded * 10, masterBal * 0.2); // 10x or 20% of master
  const transferWei = BigInt(Math.floor(transferAmount * 1e18)).toString();

  console.log(`Distribute: Master → ${targetWallet.slice(0,10)} $${transferAmount.toFixed(2)} USDC`);
  const result = await engineWrite(MASTER_WALLET, {
    contractAddress: USDC,
    method: "function transfer(address to, uint256 amount) returns (bool)",
    params: [targetWallet, transferWei],
  });
  console.log("Transfer TX:", result?.result?.transactions?.[0]?.id || "?");

  // Wait for transfer to confirm
  await new Promise(r => setTimeout(r, 5000));
  return targetWallet;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { walletAddress, maAmount, txHash } = await req.json();
    if (!walletAddress || !maAmount) return json({ error: "Missing walletAddress or maAmount" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const amount = Number(maAmount);
    if (amount <= 0) return json({ error: "Invalid amount" }, 400);

    const maPrice = await getOraclePrice();
    if (maPrice <= 0) return json({ error: "Oracle price unavailable" }, 500);

    const usdtAmount = amount * maPrice;
    console.log(`FlashSwap: ${walletAddress} | ${amount} MA × $${maPrice} = $${usdtAmount.toFixed(2)} USDT`);

    // 1. Select wallet with sufficient USDC
    let swapWallet = await selectWallet(usdtAmount);

    // 2. If no wallet has enough, distribute from Master
    if (!swapWallet) {
      swapWallet = await distributeFromMaster(usdtAmount);
      if (!swapWallet) {
        return json({ error: "Insufficient USDC balance across all wallets" }, 500);
      }
    }

    console.log(`Using wallet: ${swapWallet.slice(0,10)}...`);

    // 3. Auto-approve USDC to PancakeSwap if needed
    const allowance = await getUSDCAllowance(swapWallet);
    const neededWei = BigInt(Math.floor(usdtAmount * 1e18));

    if (allowance < neededWei) {
      console.log("Approving USDC for " + swapWallet.slice(0,10));
      await engineWrite(swapWallet, {
        contractAddress: USDC,
        method: "function approve(address spender, uint256 amount) returns (bool)",
        params: [PANCAKE_ROUTER, MAX_UINT256],
      });
      await new Promise(r => setTimeout(r, 5000));
    }

    // 4. Swap USDC → USDT via PancakeSwap (121 pool) → user
    const amountInStr = BigInt(Math.floor(usdtAmount * 1e18)).toString();
    const minOutStr = BigInt(Math.floor(usdtAmount * 0.995 * 1e18)).toString();

    const swapResult = await engineWrite(swapWallet, {
      contractAddress: PANCAKE_ROUTER,
      method: "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
      params: [[USDC, USDT, "100", walletAddress, amountInStr, minOutStr, "0"]],
    });
    const swapTxId = swapResult?.result?.transactions?.[0]?.id || "?";
    console.log("Swap TX:", swapTxId, swapResult?.error?.details?.message || "ok");

    // 5. Record transaction
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .single();

    if (profile) {
      await supabase.from("transactions").insert({
        user_id: profile.id,
        type: "FLASH_SWAP",
        amount: usdtAmount,
        token: "USDT",
        status: "CONFIRMED",
        tx_hash: txHash || null,
        details: { maAmount: amount, maPrice, usdtAmount, swapTxId, swapWallet: swapWallet.slice(0,10) },
      });
    }

    return json({ status: "ok", maAmount: amount, maPrice, usdtAmount, swapTxId });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("FlashSwap error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
