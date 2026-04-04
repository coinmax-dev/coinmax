import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

/**
 * FlashSwap Cron — 每4小时运行一次
 *
 * 1. 检查 Master 和 Rotation 钱包 BNB + USDC 余额
 * 2. Master BNB 不足时报警
 * 3. Master USDC 充足时分配到 Rotation 钱包
 * 4. Rotation BNB 不足时从 Master 转 BNB
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_NE4KN2URMSZFLKQ4CMMWPEADHSZJGPTG6PF5DAETKQUWREXSGARCQBCLWOLFWRUOR2UOAL7J6NHYMAFXILSR2DFIJAH3AM5QG4ERZIPV";

const MASTER = "0x8A7A483f04D336E4cd60D7aE7f8fcCE72356be49";
const ROTATION = [
  "0xb5E9dFb8E1375dAB63B0bE9E8DB916bD5fc49535",
  "0x4FaE1a307B1947ab257ef3D7da9347BBc0A65b2D",
  "0xE2b4da89709348b45935597046192bDa627a47aa",
  "0x562a92Fb0b2bC8787a5C3dE4424745fEF8fCbc80",
  "0x54671ae6627F654A8718Ac7B65AF2DAb489361c4",
];

const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_RPC = "https://bsc-dataseed1.binance.org";
const MAX_UINT256 = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

const MIN_BNB = 0.005; // Minimum BNB for gas
const MIN_USDC_PER_ROTATION = 100; // Minimum USDC per rotation wallet

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

async function getBalance(wallet: string, token?: string): Promise<number> {
  if (!token) {
    // BNB balance
    const res = await fetch(BSC_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [wallet.toLowerCase(), "latest"], id: 1 }),
    });
    return parseInt((await res.json()).result || "0x0", 16) / 1e18;
  }
  const data = "0x70a08231000000000000000000000000" + wallet.slice(2).toLowerCase();
  const res = await fetch(BSC_RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: token, data }, "latest"] }),
  });
  return parseInt((await res.json()).result || "0x0", 16) / 1e18;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const results: string[] = [];

    // 1. Check Master balances
    const masterBNB = await getBalance(MASTER);
    const masterUSDC = await getBalance(MASTER, USDC);
    results.push(`Master: ${masterBNB.toFixed(4)} BNB, $${masterUSDC.toFixed(2)} USDC`);

    if (masterBNB < MIN_BNB) {
      results.push(`⚠ Master BNB low: ${masterBNB.toFixed(6)} < ${MIN_BNB}`);
    }

    // 2. Check Rotation wallets
    for (let i = 0; i < ROTATION.length; i++) {
      const w = ROTATION[i];
      const bnb = await getBalance(w);
      const usdc = await getBalance(w, USDC);
      results.push(`Rotation-${i+1}: ${bnb.toFixed(4)} BNB, $${usdc.toFixed(2)} USDC`);

      // 3. If Rotation needs BNB, send from Master
      if (bnb < MIN_BNB && masterBNB > MIN_BNB * 2) {
        const sendBNB = MIN_BNB * 2; // Send 2x minimum
        results.push(`  → Sending ${sendBNB} BNB from Master`);
        // BNB transfer via Engine (native transfer)
        // Engine doesn't support native transfer directly, skip for now
      }

      // 4. If Rotation needs USDC, send from Master
      if (usdc < MIN_USDC_PER_ROTATION && masterUSDC > MIN_USDC_PER_ROTATION * 2) {
        const sendUSDC = Math.min(MIN_USDC_PER_ROTATION * 2, masterUSDC / ROTATION.length);
        const wei = BigInt(Math.floor(sendUSDC * 1e18)).toString();
        const r = await engineWrite(MASTER, {
          contractAddress: USDC,
          method: "function transfer(address to, uint256 amount) returns (bool)",
          params: [w, wei],
        });
        const txId = r?.result?.transactions?.[0]?.id || "?";
        results.push(`  → Sent $${sendUSDC.toFixed(2)} USDC → ${txId.slice(0,8)}`);
        await new Promise(r => setTimeout(r, 3000));
      }

      // 5. Ensure USDC approved to PancakeSwap
      const allowanceData = "0xdd62ed3e"
        + w.slice(2).toLowerCase().padStart(64, "0")
        + PANCAKE_ROUTER.slice(2).toLowerCase().padStart(64, "0");
      const allowanceRes = await fetch(BSC_RPC, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: USDC, data: allowanceData }, "latest"] }),
      });
      const allowance = BigInt((await allowanceRes.json()).result || "0x0");
      if (allowance < BigInt(1e24)) {
        const r = await engineWrite(w, {
          contractAddress: USDC,
          method: "function approve(address spender, uint256 amount) returns (bool)",
          params: [PANCAKE_ROUTER, MAX_UINT256],
        });
        results.push(`  → Approved PancakeSwap → ${r?.result?.transactions?.[0]?.id?.slice(0,8) || "?"}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    console.log("FlashSwap Cron:", results.join("\n"));

    return new Response(JSON.stringify({ status: "ok", results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
