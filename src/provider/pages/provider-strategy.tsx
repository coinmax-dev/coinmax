import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProviderAuth } from "../provider-app";
import { Settings, Save, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";
const ALL_ASSETS = ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"];

export default function ProviderStrategy() {
  const { apiKey, provider } = useProviderAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["provider", "dashboard-strategy"],
    queryFn: async () => {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-dashboard`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    enabled: !!apiKey,
  });

  const providerData = data?.provider;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [assets, setAssets] = useState<string[]>([]);
  const [maxLeverage, setMaxLeverage] = useState(5);
  const [dirty, setDirty] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    if (providerData) {
      setName(providerData.name || "");
      setAssets(providerData.allowed_assets || []);
      setMaxLeverage(providerData.max_leverage || 5);
    }
  }, [providerData]);

  // Fetch full provider details (including description, website) from dashboard
  const { data: fullData } = useQuery({
    queryKey: ["provider", "full-details"],
    queryFn: async () => {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-dashboard?detailed=true`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed");
      return resp.json();
    },
    enabled: !!apiKey,
  });

  // Signal statistics by asset
  const { data: assetStats } = useQuery({
    queryKey: ["provider", "asset-stats"],
    queryFn: async () => {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-signals?limit=100`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error("Failed");
      const result = await resp.json();
      const signals = result.signals || [];

      // Group by asset
      const byAsset: Record<string, { total: number; wins: number; pnl: number }> = {};
      for (const s of signals) {
        if (!byAsset[s.asset]) byAsset[s.asset] = { total: 0, wins: 0, pnl: 0 };
        byAsset[s.asset].total++;
        if (s.result_pnl > 0) byAsset[s.asset].wins++;
        byAsset[s.asset].pnl += Number(s.result_pnl || 0);
      }
      return byAsset;
    },
    enabled: !!apiKey,
  });

  const toggleAsset = (asset: string) => {
    setDirty(true);
    setAssets(prev => prev.includes(asset) ? prev.filter(a => a !== asset) : [...prev, asset]);
  };

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-2.5">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">策略管理</h1>
      </div>

      {/* Provider Status */}
      {provider?.status === "pending" && (
        <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}>
          <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-400">审核中</p>
            <p className="text-xs text-yellow-400/50 mt-1">您的策略正在审核中，审核通过后即可发送信号。您可以先配置策略参数。</p>
          </div>
        </div>
      )}

      {/* Strategy Info */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-4">基本信息</h2>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-foreground/35 mb-1 block">策略名称</label>
            <input
              value={name}
              disabled
              className="w-full h-10 rounded-xl px-4 text-sm text-foreground/50 outline-none cursor-not-allowed"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
            />
            <p className="text-[10px] text-foreground/20 mt-1">名称不可修改，如需更改请联系管理员</p>
          </div>
          <div>
            <label className="text-[11px] text-foreground/35 mb-1 block">状态</label>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${
                provider?.status === "approved" ? "bg-green-500/12 text-green-400 border-green-500/20" :
                provider?.status === "pending" ? "bg-yellow-500/12 text-yellow-400 border-yellow-500/20" :
                "bg-red-500/12 text-red-400 border-red-500/20"
              }`}>
                {provider?.status === "approved" ? "已通过" : provider?.status === "pending" ? "审核中" : provider?.status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Trading Config */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-4">交易配置</h2>
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-foreground/35 mb-2 block">允许交易的资产</label>
            <div className="flex flex-wrap gap-2">
              {ALL_ASSETS.map(asset => (
                <button
                  key={asset}
                  onClick={() => toggleAsset(asset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                    assets.includes(asset)
                      ? "bg-primary/15 text-primary border-primary/20"
                      : "bg-white/[0.02] text-foreground/30 border-white/[0.06] hover:text-foreground/50"
                  }`}
                >
                  {asset}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-foreground/35 mb-2 block">最大杠杆: {maxLeverage}x</label>
            <input
              type="range"
              min={1}
              max={20}
              value={maxLeverage}
              onChange={(e) => { setMaxLeverage(Number(e.target.value)); setDirty(true); }}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-foreground/20 mt-1">
              <span>1x</span>
              <span>5x</span>
              <span>10x</span>
              <span>20x</span>
            </div>
          </div>
        </div>

        {dirty && (
          <p className="text-[10px] text-yellow-400/50 mt-3">配置修改需联系管理员生效</p>
        )}
      </div>

      {/* Per-Asset Performance */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-4">各资产表现</h2>
        {!assetStats || Object.keys(assetStats).length === 0 ? (
          <p className="text-xs text-foreground/25">暂无交易数据</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(assetStats).map(([asset, stats]: [string, any]) => {
              const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : "0.0";
              return (
                <div key={asset} className="flex items-center gap-4 px-3 py-2.5 rounded-xl bg-white/[0.02]">
                  <span className="text-sm font-bold text-foreground/70 w-12">{asset}</span>
                  <div className="flex-1">
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full ${Number(winRate) >= 55 ? "bg-green-500" : Number(winRate) >= 45 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(Number(winRate), 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-foreground/40 shrink-0">
                    <span>{stats.total} 笔</span>
                    <span>{winRate}% 胜率</span>
                    <span className={stats.pnl >= 0 ? "text-green-400" : "text-red-400"}>
                      {stats.pnl >= 0 ? "+" : ""}{stats.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Integration Status */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">接入状态</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: "rgba(10,186,181,0.04)", border: "1px solid rgba(10,186,181,0.1)" }}>
            <p className="text-[10px] text-foreground/30 mb-1">Webhook API</p>
            <p className="text-xs font-semibold text-primary">已激活</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] text-foreground/30 mb-1">AI 模型接入</p>
            <p className="text-xs font-semibold text-foreground/30">未配置</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] text-foreground/30 mb-1">Hummingbot</p>
            <p className="text-xs font-semibold text-foreground/30">未配置</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p className="text-[10px] text-foreground/30 mb-1">Supabase SDK</p>
            <p className="text-xs font-semibold text-foreground/30">未配置</p>
          </div>
        </div>
      </div>
    </div>
  );
}
