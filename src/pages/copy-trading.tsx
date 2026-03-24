/**
 * Copy Trading Page — Setup wizard + Dashboard (tab switching)
 */

import { useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { CopyTradingFlow } from "@/components/strategy/copy-trading-flow";
import { CopyTradingDashboard } from "@/components/strategy/copy-trading-dashboard";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Settings, BarChart3 } from "lucide-react";

export default function CopyTradingPage() {
  const account = useActiveAccount();
  const walletAddress = account?.address || "";

  // If navigated from strategy card with ?model=xxx, go to settings tab
  const urlParams = new URLSearchParams(window.location.search);
  const preSelectedModel = urlParams.get("model");
  const [tab, setTab] = useState<"dashboard" | "settings">(preSelectedModel ? "settings" : "dashboard");

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 lg:pb-8">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-foreground/80">CoinMax 跟单交易</h1>
              <p className="text-[10px] text-foreground/40 mt-0.5">
                {walletAddress ? "AI 智能跟单 · 多策略组合" : "请先连接钱包"}
              </p>
            </div>
            <div className={cn(
              "px-2.5 py-1 rounded-lg text-[10px] font-bold",
              !walletAddress ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
            )}>
              {!walletAddress ? "未连接" : "已连接"}
            </div>
          </div>

          {walletAddress && (
            <div className="flex gap-1 mt-3">
              <button
                onClick={() => setTab("dashboard")}
                className={cn(
                  "flex-1 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
                  tab === "dashboard" ? "bg-primary/10 text-primary" : "text-foreground/30 hover:text-foreground/50"
                )}
              >
                <BarChart3 className="h-3.5 w-3.5" /> 仪表盘
              </button>
              <button
                onClick={() => setTab("settings")}
                className={cn(
                  "flex-1 py-2 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors",
                  tab === "settings" ? "bg-primary/10 text-primary" : "text-foreground/30 hover:text-foreground/50"
                )}
              >
                <Settings className="h-3.5 w-3.5" /> 配置
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-4">
        {!walletAddress ? (
          <div className="rounded-xl bg-yellow-500/8 border border-yellow-500/15 px-4 py-3">
            <p className="text-xs text-yellow-400/80">请先在首页连接钱包，才能保存跟单设置和绑定交易所。</p>
          </div>
        ) : tab === "dashboard" ? (
          <CopyTradingDashboard wallet={walletAddress} />
        ) : (
          <CopyTradingFlow userId={walletAddress} preSelectedModel={preSelectedModel || undefined} />
        )}
      </div>
    </div>
  );
}
