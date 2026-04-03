import type { Env, BotUser, ToolResult } from "../types";
import { getDb } from "../db";

export async function diagnose(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const check = params.check || "all";
  const parts: string[] = [];

  if (check === "funds" || check === "all") {
    parts.push(await checkFunds());
  }
  if (check === "crons" || check === "all") {
    parts.push(await checkCrons(env));
  }
  if (check === "health" || check === "all") {
    parts.push(await checkHealth(env));
  }

  return { text: parts.join("\n\n") };
}

async function checkFunds(): Promise<string> {
  const balances: Record<string, string> = {};
  const addrs: [string, string, number][] = [
    ["Server Wallet", "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff", 18],
    ["BatchBridge", "0xAa80a499B8738E3Fd7779057F7E3a7D73c045c4D", 18],
    ["Node Wallet", "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9", 18],
  ];
  const USDT = "0x55d398326f99059fF775485246999027B3197955";

  for (const [name, addr, dec] of addrs) {
    try {
      const res = await fetch("https://bsc-dataseed1.binance.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", method: "eth_call", id: 1,
          params: [{ to: USDT, data: `0x70a08231000000000000000000000000${addr.slice(2).toLowerCase()}` }, "latest"],
        }),
      });
      const d: any = await res.json();
      const val = parseInt(d.result || "0x0", 16) / (10 ** dec);
      balances[name] = `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    } catch {
      balances[name] = "读取失败";
    }
  }

  // ARB FundRouter USDC
  try {
    const res = await fetch("https://arb1.arbitrum.io/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{ to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", data: "0x70a0823100000000000000000000000071237E535d5E00CDf18A609eA003525baEae3489" }, "latest"],
      }),
    });
    const d: any = await res.json();
    balances["ARB Router"] = `$${(parseInt(d.result || "0x0", 16) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  } catch {
    balances["ARB Router"] = "读取失败";
  }

  return `<b>💰 资金状态 (BSC USDT)</b>\n` +
    Object.entries(balances).map(([k, v]) => `  ${k}: ${v}`).join("\n");
}

async function checkCrons(env: Env): Promise<string> {
  const db = getDb(env);
  let data: any = null;
  try {
    const r = await db.rpc("sql", {
      query: `SELECT j.jobname, j.schedule,
              (SELECT status FROM cron.job_run_details jrd WHERE jrd.jobid = j.jobid ORDER BY start_time DESC LIMIT 1) as last_status
              FROM cron.job j ORDER BY j.jobname`,
    });
    data = r.data;
  } catch { /* pg_cron may not be accessible */ }

  if (!data) {
    // Fallback: query bridge_cycles
    const { data: cycles } = await db
      .from("bridge_cycles")
      .select("status, amount_usd, started_at")
      .order("started_at", { ascending: false })
      .limit(3);

    return `<b>⏰ Cron 状态</b>\n  (无法直接查询 cron.job)\n\n最近 bridge_cycles:\n` +
      (cycles || []).map(c => `  ${c.status} | $${Number(c.amount_usd).toFixed(0)} | ${new Date(c.started_at).toLocaleString()}`).join("\n");
  }

  return `<b>⏰ Cron 任务</b>\n` +
    (data as any[]).map(j => `  ${j.last_status === "succeeded" ? "✅" : "❌"} ${j.jobname} (${j.schedule})`).join("\n");
}

async function checkHealth(env: Env): Promise<string> {
  const db = getDb(env);

  // DB health
  const { count: userCount } = await db.from("profiles").select("*", { count: "exact", head: true });
  const { count: vaultCount } = await db.from("vault_positions").select("*", { count: "exact", head: true }).eq("status", "ACTIVE");
  const { count: nodeCount } = await db.from("node_memberships").select("*", { count: "exact", head: true });

  // Recent deposits (last 24h)
  const { count: recentDeposits } = await db.from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("type", "VAULT_DEPOSIT")
    .gte("created_at", new Date(Date.now() - 86400000).toISOString());

  return `<b>🏥 系统健康</b>
  用户总数: ${userCount || 0}
  活跃金库: ${vaultCount || 0}
  节点总数: ${nodeCount || 0}
  24h 存入: ${recentDeposits || 0} 笔`;
}
