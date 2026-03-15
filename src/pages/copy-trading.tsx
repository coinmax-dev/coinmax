/**
 * Copy Trading Page
 *
 * Standalone copy trading interface accessible via /copy-trading.
 * Combines: LiveTradingPanel + RiskControlPanel + ApiKeyBind
 */

import { useState } from "react";
import { LiveTradingPanel } from "@/components/strategy/live-trading-panel";
import { RiskControlPanel } from "@/components/strategy/risk-control";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";

type Tab = "signals" | "risk" | "keys";

export default function CopyTradingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("signals");

  const tabs: { id: Tab; label: string }[] = [
    { id: "signals", label: "信号 & 持仓" },
    { id: "risk", label: "风控设置" },
    { id: "keys", label: "交易所绑定" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-bold text-foreground/80">CoinMax 跟单交易</h1>
              <p className="text-[10px] text-foreground/40 mt-0.5">AI 模拟信号 & 持仓</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 text-center py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary"
                    : "text-foreground/30 hover:text-foreground/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-4">
        {activeTab === "signals" && <LiveTradingPanel />}
        {activeTab === "risk" && <RiskControlPanel userId="guest" />}
        {activeTab === "keys" && <ApiKeyBind userId="guest" />}
      </div>
    </div>
  );
}
