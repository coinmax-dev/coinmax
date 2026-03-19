/**
 * HyperLiquid Treasury Edge Function
 *
 * Manages protocol treasury funds on HyperLiquid:
 *   - deposit: Transfer USDC from Arbitrum wallet → HyperLiquid perps account
 *   - withdraw: Withdraw USDC from HyperLiquid perps account → Arbitrum wallet
 *   - balance: Query current account state (balances, positions, withdrawable)
 *   - status: Full treasury status with positions and PnL
 *
 * Authentication: requires TREASURY_ADMIN_KEY header or service_role JWT
 *
 * HyperLiquid API docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { ethers } from "https://esm.sh/ethers@6.13.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

// ── Config ───────────────────────────────────────────────────
const HL_API = "https://api.hyperliquid.xyz";
const HL_WALLET_KEY = Deno.env.get("HL_PRIVATE_KEY") || "";
const TREASURY_ADMIN_KEY = Deno.env.get("TREASURY_ADMIN_KEY") || "";

// USDC on Arbitrum (used for L1 deposit to HL)
const USDC_ARB_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
// HyperLiquid L1 bridge contract on Arbitrum
const HL_BRIDGE_ADDRESS = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";

// Minimal ERC-20 ABI for approve + transfer
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// HyperLiquid Bridge ABI (deposit USDC to perps account)
const BRIDGE_ABI = [
  "function sendUsd(address destination, uint64 amount) external",
];

// EIP-712 domain for HyperLiquid exchange actions
const EIP712_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: 42161,
  verifyingContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
};

const WITHDRAW_TYPES = {
  "HyperliquidTransaction:Withdraw": [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

const USD_TRANSFER_TYPES = {
  "HyperliquidTransaction:UsdSend": [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

// ── Helper: get wallet from private key ──────────────────────
function getWallet(): ethers.Wallet {
  if (!HL_WALLET_KEY) throw new Error("HL_PRIVATE_KEY not configured");
  return new ethers.Wallet(HL_WALLET_KEY);
}

function getArbitrumProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
}

// ── HyperLiquid Info API ─────────────────────────────────────
async function hlInfo(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${HL_API}/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HL info error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── HyperLiquid Exchange API (signed) ────────────────────────
async function hlExchange(action: Record<string, unknown>, wallet: ethers.Wallet): Promise<any> {
  const nonce = Date.now();
  const timestamp = nonce;

  // Build typed data for signing
  const connectionId = {
    source: "a",
    connectionId: ethers.hexlify(ethers.randomBytes(16)),
  };

  // Sign the action using EIP-712
  const phantomAgent = {
    source: action.type === "withdraw" ? "a" : "a",
    connectionId: connectionId.connectionId,
  };

  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    { "HyperliquidTransaction:Withdraw": WITHDRAW_TYPES["HyperliquidTransaction:Withdraw"] },
    action,
  );

  const payload = {
    action,
    nonce: timestamp,
    signature,
  };

  const res = await fetch(`${HL_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HL exchange error: ${res.status} ${err}`);
  }
  return res.json();
}

// ── Actions ──────────────────────────────────────────────────

/**
 * Get HyperLiquid account balance and positions
 */
async function getBalance(walletAddress: string) {
  const state = await hlInfo({
    type: "clearinghouseState",
    user: walletAddress,
  });

  const margin = state.marginSummary || state.crossMarginSummary || {};
  const positions = (state.assetPositions || [])
    .filter((ap: any) => parseFloat(ap.position.szi) !== 0)
    .map((ap: any) => ({
      coin: ap.position.coin,
      size: parseFloat(ap.position.szi),
      entryPrice: parseFloat(ap.position.entryPx),
      positionValue: parseFloat(ap.position.positionValue),
      unrealizedPnl: parseFloat(ap.position.unrealizedPnl),
      leverage: ap.position.leverage,
      liquidationPrice: ap.position.liquidationPx,
    }));

  return {
    accountValue: parseFloat(margin.accountValue || "0"),
    totalMarginUsed: parseFloat(margin.totalMarginUsed || "0"),
    totalNtlPos: parseFloat(margin.totalNtlPos || "0"),
    totalRawUsd: parseFloat(margin.totalRawUsd || "0"),
    withdrawable: parseFloat(state.withdrawable || "0"),
    positions,
  };
}

/**
 * Deposit USDC from Arbitrum wallet → HyperLiquid perps account
 * This is an L1 operation: approve + send USDC to HL bridge contract
 */
async function depositToHL(amountUsd: number) {
  const wallet = getWallet();
  const provider = getArbitrumProvider();
  const signer = wallet.connect(provider);
  const walletAddress = await wallet.getAddress();

  // Amount in USDC (6 decimals)
  const amount = BigInt(Math.round(amountUsd * 1e6));

  // 1. Check USDC balance on Arbitrum
  const usdc = new ethers.Contract(USDC_ARB_ADDRESS, ERC20_ABI, signer);
  const balance = await usdc.balanceOf(walletAddress);
  if (balance < amount) {
    throw new Error(`Insufficient USDC balance: ${ethers.formatUnits(balance, 6)} < ${amountUsd}`);
  }

  // 2. Approve bridge contract to spend USDC
  const allowance = await usdc.allowance(walletAddress, HL_BRIDGE_ADDRESS);
  if (allowance < amount) {
    const approveTx = await usdc.approve(HL_BRIDGE_ADDRESS, amount);
    await approveTx.wait();
  }

  // 3. Call bridge sendUsd to deposit into HL perps account
  const bridge = new ethers.Contract(HL_BRIDGE_ADDRESS, BRIDGE_ABI, signer);
  const depositTx = await bridge.sendUsd(walletAddress, amount);
  const receipt = await depositTx.wait();

  return {
    success: true,
    txHash: receipt.hash,
    amount: amountUsd,
    from: walletAddress,
    to: "HyperLiquid Perps Account",
  };
}

/**
 * Withdraw USDC from HyperLiquid perps account → Arbitrum wallet
 * This is an L2 exchange action: signed withdraw request
 * Note: HyperLiquid enforces a ~24h withdrawal delay for security
 */
async function withdrawFromHL(amountUsd: number, destinationAddress?: string) {
  const wallet = getWallet();
  const walletAddress = await wallet.getAddress();
  const destination = destinationAddress || walletAddress;

  // Check withdrawable balance
  const balance = await getBalance(walletAddress);
  if (balance.withdrawable < amountUsd) {
    throw new Error(`Insufficient withdrawable: ${balance.withdrawable.toFixed(2)} < ${amountUsd}`);
  }

  // Build withdraw action
  const action = {
    type: "withdraw",
    hyperliquidChain: "Arbitrum",
    destination,
    amount: amountUsd.toFixed(2),
    time: Date.now(),
  };

  // Sign and send
  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    WITHDRAW_TYPES,
    action,
  );

  const res = await fetch(`${HL_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      nonce: Date.now(),
      signature,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Withdraw failed: ${res.status} ${err}`);
  }

  const result = await res.json();

  return {
    success: true,
    amount: amountUsd,
    destination,
    status: "pending", // HL has ~24h delay
    result,
  };
}

/**
 * Internal transfer: send USDC between HL accounts (instant, no delay)
 */
async function internalTransfer(amountUsd: number, destinationAddress: string) {
  const wallet = getWallet();

  const action = {
    type: "usdSend",
    hyperliquidChain: "Arbitrum",
    destination: destinationAddress,
    amount: amountUsd.toFixed(2),
    time: Date.now(),
  };

  const signature = await wallet.signTypedData(
    EIP712_DOMAIN,
    USD_TRANSFER_TYPES,
    action,
  );

  const res = await fetch(`${HL_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      nonce: Date.now(),
      signature,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Transfer failed: ${res.status} ${err}`);
  }

  return {
    success: true,
    amount: amountUsd,
    destination: destinationAddress,
    status: "completed",
    result: await res.json(),
  };
}

// ── Serve ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check: require admin key or service_role
  const adminKey = req.headers.get("x-admin-key");
  const authHeader = req.headers.get("authorization");
  const isServiceRole = authHeader?.includes("service_role");

  if (adminKey !== TREASURY_ADMIN_KEY && !isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, amount, destination } = body;
    const wallet = getWallet();
    const walletAddress = await wallet.getAddress();

    // Supabase client for logging
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let result: any;

    switch (action) {
      case "balance": {
        result = await getBalance(walletAddress);
        break;
      }

      case "deposit": {
        if (!amount || amount <= 0) throw new Error("Amount required and must be > 0");
        result = await depositToHL(amount);

        // Log to treasury_events
        await supabase.from("treasury_events").insert({
          event_type: "HL_DEPOSIT",
          details: { amount, txHash: result.txHash, wallet: walletAddress },
        });

        // Update treasury_state
        await supabase.from("treasury_state").update({
          total_deployed: supabase.rpc("", {}), // will be updated by next balance check
          updated_at: new Date().toISOString(),
        }).eq("id", 1);

        break;
      }

      case "withdraw": {
        if (!amount || amount <= 0) throw new Error("Amount required and must be > 0");
        result = await withdrawFromHL(amount, destination);

        await supabase.from("treasury_events").insert({
          event_type: "HL_WITHDRAW",
          details: { amount, destination: destination || walletAddress, status: "pending_24h" },
        });

        break;
      }

      case "transfer": {
        if (!amount || amount <= 0) throw new Error("Amount required");
        if (!destination) throw new Error("Destination address required");
        result = await internalTransfer(amount, destination);

        await supabase.from("treasury_events").insert({
          event_type: "HL_TRANSFER",
          details: { amount, destination, status: "completed" },
        });

        break;
      }

      case "status": {
        const balance = await getBalance(walletAddress);

        // Get recent treasury events
        const { data: events } = await supabase
          .from("treasury_events")
          .select("*")
          .in("event_type", ["HL_DEPOSIT", "HL_WITHDRAW", "HL_TRANSFER"])
          .order("created_at", { ascending: false })
          .limit(20);

        // Get treasury_state
        const { data: state } = await supabase
          .from("treasury_state")
          .select("*")
          .eq("id", 1)
          .single();

        result = {
          wallet: walletAddress,
          hlAccount: balance,
          treasuryState: state,
          recentEvents: events || [],
        };

        // Update treasury_state with live data
        await supabase.from("treasury_state").update({
          total_deployed: balance.accountValue,
          available_balance: balance.withdrawable,
          total_unrealized_pnl: balance.positions.reduce((s: number, p: any) => s + p.unrealizedPnl, 0),
          active_positions: balance.positions,
          updated_at: new Date().toISOString(),
        }).eq("id", 1);

        break;
      }

      default:
        throw new Error(`Unknown action: ${action}. Use: balance, deposit, withdraw, transfer, status`);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("hl-treasury error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
