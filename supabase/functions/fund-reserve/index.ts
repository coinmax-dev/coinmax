/**
 * Fund Reserve Manager — 5-wallet distribution + FlashSwap liquidity
 *
 * After bridge to ARB, funds distributed:
 *   Trading   30% → HL金库 (可开关) / 闪兑流动性 / 投资管理
 *   Ops       8%  → 运营钱包
 *   Marketing 12% → 市场钱包
 *   Investor  20% → 资方钱包
 *   Withdraw  30% → 提现储备钱包
 *
 * Trading 30% 里面可以再分配:
 *   - HL 金库 (USDC on ARB)
 *   - 闪兑流动性 (USDT on BSC → FlashSwap)
 *   - 留在管理钱包
 *
 * Actions:
 *   status:      查看 Server Wallet 余额 + 分配配置 + FlashSwap流动性
 *   allocate:    手动分配指定金额到指定目标 (flashswap/hl/management/自定义地址)
 *   auto:        按配置比例自动分配 Server Wallet 全部 USDT 余额
 *   add-ma:      补充 MA 到 FlashSwap 流动性 (铸造 MA)
 *   config:      查看/修改分配比例
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") || "";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";

// BSC addresses
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
const FLASH_SWAP = "0x95dfb27Fbd92A5C71C4028a4612e9Cbefdb8EE10";

// ARB distribution wallets (same as FundRouter config)
const ARB_WALLETS = {
  trading:   "0xd12097C9A12617c49220c032C84aCc99B6fFf57b",
  ops:       "0xDf90770C89732a7eba5B727fCd6a12f827102EE6",
  marketing: "0x1C4D983620B3c8c2f7607c0943f2A5989e655599",
  investor:  "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff",
  withdraw:  "0x7DEa369864583E792D230D360C0a4C56c2103FE4",
};

async function callThirdweb(chainId: number, calls: any[]) {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({ chainId, from: SERVER_WALLET, calls }),
  });
  return res.json();
}

async function getBscBalance(token: string, address: string): Promise<number> {
  const res = await fetch("https://bsc-dataseed1.binance.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "eth_call", id: 1,
      params: [{ to: token, data: "0x70a08231000000000000000000000000" + address.slice(2).toLowerCase() }, "latest"],
    }),
  });
  const d = await res.json();
  return parseInt(d.result || "0x0", 16) / 1e18;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "status": {
        const usdtBal = await getBscBalance(BSC_USDT, SERVER_WALLET);
        const maBal = await getBscBalance(BSC_MA, SERVER_WALLET);
        const fsUsdt = await getBscBalance(BSC_USDT, FLASH_SWAP);
        const fsMa = await getBscBalance(BSC_MA, FLASH_SWAP);

        const { data: configs } = await supabase.from("system_config").select("key, value")
          .like("key", "fund_%");
        const cfg: Record<string, string> = {};
        for (const c of configs || []) cfg[c.key] = c.value;

        const { data: logs } = await supabase.from("fund_reserve_logs")
          .select("*").order("created_at", { ascending: false }).limit(15);

        return json({
          serverWallet: { address: SERVER_WALLET, usdt: usdtBal, ma: maBal },
          flashSwap: { address: FLASH_SWAP, usdt: fsUsdt, ma: fsMa },
          arbWallets: ARB_WALLETS,
          config: cfg,
          recentLogs: logs || [],
        });
      }

      case "allocate": {
        const { destination, amount, token } = body;
        if (!destination || !amount || amount <= 0) return json({ error: "destination + amount required" }, 400);

        const tokenAddr = token === "MA" ? BSC_MA : BSC_USDT;
        const tokenSymbol = token === "MA" ? "MA" : "USDT";
        let destAddr: string;
        let destLabel: string;

        if (destination === "flashswap") {
          destAddr = FLASH_SWAP; destLabel = "FlashSwap";
        } else if (destination === "hl") {
          // HL deposit via edge function
          const hlRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hl-treasury`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
            body: JSON.stringify({ action: "deposit", amount }),
          });
          const hlData = await hlRes.json();
          await supabase.from("fund_reserve_logs").insert({
            action: "ALLOCATE_HL", amount, token: "USDC", destination: "HL",
            tx_id: hlData.txHash, initiated_by: "admin",
          });
          return json({ success: true, destination: "HL", amount, result: hlData });
        } else if (destination === "trading") { destAddr = ARB_WALLETS.trading; destLabel = "Trading";
        } else if (destination === "ops") { destAddr = ARB_WALLETS.ops; destLabel = "Ops";
        } else if (destination === "marketing") { destAddr = ARB_WALLETS.marketing; destLabel = "Marketing";
        } else if (destination === "investor") { destAddr = ARB_WALLETS.investor; destLabel = "Investor";
        } else if (destination === "withdraw") { destAddr = ARB_WALLETS.withdraw; destLabel = "Withdraw";
        } else { destAddr = destination; destLabel = destination.slice(0, 10); }

        const amountWei = BigInt(Math.floor(amount * 1e18)).toString();
        const result = await callThirdweb(56, [{
          contractAddress: tokenAddr,
          method: "function transfer(address to, uint256 amount) returns (bool)",
          params: [destAddr, amountWei],
        }]);
        const txId = result?.result?.transactionIds?.[0];

        await supabase.from("fund_reserve_logs").insert({
          action: `ALLOCATE_${destLabel.toUpperCase()}`, amount, token: tokenSymbol,
          destination: destLabel, tx_id: txId, initiated_by: "admin",
        });

        return json({ success: true, destination: destLabel, amount, token: tokenSymbol, txId });
      }

      case "auto": {
        const usdtBal = await getBscBalance(BSC_USDT, SERVER_WALLET);
        if (usdtBal < 10) return json({ status: "skipped", reason: `USDT $${usdtBal.toFixed(2)} < $10` });

        const { data: configs } = await supabase.from("system_config").select("key, value").like("key", "fund_%");
        const cfg: Record<string, number> = {};
        for (const c of configs || []) cfg[c.key] = parseFloat(c.value);

        const allocations = [
          { dest: "FlashSwap", addr: FLASH_SWAP, ratio: cfg.fund_liquidity_ratio || 0.30 },
          { dest: "Trading", addr: ARB_WALLETS.trading, ratio: cfg.fund_trading_ratio || 0.30 },
          { dest: "Ops", addr: ARB_WALLETS.ops, ratio: cfg.fund_ops_ratio || 0.08 },
          { dest: "Marketing", addr: ARB_WALLETS.marketing, ratio: cfg.fund_marketing_ratio || 0.12 },
          { dest: "Investor", addr: ARB_WALLETS.investor, ratio: cfg.fund_investor_ratio || 0.20 },
        ];

        // Normalize ratios
        const totalRatio = allocations.reduce((s, a) => s + a.ratio, 0);
        const results: any[] = [];

        for (const alloc of allocations) {
          const amount = usdtBal * (alloc.ratio / totalRatio);
          if (amount < 1) continue;

          const amountWei = BigInt(Math.floor(amount * 1e18)).toString();
          const r = await callThirdweb(56, [{
            contractAddress: BSC_USDT,
            method: "function transfer(address to, uint256 amount) returns (bool)",
            params: [alloc.addr, amountWei],
          }]);
          const txId = r?.result?.transactionIds?.[0];
          results.push({ dest: alloc.dest, amount: Math.round(amount * 100) / 100, txId });

          await supabase.from("fund_reserve_logs").insert({
            action: `AUTO_${alloc.dest.toUpperCase()}`, amount, token: "USDT",
            destination: alloc.dest, tx_id: txId, initiated_by: "auto",
          });
        }

        return json({ status: "allocated", total: usdtBal, allocations: results });
      }

      case "add-ma": {
        // Mint MA to FlashSwap for liquidity (Server Wallet has MINTER_ROLE)
        const { amount } = body;
        if (!amount || amount <= 0) return json({ error: "amount required" }, 400);

        const maWei = BigInt(Math.floor(amount * 1e18)).toString();
        const r = await callThirdweb(56, [{
          contractAddress: BSC_MA,
          method: "function mintTo(address to, uint256 amount)",
          params: [FLASH_SWAP, maWei],
        }]);
        const txId = r?.result?.transactionIds?.[0];

        await supabase.from("fund_reserve_logs").insert({
          action: "MINT_MA_LIQUIDITY", amount, token: "MA",
          destination: "FlashSwap", tx_id: txId, initiated_by: "admin",
        });

        return json({ success: true, amount, destination: "FlashSwap", txId });
      }

      case "config": {
        const { key, value } = body;
        if (key && value !== undefined) {
          await supabase.from("system_config").update({ value: String(value) }).eq("key", key);
          return json({ success: true, key, value });
        }
        const { data } = await supabase.from("system_config").select("key, value").like("key", "fund_%");
        return json({ config: data });
      }

      default:
        return json({ error: "Use: status, allocate, auto, add-ma, config" }, 400);
    }
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
