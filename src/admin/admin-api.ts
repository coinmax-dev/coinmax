import { supabase } from "@/lib/supabase";

// Convert snake_case DB rows to camelCase for frontend
function toCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (typeof obj !== "object") return obj;
  const out: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camelKey] = toCamel(obj[key]);
  }
  return out;
}

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────

export async function adminLogin(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; role?: string }> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, username, password, is_active, role")
    .eq("username", username)
    .single();

  if (error || !data) {
    return { success: false, error: "Invalid username or password" };
  }

  if (!data.is_active) {
    return { success: false, error: "Account disabled" };
  }

  if (password !== data.password) {
    return { success: false, error: "Invalid username or password" };
  }

  return { success: true, role: data.role || "support" };
}

// ─────────────────────────────────────────────
// Operation Logs
// ─────────────────────────────────────────────

export async function adminAddLog(
  adminUsername: string,
  adminRole: string,
  action: string,
  targetType: string,
  targetId?: string,
  details?: Record<string, any>
) {
  await supabase.from("operation_logs").insert({
    admin_username: adminUsername,
    admin_role: adminRole,
    action,
    target_type: targetType,
    target_id: targetId || null,
    details: details || {},
  });
}

export async function adminGetLogs(page: number, pageSize: number, actionFilter?: string) {
  let query = supabase
    .from("operation_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (actionFilter) {
    query = query.eq("action", actionFilter);
  }

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw error;
  return { data: data ?? [], total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Contract Configs
// ─────────────────────────────────────────────

export async function adminGetContractConfigs() {
  const { data, error } = await supabase
    .from("contract_configs")
    .select("*")
    .order("key");
  if (error) throw error;
  return data ?? [];
}

export async function adminUpdateContractConfig(key: string, value: string, adminUsername: string) {
  const { error } = await supabase
    .from("contract_configs")
    .update({ value, updated_by: adminUsername, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// Profiles
// ─────────────────────────────────────────────

export async function adminGetProfiles(
  page: number,
  pageSize: number,
  search?: string
) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(
      `wallet_address.ilike.%${search}%,ref_code.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const profiles = data ?? [];

  // Fetch team count for each profile (non-blocking)
  const profileIds = profiles.map((p: any) => p.id);
  let teamCountMap: Record<string, number> = {};
  if (profileIds.length > 0) {
    try {
      const { data: counts, error: rpcErr } = await supabase
        .rpc("get_team_counts", { profile_ids: profileIds });
      if (!rpcErr && counts) {
        for (const c of counts) {
          teamCountMap[c.profile_id] = c.team_count;
        }
      }
    } catch {
      // Don't let team count failure break profiles list
    }
  }

  const enriched = profiles.map((p: any) => ({
    ...toCamel(p),
    teamCount: teamCountMap[p.id] ?? 0,
  }));

  return { data: enriched, total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Referrals
// ─────────────────────────────────────────────

export async function adminGetReferralPairs(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Get profiles that have a referrer_id
  const { data, error, count } = await supabase
    .from("profiles")
    .select("*", { count: "exact" })
    .not("referrer_id", "is", null)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const profiles = data ?? [];

  // Collect unique referrer IDs and fetch their wallets
  const referrerIds = Array.from(
    new Set(profiles.map((p: any) => p.referrer_id).filter(Boolean))
  );

  let referrerMap: Record<string, string> = {};
  if (referrerIds.length > 0) {
    const { data: referrers } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .in("id", referrerIds);
    if (referrers) {
      for (const r of referrers) {
        referrerMap[r.id] = r.wallet_address;
      }
    }
  }

  // Fetch team count for each profile (non-blocking)
  const profileIds = profiles.map((p: any) => p.id);
  let teamCountMap: Record<string, number> = {};
  if (profileIds.length > 0) {
    try {
      const { data: counts, error: rpcErr } = await supabase
        .rpc("get_team_counts", { profile_ids: profileIds });
      if (!rpcErr && counts) {
        for (const c of counts) {
          teamCountMap[c.profile_id] = c.team_count;
        }
      }
    } catch {
      // Don't let team count failure break referral list
    }
  }

  const enriched = profiles.map((p: any) => ({
    ...toCamel(p),
    referrerWallet: referrerMap[p.referrer_id] ?? null,
    teamCount: teamCountMap[p.id] ?? 0,
  }));

  return { data: enriched, total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Referral Tree (recursive)
// ─────────────────────────────────────────────

export interface ReferralNode {
  id: string;
  walletAddress: string;
  rank: string;
  nodeType: string | null;
  refCode: string;
  createdAt: string;
  childCount: number;
  children: ReferralNode[];
}

// Fetch root + first 2 levels (shallow load for speed)
export async function adminGetReferralTree(walletAddress: string): Promise<ReferralNode | null> {
  const { data: root, error } = await supabase
    .from("profiles")
    .select("id, wallet_address, rank, node_type, ref_code, created_at")
    .eq("wallet_address", walletAddress)
    .single();
  if (error || !root) return null;

  const children = await fetchChildrenShallow(root.id, 0, 2);
  return {
    id: root.id,
    walletAddress: root.wallet_address,
    rank: root.rank,
    nodeType: root.node_type,
    refCode: root.ref_code,
    createdAt: root.created_at,
    childCount: children.length,
    children,
  };
}

// Fetch children of a specific node (for lazy expand)
export async function adminGetChildren(parentId: string): Promise<ReferralNode[]> {
  return fetchChildrenShallow(parentId, 0, 1);
}

// Shared: fetch children up to `maxDepth` levels from current
async function fetchChildrenShallow(parentId: string, depth: number, maxDepth: number): Promise<ReferralNode[]> {
  const { data } = await supabase
    .from("profiles")
    .select("id, wallet_address, rank, node_type, ref_code, created_at")
    .eq("placement_id", parentId)
    .order("created_at", { ascending: true });
  if (!data?.length) return [];

  const nodes: ReferralNode[] = [];
  for (const row of data) {
    // Count grandchildren for the expand indicator
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("placement_id", row.id);

    const childCount = count ?? 0;
    let children: ReferralNode[] = [];
    if (depth < maxDepth && childCount > 0) {
      children = await fetchChildrenShallow(row.id, depth + 1, maxDepth);
    }

    nodes.push({
      id: row.id,
      walletAddress: row.wallet_address,
      rank: row.rank,
      nodeType: row.node_type,
      refCode: row.ref_code,
      createdAt: row.created_at,
      childCount,
      children,
    });
  }
  return nodes;
}

// Get user team stats (team size + vault performance)
export async function adminGetUserTeamStats(userId: string) {
  const { data, error } = await supabase.rpc("get_user_team_stats", { user_id_param: userId });
  if (error) throw error;
  return data as { teamSize: number; teamPerformance: string; personalHolding: string; directCount: number; ownNode: string; directMaxNodes: number; directMiniNodes: number; totalTeamNodes: number };
}

// ─────────────────────────────────────────────
// Vault Positions
// ─────────────────────────────────────────────

export async function adminGetVaultPositions(
  page: number,
  pageSize: number,
  status?: string
) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("vault_positions")
    .select("*", { count: "exact" })
    .order("start_date", { ascending: false })
    .range(from, to);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const positions = data ?? [];

  // Enrich with user wallet addresses
  const userIds = Array.from(
    new Set(positions.map((p: any) => p.user_id).filter(Boolean))
  );

  let userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .in("id", userIds);
    if (users) {
      for (const u of users) {
        userMap[u.id] = u.wallet_address;
      }
    }
  }

  const enriched = positions.map((p: any) => ({
    ...toCamel(p),
    userWallet: userMap[p.user_id] ?? null,
  }));

  return { data: enriched, total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Node Memberships
// ─────────────────────────────────────────────

export async function adminGetNodeMemberships(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("node_memberships")
    .select("*", { count: "exact" })
    .order("start_date", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const memberships = data ?? [];

  // Enrich with user wallet addresses
  const userIds = Array.from(
    new Set(memberships.map((m: any) => m.user_id).filter(Boolean))
  );

  let userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .in("id", userIds);
    if (users) {
      for (const u of users) {
        userMap[u.id] = u.wallet_address;
      }
    }
  }

  const enriched = memberships.map((m: any) => ({
    ...toCamel(m),
    userWallet: userMap[m.user_id] ?? null,
  }));

  return { data: enriched, total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Performance Stats (aggregates)
// ─────────────────────────────────────────────

export async function adminGetPerformanceStats() {
  const [profilesRes, vaultsRes, nodesRes, commissionsRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("vault_positions").select("principal").eq("status", "ACTIVE"),
    supabase
      .from("node_memberships")
      .select("id", { count: "exact", head: true })
      .eq("status", "ACTIVE"),
    supabase
      .from("node_rewards")
      .select("amount")
      .eq("reward_type", "TEAM_COMMISSION"),
  ]);

  const totalUsers = profilesRes.count ?? 0;

  const totalDeposited = (vaultsRes.data ?? []).reduce(
    (sum: number, v: any) => sum + Number(v.principal || 0),
    0
  );

  const activeNodes = nodesRes.count ?? 0;

  const totalCommissions = (commissionsRes.data ?? []).reduce(
    (sum: number, r: any) => sum + Number(r.amount || 0),
    0
  );

  return { totalUsers, totalDeposited, activeNodes, totalCommissions };
}

// ─────────────────────────────────────────────
// Commissions (TEAM_COMMISSION rewards)
// ─────────────────────────────────────────────

export async function adminGetCommissions(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("node_rewards")
    .select("*", { count: "exact" })
    .eq("reward_type", "TEAM_COMMISSION")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: toCamel(data ?? []), total: count ?? 0 };
}

// ─────────────────────────────────────────────
// Auth Codes
// ─────────────────────────────────────────────

export async function adminGetAuthCodes(page: number, pageSize: number, statusFilter?: string) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("node_auth_codes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (statusFilter && statusFilter !== "ALL") {
    query = query.eq("status", statusFilter);
  }

  const { data, error, count } = await query.range(from, to);

  if (error) throw error;
  return { data: toCamel(data ?? []), total: count ?? 0 };
}

export async function adminCreateAuthCode(
  code: string,
  nodeType: string,
  createdBy: string
) {
  const { data, error } = await supabase
    .from("node_auth_codes")
    .insert({
      code,
      node_type: nodeType,
      max_uses: 1,
      used_count: 0,
      status: "ACTIVE",
      created_by: createdBy,
    })
    .select()
    .single();

  if (error) throw error;
  return toCamel(data);
}

function generateRandomCode(_prefix: string): string {
  // 6-digit pure numeric code
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function adminBatchCreateAuthCodes(
  count: number,
  nodeType: string,
  prefix: string,
  createdBy: string
) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push({
      code: generateRandomCode(prefix),
      node_type: nodeType,
      max_uses: 1,
      used_count: 0,
      status: "ACTIVE",
      created_by: createdBy,
    });
  }

  const { data, error } = await supabase
    .from("node_auth_codes")
    .insert(codes)
    .select();

  if (error) throw error;
  return toCamel(data ?? []);
}

export async function adminDeactivateAuthCode(id: string) {
  const { data, error } = await supabase
    .from("node_auth_codes")
    .update({ status: "INACTIVE" })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return toCamel(data);
}

// ─────────────────────────────────────────────
// Admin Users Management
// ─────────────────────────────────────────────

export async function adminGetAdminUsers() {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, username, role, is_active, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return toCamel(data ?? []);
}

export async function adminCreateAdminUser(
  username: string,
  password: string,
  role: string
) {
  const { data, error } = await supabase
    .from("admin_users")
    .insert({ username, password, role, is_active: true })
    .select("id, username, role, is_active, created_at")
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function adminUpdateAdminUser(
  id: string,
  updates: { role?: string; is_active?: boolean; password?: string }
) {
  const updateData: Record<string, any> = {};
  if (updates.role !== undefined) updateData.role = updates.role;
  if (updates.is_active !== undefined) updateData.is_active = updates.is_active;
  if (updates.password !== undefined) updateData.password = updates.password;

  const { data, error } = await supabase
    .from("admin_users")
    .update(updateData)
    .eq("id", id)
    .select("id, username, role, is_active, created_at")
    .single();
  if (error) throw error;
  return toCamel(data);
}

export async function adminDeleteAdminUser(id: string) {
  const { error } = await supabase
    .from("admin_users")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// Node Fund Records (on-chain)
// ─────────────────────────────────────────────

export async function adminGetNodeFundRecords(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // Get NODE_PURCHASE transactions with tx_hash (on-chain payments)
  const { data, error, count } = await supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("type", "NODE_PURCHASE")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const transactions = data ?? [];

  // Enrich with user wallet addresses
  const userIds = Array.from(
    new Set(transactions.map((t: any) => t.user_id).filter(Boolean))
  );

  let userMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("profiles")
      .select("id, wallet_address")
      .in("id", userIds);
    if (users) {
      for (const u of users) {
        userMap[u.id] = u.wallet_address;
      }
    }
  }

  const enriched = transactions.map((t: any) => ({
    ...toCamel(t),
    userWallet: userMap[t.user_id] ?? null,
  }));

  return { data: enriched, total: count ?? 0 };
}

export async function adminGetNodeFundStats() {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount, details")
    .eq("type", "NODE_PURCHASE");

  if (error) throw error;

  const rows = data ?? [];
  const totalAmount = rows.reduce((sum: number, r: any) => sum + Number(r.details?.frozen || r.amount || 0), 0);
  const totalContribution = rows.reduce((sum: number, r: any) => {
    const contribution = r.details?.contribution;
    return sum + Number(contribution || 0);
  }, 0);

  return { totalRecords: rows.length, totalAmount, totalContribution };
}

// ─────────────────────────────────────────────
// Fund Distributions (FundManager → recipients)
// ─────────────────────────────────────────────

export async function adminGetFundDistributions(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("fund_distributions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return { data: toCamel(data ?? []), total: count ?? 0 };
}

export async function adminGetFundDistributionStats() {
  const { data, error } = await supabase
    .from("fund_distributions")
    .select("token, amount");

  if (error) throw error;

  const rows = data ?? [];
  const totalDistributed = rows.reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  const usdtTotal = rows.filter((r: any) => r.token === "USDT").reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
  const usdcTotal = rows.filter((r: any) => r.token === "USDC").reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);

  return { totalRecords: rows.length, totalDistributed, usdtTotal, usdcTotal };
}

export async function adminGetAuthCodeStats() {
  const { data, error } = await supabase
    .from("node_auth_codes")
    .select("status");

  if (error) throw error;

  const rows = data ?? [];
  const total = rows.length;
  const used = rows.filter((r: any) => r.status === "USED").length;
  const available = rows.filter((r: any) => r.status === "ACTIVE").length;

  return { total, used, available };
}
