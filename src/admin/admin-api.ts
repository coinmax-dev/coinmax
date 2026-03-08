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
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id, username, password, is_active")
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

  return { success: true };
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
  return { data: toCamel(data ?? []), total: count ?? 0 };
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

  const enriched = profiles.map((p: any) => ({
    ...toCamel(p),
    referrerWallet: referrerMap[p.referrer_id] ?? null,
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
  children: ReferralNode[];
}

export async function adminGetReferralTree(walletAddress: string): Promise<ReferralNode | null> {
  // Get root profile
  const { data: root, error } = await supabase
    .from("profiles")
    .select("id, wallet_address, rank, node_type, ref_code, created_at")
    .eq("wallet_address", walletAddress)
    .single();
  if (error || !root) return null;

  // Recursively fetch children (max 4 levels deep)
  async function fetchChildren(parentId: string, depth: number): Promise<ReferralNode[]> {
    if (depth > 4) return [];
    const { data } = await supabase
      .from("profiles")
      .select("id, wallet_address, rank, node_type, ref_code, created_at")
      .eq("referrer_id", parentId)
      .order("created_at", { ascending: true });
    if (!data?.length) return [];
    const nodes: ReferralNode[] = [];
    for (const row of data) {
      const children = await fetchChildren(row.id, depth + 1);
      nodes.push({
        id: row.id,
        walletAddress: row.wallet_address,
        rank: row.rank,
        nodeType: row.node_type,
        refCode: row.ref_code,
        createdAt: row.created_at,
        children,
      });
    }
    return nodes;
  }

  const children = await fetchChildren(root.id, 1);
  return {
    id: root.id,
    walletAddress: root.wallet_address,
    rank: root.rank,
    nodeType: root.node_type,
    refCode: root.ref_code,
    createdAt: root.created_at,
    children,
  };
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

export async function adminGetAuthCodes(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("node_auth_codes")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

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
