import type { Env, BotUser, ToolResult } from "../types";
import { getDb } from "../db";
import { shouldMaskData } from "../auth";

export async function queryUser(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const db = getDb(env);
  const walletInput = params.wallet || params.wallets || "";

  // Support multiple wallets (comma or space separated)
  const wallets = walletInput.split(/[,\s\n]+/).filter(w => w.startsWith("0x"));
  if (!wallets.length) return { text: "请提供钱包地址" };

  const results: string[] = [];
  const mask = shouldMaskData(user.role);

  for (const wallet of wallets) {
    const { data: profile } = await db
      .from("profiles")
      .select("id, wallet_address, display_name, rank, node_type, referrer_id, total_deposited, referral_earnings, created_at")
      .ilike("wallet_address", wallet.trim())
      .single();

    if (!profile) {
      results.push(`❌ <code>${wallet.slice(0, 10)}...</code> — 数据库中不存在`);
      continue;
    }

    const addr = mask ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : wallet;

    // Vault positions
    const { data: vaults } = await db
      .from("vault_positions")
      .select("principal, plan_type, daily_rate, status, start_date")
      .eq("user_id", profile.id);

    const activeVaults = (vaults || []).filter(v => v.status === "ACTIVE");
    const totalVault = activeVaults.reduce((s, v) => s + Number(v.principal), 0);

    // Node memberships
    const { data: nodes } = await db
      .from("node_memberships")
      .select("node_type, status, contribution_amount, frozen_amount, tag, tx_hash, created_at")
      .eq("user_id", profile.id);

    // Recent transactions
    const { data: txs } = await db
      .from("transactions")
      .select("type, amount, status, created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const nodeLines = (nodes || []).map(n => {
      const source = n.tx_hash ? "链上支付" : "手动创建";
      return `  ${n.node_type} | $${n.contribution_amount}+$${n.frozen_amount}冻结 | ${n.status} | ${source}${n.tag ? ` | ${n.tag}` : ""}`;
    });

    const vaultLines = activeVaults.map(v =>
      `  $${Number(v.principal).toLocaleString()} | ${v.plan_type} | ${(Number(v.daily_rate) * 100).toFixed(1)}%/天 | ${new Date(v.start_date).toLocaleDateString()}`
    );

    const txLines = (txs || []).map(t =>
      `  ${t.type} | $${Number(t.amount).toLocaleString()} | ${t.status} | ${new Date(t.created_at).toLocaleDateString()}`
    );

    results.push(`<b>📋 ${addr}</b>
等级: ${profile.rank || "无"} | 注册: ${new Date(profile.created_at).toLocaleDateString()}

<b>💰 金库</b> (${activeVaults.length}个活跃, 总计$${totalVault.toLocaleString()})
${vaultLines.length ? vaultLines.join("\n") : "  无活跃仓位"}
累计存入: $${Number(profile.total_deposited || 0).toLocaleString()}

<b>🖥 节点</b> (${nodes?.length || 0}个)
${nodeLines.length ? nodeLines.join("\n") : "  无节点"}

<b>📝 最近交易</b>
${txLines.length ? txLines.join("\n") : "  无"}${!mask ? `\n\n推荐收益: $${Number(profile.referral_earnings || 0).toFixed(2)}` : ""}`);
  }

  return { text: results.join("\n\n━━━━━━━━━━━━━━\n\n"), data: { count: wallets.length } };
}

export async function queryVault(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const db = getDb(env);

  if (params.summary === "true" || !params.wallet) {
    // Full vault summary with breakdown
    const { data: allPos } = await db
      .from("vault_positions")
      .select("principal, plan_type, status, is_bonus, bonus_yield_locked")
      .eq("status", "ACTIVE");

    const positions = allPos || [];
    const realDeposits = positions.filter(p => !p.is_bonus);
    const bonusDeposits = positions.filter(p => p.is_bonus);
    const totalReal = realDeposits.reduce((s, v) => s + Number(v.principal), 0);
    const totalBonus = bonusDeposits.reduce((s, v) => s + Number(v.principal), 0);

    // By plan type
    const byPlan: Record<string, { count: number; total: number }> = {};
    for (const p of realDeposits) {
      if (!byPlan[p.plan_type]) byPlan[p.plan_type] = { count: 0, total: 0 };
      byPlan[p.plan_type].count++;
      byPlan[p.plan_type].total += Number(p.principal);
    }

    // Recent deposits with wallet info
    const { data: recent } = await db
      .from("transactions")
      .select("amount, created_at, user_id")
      .eq("type", "VAULT_DEPOSIT")
      .order("created_at", { ascending: false })
      .limit(10);

    // Enrich with wallets
    const userIds = [...new Set((recent || []).map(r => r.user_id))];
    const { data: profiles } = await db.from("profiles").select("id, wallet_address").in("id", userIds);
    const walletMap: Record<string, string> = {};
    for (const p of profiles || []) walletMap[p.id] = p.wallet_address;

    const recentLines = (recent || []).map(r => {
      const w = walletMap[r.user_id];
      return `  $${Number(r.amount).toLocaleString()} | ${w ? w.slice(0, 8) + "..." : "?"} | ${new Date(r.created_at).toLocaleString()}`;
    });

    const planLines = Object.entries(byPlan).map(([k, v]) =>
      `  ${k}: ${v.count}个, $${v.total.toLocaleString()}`
    );

    return {
      text: `<b>金库总览</b>
真实存入: ${realDeposits.length}个仓位, $${totalReal.toLocaleString()}
赠送仓位: ${bonusDeposits.length}个, $${totalBonus.toLocaleString()}
锁仓中(bonus未解锁): ${bonusDeposits.filter(b => b.bonus_yield_locked).length}个

<b>按方案</b>
${planLines.join("\n")}

<b>最近10笔入金</b>
${recentLines.join("\n")}`,
    };
  }

  // Specific user vault
  const { data: profile } = await db.from("profiles").select("id, total_deposited").ilike("wallet_address", params.wallet).single();
  if (!profile) return { text: `未找到 ${params.wallet}` };

  const { data: positions } = await db
    .from("vault_positions")
    .select("principal, plan_type, daily_rate, status, start_date, end_date, is_bonus, bonus_yield_locked, created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  const { data: deposits } = await db
    .from("transactions")
    .select("amount, tx_hash, status, created_at")
    .eq("user_id", profile.id)
    .eq("type", "VAULT_DEPOSIT")
    .order("created_at", { ascending: false });

  const posLines = (positions || []).map(p => {
    const bonus = p.is_bonus ? " [赠送]" : "";
    const locked = p.bonus_yield_locked ? " [收益锁定]" : "";
    return `  $${Number(p.principal).toLocaleString()} | ${p.plan_type} | ${(Number(p.daily_rate)*100).toFixed(1)}%/天 | ${p.status}${bonus}${locked}\n    开始: ${new Date(p.start_date).toLocaleDateString()} → 结束: ${p.end_date ? new Date(p.end_date).toLocaleDateString() : "-"}`;
  });

  const depLines = (deposits || []).map(d =>
    `  $${Number(d.amount).toLocaleString()} | ${d.status} | ${d.tx_hash ? d.tx_hash.slice(0, 14) + "..." : "无hash"} | ${new Date(d.created_at).toLocaleString()}`
  );

  return {
    text: `<b>${params.wallet.slice(0, 10)}... 金库详情</b>
累计存入: $${Number(profile.total_deposited || 0).toLocaleString()}

<b>活跃仓位 (${positions?.length || 0})</b>
${posLines.join("\n") || "  无"}

<b>入金记录 (${deposits?.length || 0})</b>
${depLines.join("\n") || "  无"}`,
  };
}

export async function queryNode(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const db = getDb(env);

  if (params.summary === "true" || !params.wallet) {
    // Full node summary with activation breakdown
    const { data: allNodes } = await db.from("node_memberships")
      .select("node_type, status, activated_rank, activated_at, tx_hash, tag, earnings_paused");

    const nodes = allNodes || [];
    const maxNodes = nodes.filter(n => n.node_type === "MAX");
    const miniNodes = nodes.filter(n => n.node_type === "MINI");
    const manual = nodes.filter(n => !n.tx_hash);
    const onchain = nodes.filter(n => n.tx_hash);
    const activated = nodes.filter(n => n.activated_rank);
    const notActivated = nodes.filter(n => !n.activated_rank);

    // Activation rank breakdown
    const rankCounts: Record<string, number> = {};
    for (const n of activated) {
      const r = n.activated_rank || "无";
      rankCounts[r] = (rankCounts[r] || 0) + 1;
    }

    return {
      text: `<b>节点总览</b>
MAX: ${maxNodes.length} | MINI: ${miniNodes.length} | 总计: ${nodes.length}
链上支付: ${onchain.length} | 手动创建: ${manual.length}

<b>激活状态</b>
已激活: ${activated.length} (${(activated.length/nodes.length*100).toFixed(0)}%)
未激活: ${notActivated.length}
收益暂停: ${nodes.filter(n => n.earnings_paused).length}

<b>激活等级分布</b>
${Object.entries(rankCounts).sort((a,b) => b[1]-a[1]).map(([r, c]) => `  ${r}: ${c}个`).join("\n") || "  无"}`,
    };
  }

  // Specific user node with full activation details
  const { data: profile } = await db.from("profiles")
    .select("id, node_type, rank")
    .ilike("wallet_address", params.wallet).single();
  if (!profile) return { text: `未找到 ${params.wallet}` };

  const { data: nodes } = await db.from("node_memberships")
    .select("node_type, status, contribution_amount, frozen_amount, daily_rate, activated_rank, activated_at, earnings_paused, earnings_capacity, milestone_stage, total_milestones, locked_earnings, released_earnings, available_balance, tx_hash, tag, start_date, end_date, created_at")
    .eq("user_id", profile.id);

  // Get team stats for activation context
  const { data: teamStats } = await db.rpc("get_user_team_stats", { addr: params.wallet });

  const nodeLines = (nodes || []).map(n => {
    const source = n.tx_hash ? "链上支付" : "手动创建";
    const activation = n.activated_rank
      ? `✅ 已激活 (${n.activated_rank}, ${new Date(n.activated_at).toLocaleDateString()})`
      : "❌ 未激活";
    const earnings = n.earnings_paused ? "⏸ 收益暂停" : `💰 容量${(Number(n.earnings_capacity)*100).toFixed(0)}%`;

    return `<b>${n.node_type}</b> | ${n.status} | ${source}${n.tag ? ` | ${n.tag}` : ""}
  贡献: $${n.contribution_amount} | 冻结: $${n.frozen_amount} | 日率: ${(Number(n.daily_rate)*100).toFixed(1)}%
  激活: ${activation}
  ${earnings} | 里程碑: ${n.milestone_stage}/${n.total_milestones}
  锁定收益: $${Number(n.locked_earnings).toFixed(2)} | 已释放: $${Number(n.released_earnings).toFixed(2)} | 可用: $${Number(n.available_balance).toFixed(2)}
  期限: ${new Date(n.start_date).toLocaleDateString()} → ${n.end_date ? new Date(n.end_date).toLocaleDateString() : "-"}`;
  });

  const ts = teamStats as Record<string, unknown> | null;

  return {
    text: `<b>${params.wallet.slice(0, 10)}... 节点详情</b>
Profile 等级: ${profile.rank || "无"} | 节点类型: ${profile.node_type || "无"}

${nodeLines.join("\n\n") || "无节点"}

<b>团队数据</b>
团队人数: ${ts?.teamSize || 0}
团队业绩: $${ts?.teamPerformance || "0"}
个人持仓: $${ts?.personalHolding || "0"}
直推MAX: ${ts?.directMaxNodes || 0} | 直推MINI: ${ts?.directMiniNodes || 0}`,
  };
}

export async function queryTransaction(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const db = getDb(env);
  const limit = parseInt(params.limit || "10");

  let query = db.from("transactions").select("amount, type, status, tx_hash, created_at, user_id").order("created_at", { ascending: false }).limit(limit);

  if (params.type) query = query.eq("type", params.type);
  if (params.wallet) {
    const { data: profile } = await db.from("profiles").select("id").ilike("wallet_address", params.wallet).single();
    if (profile) query = query.eq("user_id", profile.id);
  }

  const { data } = await query;
  const lines = (data || []).map(t =>
    `  ${t.type} | $${Number(t.amount).toLocaleString()} | ${t.status} | ${new Date(t.created_at).toLocaleString().slice(0, 16)}`
  );

  return { text: `<b>交易记录 (${data?.length || 0})</b>\n${lines.join("\n") || "无"}` };
}
