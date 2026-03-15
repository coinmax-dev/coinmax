import { useProviderAuth } from "../provider-app";
import { Key, RefreshCw, Copy, Check, AlertTriangle } from "lucide-react";
import { useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

export default function ProviderKeys() {
  const { apiKey, provider, logout } = useProviderAuth();
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRotate = async () => {
    setRotating(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-api-key`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "rotate" }),
      });
      if (!resp.ok) throw new Error("Failed to rotate");
      const data = await resp.json();
      setNewKey(data.new_api_key);
      setShowConfirm(false);
    } catch {
      // Error handling
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <Key className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">API Key 管理</h1>
      </div>

      {/* Current Key */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">当前 API Key</h2>
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex-1 h-11 rounded-xl px-4 flex items-center text-sm font-mono text-foreground/40"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {apiKey ? `${apiKey.slice(0, 11)}${"•".repeat(20)}...${apiKey.slice(-4)}` : "—"}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground/35">
          <span>提供方: <span className="text-foreground/60 font-semibold">{provider?.name}</span></span>
          <span>状态: <span className="text-primary font-semibold">{provider?.status}</span></span>
        </div>
      </div>

      {/* New Key (after rotation) */}
      {newKey && (
        <div className="rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            <h2 className="text-sm font-bold text-yellow-400">新 API Key（仅显示一次）</h2>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div
              className="flex-1 h-11 rounded-xl px-4 flex items-center text-xs font-mono text-yellow-300 overflow-x-auto"
              style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(234,179,8,0.2)" }}
            >
              {newKey}
            </div>
            <button
              onClick={() => handleCopy(newKey)}
              className="h-11 px-4 rounded-xl flex items-center gap-1.5 text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          <p className="text-[11px] text-yellow-400/60">请立即保存此 Key。旧 Key 已失效，关闭此页面后将无法再次查看。</p>
          <button
            onClick={logout}
            className="mt-3 px-4 py-2 text-xs font-semibold rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
          >
            使用新 Key 重新登录
          </button>
        </div>
      )}

      {/* Rotate Key */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-2">轮换 API Key</h2>
        <p className="text-xs text-foreground/35 mb-4">生成新的 API Key 并立即使旧 Key 失效。此操作不可撤销。</p>

        {showConfirm ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleRotate}
              disabled={rotating}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-40"
            >
              {rotating ? "生成中..." : "确认轮换"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-4 py-2 text-xs font-semibold rounded-lg text-foreground/40 hover:text-foreground/60 transition-colors"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-white/[0.04] text-foreground/50 border border-white/[0.08] hover:bg-white/[0.08] transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            轮换 Key
          </button>
        )}
      </div>

      {/* Webhook endpoint info */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">Webhook 端点</h2>
        <div
          className="h-10 rounded-xl px-4 flex items-center text-xs font-mono text-primary/80 mb-2"
          style={{ background: "rgba(10,186,181,0.06)", border: "1px solid rgba(10,186,181,0.12)" }}
        >
          POST {SUPABASE_URL}/functions/v1/signal-webhook
        </div>
        <p className="text-[11px] text-foreground/30">使用 <code className="text-primary/60">Authorization: Bearer YOUR_API_KEY</code> 发送信号</p>
      </div>
    </div>
  );
}
