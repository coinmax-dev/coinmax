import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * FlashSwap Admin — 管理轮换钱��资金
 *
 * Actions:
 *   - balances:    查看所有钱包余额
 *   - distribute:  从 Master 分配 USDC 到轮换钱包
 *   - collect:     从轮换钱包回��� USDC 到 Master
 *   - approve:     批量授权所有钱包的 USDC 给 PancakeSwap
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "";
const ADMIN_KEY = Deno.env.get("TREASURY_ADMIN_KEY") || "";

const MASTER = "0x8A7A483f04D336E4cd60D7aE7f8fcCE72356be49";
const ROTATION = [
  "0xb5E9dFb8E1375dAB63B0bE9E8DB916bD5fc49535",
  "0x4FaE1a307B1947ab257ef3D7da9347BBc0A65b2D",
  "0xE2b4da89709348b45935597046192bDa627a47aa",
  "0x562a92Fb0b2bC8787a5C3dE4424745fEF8fCbc80",
  "0x54671ae6627F654A8718Ac7B65AF2DAb489361c4",
];
const ALL_WALLETS = [MASTER, ...ROTATION];

const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_RPC = "https://bsc-dataseed1.binance.org";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

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

async function getBalance(wallet: string): Promise<number> {
  const data = "0x70a08231000000000000000000000000" + wallet.slice(2).toLowerCase();
  const res = await fetch(BSC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: USDC, data }, "latest"] }),
  });
  return parseInt((await res.json()).result || "0x0", 16) / 1e18;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { action, amount, adminKey } = body;

    // Auth check
    const headerKey = req.headers.get("x-admin-key");
    const envKey = ADMIN_KEY;
    if (headerKey !== envKey && adminKey !== envKey) {
      console.log("Auth failed. envKey length:", envKey?.length, "headerKey:", headerKey?.slice(0,10), "bodyKey:", adminKey?.slice(0,10));
      return json({ error: "Unauthorized", debug: { envKeyLen: envKey?.length || 0 } }, 401);
    }

    switch (action) {
      case "balances": {
        const balances: Record<string, number> = {};
        let total = 0;
        for (const w of ALL_WALLETS) {
          const bal = await getBalance(w);
          const label = w === MASTER ? "Master" : "Rotation-" + (ROTATION.indexOf(w) + 1);
          balances[label] = Number(bal.toFixed(2));
          total += bal;
        }
        return json({ balances, total: Number(total.toFixed(2)) });
      }

      case "distribute": {
        // Distribute from Master to all rotation wallets equally
        const masterBal = await getBalance(MASTER);
        const perWallet = amount || Math.floor(masterBal / ROTATION.length * 0.8); // 80% split
        if (perWallet <= 0) return json({ error: "Nothing to distribute" }, 400);

        const results: string[] = [];
        for (const w of ROTATION) {
          const wei = BigInt(Math.floor(perWallet * 1e18)).toString();
          const r = await engineWrite(MASTER, {
            contractAddress: USDC,
            method: "function transfer(address to, uint256 amount) returns (bool)",
            params: [w, wei],
          });
          const txId = r?.result?.transactions?.[0]?.id || "?";
          results.push(`${w.slice(0,10)}: $${perWallet} → ${txId}`);
          await new Promise(r => setTimeout(r, 3000));
        }
        return json({ status: "distributed", perWallet, results });
      }

      case "collect": {
        // Collect from all rotation wallets back to Master
        const results: string[] = [];
        for (const w of ROTATION) {
          const bal = await getBalance(w);
          if (bal < 1) continue;
          const wei = BigInt(Math.floor(bal * 0.95 * 1e18)).toString(); // keep 5% buffer
          const r = await engineWrite(w, {
            contractAddress: USDC,
            method: "function transfer(address to, uint256 amount) returns (bool)",
            params: [MASTER, wei],
          });
          const txId = r?.result?.transactions?.[0]?.id || "?";
          results.push(`${w.slice(0,10)}: $${(bal * 0.95).toFixed(2)} → Master ${txId}`);
          await new Promise(r => setTimeout(r, 3000));
        }
        return json({ status: "collected", results });
      }

      case "approve": {
        // Approve USDC to PancakeSwap for all wallets
        const results: string[] = [];
        for (const w of ALL_WALLETS) {
          const r = await engineWrite(w, {
            contractAddress: USDC,
            method: "function approve(address spender, uint256 amount) returns (bool)",
            params: [PANCAKE_ROUTER, MAX_UINT256],
          });
          const txId = r?.result?.transactions?.[0]?.id || "?";
          results.push(`${w.slice(0,10)}: ${txId}`);
          await new Promise(r => setTimeout(r, 3000));
        }
        return json({ status: "approved", results });
      }

      default:
        return json({ error: "Unknown action. Use: balances, distribute, collect, approve" }, 400);
    }

  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
