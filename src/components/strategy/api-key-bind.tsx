/**
 * API Key Binding Flow
 *
 * Phase 5.4: Secure exchange API key binding for automated trading.
 * Validates keys, checks permissions, encrypts and stores securely.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

type SupportedExchange = "binance" | "bybit" | "okx" | "bitget" | "hyperliquid" | "dydx";

interface StoredKey {
  id: string;
  exchange: SupportedExchange;
  label: string;
  masked_key: string;
  testnet: boolean;
  is_valid: boolean;
  last_validated: string;
  created_at: string;
}

const EXCHANGES: Array<{
  id: SupportedExchange;
  name: string;
  icon: string;
  needsPassphrase: boolean;
  hasTestnet: boolean;
}> = [
  { id: "binance", name: "Binance", icon: "₿", needsPassphrase: false, hasTestnet: true },
  { id: "bybit", name: "Bybit", icon: "▲", needsPassphrase: false, hasTestnet: true },
  { id: "okx", name: "OKX", icon: "◎", needsPassphrase: true, hasTestnet: true },
  { id: "bitget", name: "Bitget", icon: "◆", needsPassphrase: true, hasTestnet: false },
  { id: "hyperliquid", name: "HyperLiquid", icon: "H", needsPassphrase: false, hasTestnet: true },
  { id: "dydx", name: "dYdX v4", icon: "D", needsPassphrase: false, hasTestnet: true },
];

export function ApiKeyBind({ userId }: { userId?: string }) {
  const [storedKeys, setStoredKeys] = useState<StoredKey[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedExchange, setSelectedExchange] = useState<SupportedExchange | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [testnet, setTestnet] = useState(false);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load stored keys
  useEffect(() => {
    if (!userId) return;
    supabase
      .from("user_exchange_keys")
      .select("id, exchange, label, masked_key, testnet, is_valid, last_validated, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setStoredKeys(data);
      });
  }, [userId, success]);

  const exchangeConfig = EXCHANGES.find(e => e.id === selectedExchange);

  const handleSubmit = async () => {
    if (!userId || !selectedExchange || !apiKey || !apiSecret) {
      setError("请填写所有必填字段");
      return;
    }
    if (exchangeConfig?.needsPassphrase && !passphrase) {
      setError("此交易所需要 Passphrase");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Call edge function to validate and store key
      const { data, error: fnError } = await supabase.functions.invoke("bind-exchange-key", {
        body: {
          userId,
          exchange: selectedExchange,
          apiKey,
          apiSecret,
          passphrase: passphrase || undefined,
          testnet,
          label: label || selectedExchange,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setSuccess(`${exchangeConfig?.name} API Key 绑定成功`);
      setShowForm(false);
      resetForm();
      setTimeout(() => setSuccess(""), 3000);
    } catch (e: any) {
      setError(e.message || "绑定失败");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (exchange: SupportedExchange) => {
    if (!userId) return;
    if (!confirm(`确定要删除 ${exchange} 的 API Key 吗？`)) return;

    await supabase
      .from("user_exchange_keys")
      .delete()
      .eq("user_id", userId)
      .eq("exchange", exchange);

    setStoredKeys(prev => prev.filter(k => k.exchange !== exchange));
  };

  const resetForm = () => {
    setSelectedExchange(null);
    setApiKey("");
    setApiSecret("");
    setPassphrase("");
    setTestnet(false);
    setLabel("");
    setError("");
  };

  return (
    <div className="space-y-4">
      {/* Success message */}
      {success && (
        <div className="px-4 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400">
          {success}
        </div>
      )}

      {/* Stored keys list */}
      <div className="rounded-xl bg-white/[0.02] p-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-foreground/50">已绑定的交易所</h3>
          <button
            onClick={() => { setShowForm(true); resetForm(); }}
            className="text-[10px] font-semibold text-primary bg-primary/10 px-3 py-1 rounded-lg hover:bg-primary/20 transition-colors"
          >
            + 添加
          </button>
        </div>

        {storedKeys.length === 0 ? (
          <p className="text-xs text-foreground/20 text-center py-6">尚未绑定任何交易所 API Key</p>
        ) : (
          <div className="space-y-2">
            {storedKeys.map(key => {
              const ex = EXCHANGES.find(e => e.id === key.exchange);
              return (
                <div key={key.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/[0.02]" style={{ border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{ex?.icon || "?"}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground/70">{ex?.name || key.exchange}</span>
                        {key.testnet && <span className="text-[9px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">测试网</span>}
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded", key.is_valid ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10")}>
                          {key.is_valid ? "有效" : "无效"}
                        </span>
                      </div>
                      <p className="text-[10px] text-foreground/25 mt-0.5 font-mono">{key.masked_key}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(key.exchange)}
                    className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors"
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add key form */}
      {showForm && (
        <div className="rounded-xl bg-white/[0.02] p-4 space-y-4" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-foreground/50">绑定交易所 API Key</h3>
            <button onClick={() => setShowForm(false)} className="text-xs text-foreground/30 hover:text-foreground/50">取消</button>
          </div>

          {/* Exchange selection */}
          <div>
            <label className="text-[10px] text-foreground/30 mb-1 block">选择交易所</label>
            <div className="grid grid-cols-3 gap-2">
              {EXCHANGES.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => setSelectedExchange(ex.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors",
                    selectedExchange === ex.id
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "bg-white/[0.02] text-foreground/40 border border-white/[0.04] hover:bg-white/[0.04]"
                  )}
                >
                  <span>{ex.icon}</span>
                  <span className="font-semibold">{ex.name}</span>
                </button>
              ))}
            </div>
          </div>

          {selectedExchange && (
            <>
              {/* API Key */}
              <div>
                <label className="text-[10px] text-foreground/30 mb-1 block">API Key</label>
                <input
                  type="text"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="输入 API Key"
                  className="w-full bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-foreground/60 border border-white/[0.06] placeholder:text-foreground/15"
                />
              </div>

              {/* API Secret */}
              <div>
                <label className="text-[10px] text-foreground/30 mb-1 block">API Secret</label>
                <input
                  type="password"
                  value={apiSecret}
                  onChange={e => setApiSecret(e.target.value)}
                  placeholder="输入 API Secret"
                  className="w-full bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-foreground/60 border border-white/[0.06] placeholder:text-foreground/15"
                />
              </div>

              {/* Passphrase (OKX, Bitget) */}
              {exchangeConfig?.needsPassphrase && (
                <div>
                  <label className="text-[10px] text-foreground/30 mb-1 block">Passphrase</label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={e => setPassphrase(e.target.value)}
                    placeholder="输入 Passphrase"
                    className="w-full bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-foreground/60 border border-white/[0.06] placeholder:text-foreground/15"
                  />
                </div>
              )}

              {/* Label */}
              <div>
                <label className="text-[10px] text-foreground/30 mb-1 block">标签（可选）</label>
                <input
                  type="text"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder={`我的 ${exchangeConfig?.name} 账户`}
                  className="w-full bg-white/[0.04] rounded-lg px-3 py-2 text-xs text-foreground/60 border border-white/[0.06] placeholder:text-foreground/15"
                />
              </div>

              {/* Testnet toggle */}
              {exchangeConfig?.hasTestnet && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-foreground/40">使用测试网</span>
                  <button
                    onClick={() => setTestnet(!testnet)}
                    className={cn("w-8 h-4 rounded-full transition-colors relative", testnet ? "bg-yellow-500" : "bg-foreground/10")}
                  >
                    <div className={cn("w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform", testnet ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </div>
              )}

              {/* Security notice */}
              <div className="px-3 py-2 rounded-lg bg-yellow-500/5 border border-yellow-500/10">
                <p className="text-[10px] text-yellow-400/60">
                  安全提示：请确保 API Key 仅开启「交易」权限，禁用「提币」权限。您的密钥将使用 AES-256-GCM 加密存储。
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={loading || !apiKey || !apiSecret}
                className={cn(
                  "w-full py-2.5 rounded-xl text-xs font-bold transition-colors",
                  loading ? "bg-foreground/5 text-foreground/20" : "bg-primary/10 text-primary hover:bg-primary/20",
                  (!apiKey || !apiSecret) && "opacity-50 cursor-not-allowed"
                )}
              >
                {loading ? "验证中..." : "验证并绑定"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
