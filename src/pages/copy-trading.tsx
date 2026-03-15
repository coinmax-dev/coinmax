/**
 * Copy Trading Simulation Page (Internal Testing Only)
 *
 * Access via: /copy-trading (not linked from any navigation)
 * Combines: LiveTradingPanel + RiskControlPanel + ApiKeyBind
 */

import { useState } from "react";
import { LiveTradingPanel } from "@/components/strategy/live-trading-panel";
import { RiskControlPanel } from "@/components/strategy/risk-control";
import { ApiKeyBind } from "@/components/strategy/api-key-bind";

type Tab = "signals" | "risk" | "keys";

export default function CopyTradingPage() {
  const [activeTab, setActiveTab] = useState<Tab>("signals");
  // For testing, use a mock userId or allow input
  const [testUserId, setTestUserId] = useState("test-user-001");
  const [showIdInput, setShowIdInput] = useState(false);

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
              <h1 className="text-sm font-bold text-foreground/80">CoinMax 模拟跟单</h1>
              <p className="text-[10px] text-foreground/25 mt-0.5">内部测试 — 不对外公开</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowIdInput(!showIdInput)}
                className="text-[9px] text-foreground/20 bg-foreground/5 px-2 py-1 rounded hover:bg-foreground/10 transition-colors font-mono"
              >
                {testUserId}
              </button>
            </div>
          </div>

          {showIdInput && (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={testUserId}
                onChange={e => setTestUserId(e.target.value)}
                placeholder="Test User ID"
                className="flex-1 bg-white/[0.04] rounded px-2 py-1 text-[10px] text-foreground/50 border border-white/[0.06] font-mono"
              />
              <button
                onClick={() => setShowIdInput(false)}
                className="text-[10px] text-primary bg-primary/10 px-3 py-1 rounded"
              >
                确定
              </button>
            </div>
          )}

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
        {activeTab === "risk" && <RiskControlPanel userId={testUserId} />}
        {activeTab === "keys" && <ApiKeyBind userId={testUserId} />}
      </div>

      {/* Debug footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-sm py-2 px-4 text-center" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <p className="text-[9px] text-foreground/15 font-mono">
          INTERNAL TEST BUILD — AI Engine v0.6.0 — userId: {testUserId}
        </p>
      </div>
    </div>
  );
}
