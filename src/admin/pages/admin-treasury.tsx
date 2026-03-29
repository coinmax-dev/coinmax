/**
 * Admin Treasury — Bridge / Batch / Deposit-Withdraw Control Panel
 *
 * Global switches + manual triggers + cycle history
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAdminAuth } from "@/admin/admin-auth";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRightLeft, Settings, RefreshCw, Play, Square, ArrowUpFromLine,
  ArrowDownToLine, Globe, Zap, Clock, AlertTriangle, CheckCircle2, XCircle,
} from "lucide-react";

// ── Types ──

interface TreasurySwitch {
  key: string;
  value: string;
  description: string;
}

interface BridgeCycle {
  id: string;
  cycle_type: string;
  status: string;
  amount_usd: number;
  bsc_tx: string | null;
  arb_tx: string | null;
  hl_tx: string | null;
  pnl_usd: number;
  fees_usd: number;
  initiated_by: string;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

const SWITCH_ICONS: Record<string, any> = {
  bridge_enabled: Globe,
  hl_deposit_enabled: ArrowDownToLine,
  hl_withdraw_enabled: ArrowUpFromLine,
  batch_distribute_enabled: ArrowRightLeft,
  auto_bridge_enabled: Zap,
};

const STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  PENDING: { text: "text-yellow-400", bg: "bg-yellow-500/10" },
  BRIDGING: { text: "text-blue-400", bg: "bg-blue-500/10" },
  DEPOSITING: { text: "text-cyan-400", bg: "bg-cyan-500/10" },
  IN_HL: { text: "text-green-400", bg: "bg-green-500/10" },
  WITHDRAWING: { text: "text-orange-400", bg: "bg-orange-500/10" },
  RETURNING: { text: "text-indigo-400", bg: "bg-indigo-500/10" },
  DISTRIBUTING: { text: "text-purple-400", bg: "bg-purple-500/10" },
  COMPLETED: { text: "text-green-400", bg: "bg-green-500/10" },
  FAILED: { text: "text-red-400", bg: "bg-red-500/10" },
  CANCELLED: { text: "text-foreground/30", bg: "bg-white/[0.03]" },
};

const CYCLE_LABELS: Record<string, string> = {
  BSC_TO_ARB: "BSC → ARB",
  ARB_TO_BSC: "ARB → BSC",
  DEPOSIT_HL: "存入 HL",
  WITHDRAW_HL: "提取 HL",
  FULL_ROUND: "完整周期",
};

// ── Component ──

export default function AdminTreasury() {
  const { adminUser } = useAdminAuth();
  const { toast } = useToast();

  // Fetch switches
  const { data: switches = [], isLoading: switchesLoading } = useQuery({
    queryKey: ["admin", "treasury", "config"],
    queryFn: async () => {
      const { data } = await supabase.from("treasury_config").select("*").order("key");
      return (data || []) as TreasurySwitch[];
    },
    enabled: !!adminUser,
  });

  // Fetch cycles
  const { data: cycles = [], isLoading: cyclesLoading, refetch: refetchCycles } = useQuery({
    queryKey: ["admin", "treasury", "cycles"],
    queryFn: async () => {
      const { data } = await supabase.from("bridge_cycles").select("*").order("started_at", { ascending: false }).limit(20);
      return (data || []) as BridgeCycle[];
    },
    enabled: !!adminUser,
  });

  // Toggle switch
  const toggleMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const { error } = await supabase.from("treasury_config").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "config"] });
    },
  });

  // Update config value
  const updateConfig = async (key: string, value: string) => {
    await supabase.from("treasury_config").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "config"] });
    toast({ title: "已更新", description: `${key} = ${value}` });
  };

  // Create manual cycle
  const createCycle = async (cycleType: string) => {
    const { error } = await supabase.from("bridge_cycles").insert({
      cycle_type: cycleType,
      amount_usd: 0,
      initiated_by: adminUser || "admin",
      status: "PENDING",
    });
    if (error) {
      toast({ title: "创建失败", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "已创建", description: `${CYCLE_LABELS[cycleType]} 任务已加入队列` });
      refetchCycles();
    }
  };

  // Call edge function directly
  const callEdgeFunction = async (name: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  // Trigger splitter flush
  const flushSplitter = async () => {
    try {
      const data = await callEdgeFunction("splitter-flush");
      toast({ title: "Splitter Flush", description: `${data.status}: ${data.balance || ""}` });
    } catch (e: any) {
      toast({ title: "失败", description: e.message, variant: "destructive" });
    }
  };

  // Trigger NodePool flush
  const flushNodePool = async () => {
    try {
      const data = await callEdgeFunction("flush-node-pool");
      toast({ title: "NodePool Flush", description: `${data.status}: ${data.balance || ""}` });
    } catch (e: any) {
      toast({ title: "失败", description: e.message, variant: "destructive" });
    }
  };

  // Trigger batch bridge (BSC → ARB)
  const triggerBridge = async () => {
    try {
      const data = await callEdgeFunction("batch-bridge");
      toast({ title: "跨链桥", description: `${data.status}: ${data.balance || ""} ${data.txId ? "TX:" + data.txId.slice(0, 8) : ""}` });
      refetchCycles();
    } catch (e: any) {
      toast({ title: "失败", description: e.message, variant: "destructive" });
    }
  };

  // Trigger HL deposit/withdraw
  const triggerHL = async (action: string, amount?: number) => {
    try {
      const data = await callEdgeFunction("hl-treasury", { action, amount });
      toast({ title: `HL ${action}`, description: JSON.stringify(data).slice(0, 100) });
      refetchCycles();
    } catch (e: any) {
      toast({ title: "失败", description: e.message, variant: "destructive" });
    }
  };

  // Separate switches into toggles and params
  const toggleKeys = ["bridge_enabled", "hl_deposit_enabled", "hl_withdraw_enabled", "batch_distribute_enabled", "auto_bridge_enabled"];
  const toggleSwitches = switches.filter(s => toggleKeys.includes(s.key));
  const paramSwitches = switches.filter(s => !toggleKeys.includes(s.key));

  // Stats
  const activeCycles = cycles.filter(c => !["COMPLETED", "FAILED", "CANCELLED"].includes(c.status));
  const totalBridged = cycles.filter(c => c.status === "COMPLETED").reduce((s, c) => s + Number(c.amount_usd), 0);
  const totalFees = cycles.filter(c => c.status === "COMPLETED").reduce((s, c) => s + Number(c.fees_usd), 0);

  return (
    <div className="space-y-4 lg:space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary" />
          <h1 className="text-base lg:text-lg font-bold text-foreground/80">资金管理 / 跨链桥</h1>
        </div>
        <Button size="sm" variant="outline" onClick={() => { refetchCycles(); queryClient.invalidateQueries({ queryKey: ["admin", "treasury", "config"] }); }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> 刷新
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="进行中" value={activeCycles.length} color="text-yellow-400" />
        <StatCard label="已完成" value={cycles.filter(c => c.status === "COMPLETED").length} color="text-green-400" />
        <StatCard label="总跨链" value={`$${totalBridged.toLocaleString()}`} color="text-blue-400" />
        <StatCard label="总费用" value={`$${totalFees.toFixed(2)}`} color="text-foreground/40" />
      </div>

      {/* Global Switches */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary/60" />
          <h2 className="text-sm font-bold text-foreground/60">全局开关</h2>
        </div>
        <div className="p-4 lg:p-5 space-y-3">
          {switchesLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
          ) : (
            toggleSwitches.map(s => {
              const isOn = s.value === "true";
              const Icon = SWITCH_ICONS[s.key] || Settings;
              return (
                <div key={s.key} className={cn("flex items-center justify-between px-4 py-3 rounded-xl border transition-colors", isOn ? "bg-green-500/5 border-green-500/15" : "bg-white/[0.02] border-white/[0.06]")}>
                  <div className="flex items-center gap-3">
                    <Icon className={cn("h-4 w-4", isOn ? "text-green-400" : "text-foreground/25")} />
                    <div>
                      <p className="text-xs font-bold text-foreground/60">{s.description}</p>
                      <p className="text-[9px] text-foreground/20 font-mono">{s.key}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleMutation.mutate({ key: s.key, value: isOn ? "false" : "true" })}
                    className={cn("w-10 h-5 rounded-full transition-colors relative", isOn ? "bg-green-500" : "bg-foreground/10")}
                  >
                    <div className={cn("w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform", isOn ? "translate-x-5" : "translate-x-0.5")} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Parameters */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-400/60" />
          <h2 className="text-sm font-bold text-foreground/60">参数配置</h2>
        </div>
        <div className="p-4 lg:p-5 space-y-2">
          {paramSwitches.map(s => (
            <ParamRow key={s.key} label={s.description || s.key} configKey={s.key} value={s.value} onSave={updateConfig} />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <Play className="h-4 w-4 text-emerald-400/60" />
          <h2 className="text-sm font-bold text-foreground/60">手动操作</h2>
        </div>
        <div className="p-4 lg:p-5 grid grid-cols-2 lg:grid-cols-3 gap-2">
          <ActionButton label="Splitter 分配" desc="金库 USDC 分配" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} color="emerald" onClick={flushSplitter} />
          <ActionButton label="NodePool 分配" desc="节点 USDC → 接收钱包" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} color="emerald" onClick={flushNodePool} />
          <ActionButton label="BSC → ARB 跨链" desc="BatchBridge → Stargate" icon={<Globe className="h-3.5 w-3.5" />} color="blue" onClick={triggerBridge} />
          <ActionButton label="存入 HL Vault" desc="ARB USDC → HL" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} color="cyan" onClick={() => triggerHL("deposit")} />
          <ActionButton label="提取 HL Vault" desc="HL → ARB USDC (24h)" icon={<ArrowUpFromLine className="h-3.5 w-3.5" />} color="orange" onClick={() => triggerHL("withdraw")} />
          <ActionButton label="HL 余额查询" desc="查看 HL 持仓" icon={<RefreshCw className="h-3.5 w-3.5" />} color="foreground" onClick={() => triggerHL("status")} />
        </div>
      </div>

      {/* Cycle History */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
        <div className="px-4 lg:px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <Clock className="h-4 w-4 text-foreground/30" />
          <h2 className="text-sm font-bold text-foreground/60">操作记录 ({cycles.length})</h2>
        </div>
        <div className="p-4 lg:p-5">
          {cyclesLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : cycles.length === 0 ? (
            <p className="text-xs text-foreground/20 text-center py-6">暂无操作记录</p>
          ) : (
            <div className="space-y-2">
              {cycles.map(c => {
                const sc = STATUS_COLORS[c.status] || STATUS_COLORS.PENDING;
                return (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                    <div className="flex items-center gap-3">
                      {c.status === "COMPLETED" ? <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" /> :
                       c.status === "FAILED" ? <XCircle className="h-4 w-4 text-red-400 shrink-0" /> :
                       <Clock className="h-4 w-4 text-yellow-400 shrink-0 animate-pulse" />}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-foreground/60">{CYCLE_LABELS[c.cycle_type] || c.cycle_type}</span>
                          <Badge className={cn("text-[9px]", sc.bg, sc.text)}>{c.status}</Badge>
                        </div>
                        <p className="text-[10px] text-foreground/20 mt-0.5">
                          ${Number(c.amount_usd).toLocaleString()} · {c.initiated_by} · {new Date(c.started_at).toLocaleString("zh-CN")}
                        </p>
                      </div>
                    </div>
                    {c.error_message && (
                      <span className="text-[9px] text-red-400/60 max-w-[120px] truncate">{c.error_message}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub Components ──

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3">
      <p className="text-[10px] text-foreground/30">{label}</p>
      <p className={cn("text-xl font-black mt-0.5", color)}>{value}</p>
    </div>
  );
}

function ParamRow({ label, configKey, value, onSave }: { label: string; configKey: string; value: string; onSave: (k: string, v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
      <div>
        <p className="text-[11px] text-foreground/50">{label}</p>
        <p className="text-[9px] text-foreground/20 font-mono">{configKey}</p>
      </div>
      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input value={draft} onChange={e => setDraft(e.target.value)} className="h-7 w-32 text-xs font-mono" />
          <Button size="sm" className="h-7 text-[10px] px-2" onClick={() => { onSave(configKey, draft); setEditing(false); }}>保存</Button>
          <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => setEditing(false)}>取消</Button>
        </div>
      ) : (
        <button onClick={() => { setDraft(value); setEditing(true); }} className="text-xs font-mono text-foreground/40 hover:text-primary transition-colors truncate max-w-[180px]">
          {value || "-"}
        </button>
      )}
    </div>
  );
}

function ActionButton({ label, desc, icon, color, onClick, disabled }: {
  label: string; desc: string; icon: React.ReactNode; color: string; onClick: () => void; disabled?: boolean;
}) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-400",
    blue: "border-blue-500/20 hover:bg-blue-500/10 text-blue-400",
    cyan: "border-cyan-500/20 hover:bg-cyan-500/10 text-cyan-400",
    orange: "border-orange-500/20 hover:bg-orange-500/10 text-orange-400",
    purple: "border-purple-500/20 hover:bg-purple-500/10 text-purple-400",
    amber: "border-amber-500/20 hover:bg-amber-500/10 text-amber-400",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "p-3 rounded-xl border text-left transition-all",
        disabled ? "opacity-30 cursor-not-allowed border-white/[0.04]" : colors[color] || colors.blue,
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-[11px] font-bold">{label}</span></div>
      <p className="text-[9px] text-foreground/20">{desc}</p>
    </button>
  );
}
