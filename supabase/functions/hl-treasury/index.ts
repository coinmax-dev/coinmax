/**
 * HyperLiquid Treasury Edge Function (thirdweb Server Wallet)
 *
 * Uses thirdweb server wallet for all signing — no raw private key needed.
 * Server wallet: 0x60D416dA873508c23C1315a2b750a31201959d78
 *
 * Actions:
 *   - balance:  Query HL perps account (balances + positions)
 *   - deposit:  Arbitrum USDC → HL bridge → perps account
 *   - withdraw: HL perps → Arbitrum wallet (24h delay)
 *   - transfer: HL internal transfer (instant)
 *   - status:   Full treasury snapshot
 *
 * HyperLiquid API: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

// ── Config ───────────────────────────────────────────────────
const HL_API = "https://api.hyperliquid.xyz";
const TREASURY_ADMIN_KEY = Deno.env.get("TREASURY_ADMIN_KEY") || "";

// thirdweb server wallet
const TW_SECRET_KEY = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const SERVER_WALLET = Deno.env.get("THIRDWEB_SERVER_WALLET") || "0x60D416dA873508c23C1315a2b750a31201959d78";

// Contracts on Arbitrum
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const HL_BRIDGE = "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7";
const ARB_CHAIN_ID = 42161;

// ── thirdweb Engine: sign typed data via server wallet ───────

async function twSignTypedData(
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  value: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(
    `https://engine.thirdweb.com/backend-wallet/${SERVER_WALLET}/sign-typed-data`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": TW_SECRET_KEY,
      },
      body: JSON.stringify({ domain, types, value }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`thirdweb sign-typed-data failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.result;
}

// ── thirdweb Engine: send transaction via server wallet ──────

async function twSendTransaction(
  toAddress: string,
  data: string,
  value: string = "0",
): Promise<{ txHash: string }> {
  const res = await fetch(
    `https://engine.thirdweb.com/backend-wallet/${SERVER_WALLET}/send-transaction`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": TW_SECRET_KEY,
        "x-chain-id": String(ARB_CHAIN_ID),
      },
      body: JSON.stringify({
        toAddress,
        data,
        value,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`thirdweb send-transaction failed: ${res.status} ${err}`);
  }

  const result = await res.json();
  // Engine returns a queue ID, poll for tx hash
  const queueId = result.result?.queueId;
  if (queueId) {
    return await pollTransactionStatus(queueId);
  }
  return { txHash: result.result?.transactionHash || "" };
}

async function pollTransactionStatus(queueId: string): Promise<{ txHash: string }> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(
      `https://engine.thirdweb.com/transaction/status/${queueId}`,
      {
        headers: { "x-secret-key": TW_SECRET_KEY },
      },
    );
    if (!res.ok) continue;
    const data = await res.json();
    const status = data.result?.status;
    if (status === "mined") {
      return { txHash: data.result.transactionHash };
    }
    if (status === "errored" || status === "cancelled") {
      throw new Error(`Transaction ${status}: ${data.result?.errorMessage || "unknown"}`);
    }
  }
  throw new Error("Transaction polling timeout");
}

// ── thirdweb Engine: read contract ───────────────────────────

async function twReadContract(
  contractAddress: string,
  functionName: string,
  args: string[],
): Promise<string> {
  const params = new URLSearchParams({
    functionName,
    args: JSON.stringify(args),
  });
  const res = await fetch(
    `https://engine.thirdweb.com/contract/${ARB_CHAIN_ID}/${contractAddress}/read?${params}`,
    {
      headers: { "x-secret-key": TW_SECRET_KEY },
    },
  );
  if (!res.ok) throw new Error(`Read contract failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

// ── thirdweb Engine: write contract ──────────────────────────

async function twWriteContract(
  contractAddress: string,
  functionName: string,
  args: unknown[],
): Promise<{ txHash: string }> {
  const res = await fetch(
    `https://engine.thirdweb.com/contract/${ARB_CHAIN_ID}/${contractAddress}/write`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": TW_SECRET_KEY,
        "x-backend-wallet-address": SERVER_WALLET,
      },
      body: JSON.stringify({
        functionName,
        args,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Write contract failed: ${res.status} ${err}`);
  }

  const result = await res.json();
  const queueId = result.result?.queueId;
  if (queueId) {
    return await pollTransactionStatus(queueId);
  }
  return { txHash: result.result?.transactionHash || "" };
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

// ── EIP-712 Domain & Types for HyperLiquid ───────────────────

const HL_EIP712_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: 42161,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

const WITHDRAW_TYPES = {
  "HyperliquidTransaction:Withdraw": [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

const USD_SEND_TYPES = {
  "HyperliquidTransaction:UsdSend": [
    { name: "hyperliquidChain", type: "string" },
    { name: "destination", type: "string" },
    { name: "amount", type: "string" },
    { name: "time", type: "uint64" },
  ],
};

// ── Actions ──────────────────────────────────────────────────

async function getBalance(walletAddress: string) {
  const state = await hlInfo({ type: "clearinghouseState", user: walletAddress });

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
 * Deposit USDC from server wallet (Arbitrum) → HyperLiquid perps
 * Uses thirdweb Engine to send transactions from server wallet
 */
async function depositToHL(amountUsd: number) {
  const amountRaw = String(Math.round(amountUsd * 1e6)); // USDC 6 decimals

  // 1. Check USDC balance
  const balance = await twReadContract(USDC_ARB, "balanceOf", [SERVER_WALLET]);
  const balanceNum = Number(balance) / 1e6;
  if (balanceNum < amountUsd) {
    throw new Error(`Insufficient USDC: ${balanceNum.toFixed(2)} < ${amountUsd}`);
  }

  // 2. Approve HL bridge
  const allowance = await twReadContract(USDC_ARB, "allowance", [SERVER_WALLET, HL_BRIDGE]);
  if (Number(allowance) < Number(amountRaw)) {
    await twWriteContract(USDC_ARB, "approve", [HL_BRIDGE, amountRaw]);
  }

  // 3. Bridge deposit: sendUsd(destination, amount)
  const depositResult = await twWriteContract(HL_BRIDGE, "sendUsd", [SERVER_WALLET, amountRaw]);

  return {
    success: true,
    txHash: depositResult.txHash,
    amount: amountUsd,
    from: SERVER_WALLET,
    to: "HyperLiquid Perps Account",
  };
}

/**
 * Withdraw USDC from HyperLiquid perps → Arbitrum wallet
 * Signs EIP-712 typed data via thirdweb server wallet
 * Note: 24h withdrawal delay enforced by HyperLiquid
 */
async function withdrawFromHL(amountUsd: number, destination?: string) {
  const dest = destination || SERVER_WALLET;

  // Check withdrawable
  const bal = await getBalance(SERVER_WALLET);
  if (bal.withdrawable < amountUsd) {
    throw new Error(`Insufficient withdrawable: ${bal.withdrawable.toFixed(2)} < ${amountUsd}`);
  }

  const timestamp = Date.now();
  const action = {
    type: "withdraw3",
    hyperliquidChain: "Arbitrum",
    signatureChainId: "0xa4b1",
    destination: dest,
    amount: amountUsd.toFixed(2),
    time: timestamp,
  };

  // Sign via thirdweb server wallet
  const signature = await twSignTypedData(
    HL_EIP712_DOMAIN,
    WITHDRAW_TYPES,
    {
      hyperliquidChain: "Arbitrum",
      destination: dest,
      amount: amountUsd.toFixed(2),
      time: timestamp,
    },
  );

  const res = await fetch(`${HL_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce: timestamp, signature }),
  });

  if (!res.ok) {
    throw new Error(`HL withdraw failed: ${res.status} ${await res.text()}`);
  }

  return {
    success: true,
    amount: amountUsd,
    destination: dest,
    status: "pending_24h",
    result: await res.json(),
  };
}

/**
 * Internal HL transfer (instant, no delay)
 */
async function internalTransfer(amountUsd: number, destination: string) {
  const timestamp = Date.now();

  const action = {
    type: "usdSend",
    hyperliquidChain: "Arbitrum",
    signatureChainId: "0xa4b1",
    destination,
    amount: amountUsd.toFixed(2),
    time: timestamp,
  };

  const signature = await twSignTypedData(
    HL_EIP712_DOMAIN,
    USD_SEND_TYPES,
    {
      hyperliquidChain: "Arbitrum",
      destination,
      amount: amountUsd.toFixed(2),
      time: timestamp,
    },
  );

  const res = await fetch(`${HL_API}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, nonce: timestamp, signature }),
  });

  if (!res.ok) {
    throw new Error(`HL transfer failed: ${res.status} ${await res.text()}`);
  }

  return {
    success: true,
    amount: amountUsd,
    destination,
    status: "completed",
    result: await res.json(),
  };
}

// ── Serve ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let result: any;

    switch (action) {
      case "balance": {
        result = await getBalance(SERVER_WALLET);
        break;
      }

      case "deposit": {
        if (!amount || amount <= 0) throw new Error("Amount required and must be > 0");
        result = await depositToHL(amount);

        await supabase.from("treasury_events").insert({
          event_type: "HL_DEPOSIT",
          details: { amount, txHash: result.txHash, wallet: SERVER_WALLET },
        });
        break;
      }

      case "withdraw": {
        if (!amount || amount <= 0) throw new Error("Amount required and must be > 0");
        result = await withdrawFromHL(amount, destination);

        await supabase.from("treasury_events").insert({
          event_type: "HL_WITHDRAW",
          details: { amount, destination: destination || SERVER_WALLET, status: "pending_24h" },
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
        const balance = await getBalance(SERVER_WALLET);

        const { data: events } = await supabase
          .from("treasury_events")
          .select("*")
          .in("event_type", ["HL_DEPOSIT", "HL_WITHDRAW", "HL_TRANSFER"])
          .order("created_at", { ascending: false })
          .limit(20);

        const { data: state } = await supabase
          .from("treasury_state")
          .select("*")
          .eq("id", 1)
          .single();

        result = {
          wallet: SERVER_WALLET,
          hlAccount: balance,
          treasuryState: state,
          recentEvents: events || [],
        };

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
