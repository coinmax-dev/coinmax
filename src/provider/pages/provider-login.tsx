import { useState } from "react";
import { Radio, Key, UserPlus, ArrowLeft, Check, Copy } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

interface Props {
  onLogin: (key: string) => Promise<string | null>;
}

export default function ProviderLogin({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Registration fields
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regDesc, setRegDesc] = useState("");
  const [regWebsite, setRegWebsite] = useState("");
  const [regSuccess, setRegSuccess] = useState<{ apiKey: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleLogin = async () => {
    if (!apiKey.trim()) return;
    setError("");
    setLoading(true);
    const err = await onLogin(apiKey.trim());
    setLoading(false);
    if (err) setError(err);
  };

  const handleRegister = async () => {
    if (!regName.trim() || !regEmail.trim()) {
      setError("请填写名称和邮箱");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/provider-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: regName.trim(),
          contact_email: regEmail.trim(),
          description: regDesc.trim(),
          website: regWebsite.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "注册失败");
        return;
      }
      setRegSuccess({ apiKey: data.api_key, name: data.name });
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Registration success screen
  if (regSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(10,186,181,0.15)", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
          <div className="text-center mb-5">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #22c55e, #34d399)" }}>
              <Check className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-bold text-foreground mb-1">注册成功</h1>
            <p className="text-xs text-foreground/40">请保存您的 API Key，审核通过后即可使用</p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-foreground/30 mb-1">提供方名称</p>
              <p className="text-sm font-semibold text-foreground/70">{regSuccess.name}</p>
            </div>

            <div>
              <p className="text-[11px] text-yellow-400/70 mb-1 font-semibold">API Key（仅显示一次）</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-10 rounded-xl px-3 flex items-center text-[10px] font-mono text-yellow-300/80 overflow-x-auto" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(234,179,8,0.2)" }}>
                  {regSuccess.apiKey}
                </div>
                <button onClick={() => handleCopy(regSuccess.apiKey)} className="h-10 px-3 rounded-xl flex items-center gap-1 text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 shrink-0">
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
            </div>

            <div className="rounded-xl p-3" style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.12)" }}>
              <p className="text-[11px] text-yellow-400/60">状态: <span className="font-bold text-yellow-400">待审核</span></p>
              <p className="text-[10px] text-yellow-400/40 mt-1">CoinMax 团队将在 1-3 个工作日内审核您的申请</p>
            </div>

            <button
              onClick={() => { setApiKey(regSuccess.apiKey); setRegSuccess(null); setMode("login"); }}
              className="w-full h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97]"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.3)" }}
            >
              前往登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(10,186,181,0.15)", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}>
        <div className="text-center mb-6">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 20px rgba(10,186,181,0.4)" }}
          >
            {mode === "login" ? <Radio className="h-7 w-7 text-white" /> : <UserPlus className="h-7 w-7 text-white" />}
          </div>
          <h1 className="text-xl font-bold text-foreground mb-1">
            {mode === "login" ? "策略提供方中心" : "策略商注册"}
          </h1>
          <p className="text-xs text-foreground/40">
            {mode === "login" ? "使用 API Key 登录" : "申请成为 CoinMax 策略提供方"}
          </p>
        </div>

        {mode === "login" ? (
          <div className="space-y-3">
            <div className="relative">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/25" />
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(""); }}
                placeholder="sp_xxxxxxxx..."
                className="w-full h-11 rounded-xl pl-10 pr-4 text-sm text-white placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: error ? "1px solid #ef4444" : "1px solid rgba(10,186,181,0.12)" }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                autoFocus
              />
            </div>

            {error && <p className="text-xs text-red-400 pl-1">{error}</p>}

            <button
              onClick={handleLogin}
              disabled={loading || !apiKey.trim()}
              className="w-full h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.3)" }}
            >
              {loading ? "验证中..." : "登录"}
            </button>

            <div className="pt-3 border-t border-white/[0.06] text-center">
              <button onClick={() => { setMode("register"); setError(""); }} className="text-xs text-primary/70 hover:text-primary transition-colors">
                还没有账号？注册成为策略商
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => { setMode("login"); setError(""); }} className="flex items-center gap-1 text-xs text-foreground/35 hover:text-foreground/60 mb-2">
              <ArrowLeft className="h-3 w-3" /> 返回登录
            </button>

            <div>
              <label className="text-[11px] text-foreground/40 mb-1 block">策略名称 *</label>
              <input
                value={regName}
                onChange={(e) => { setRegName(e.target.value); setError(""); }}
                placeholder="例: AlphaQuant Strategy"
                className="w-full h-10 rounded-xl px-4 text-sm text-white placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
            </div>

            <div>
              <label className="text-[11px] text-foreground/40 mb-1 block">联系邮箱 *</label>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => { setRegEmail(e.target.value); setError(""); }}
                placeholder="team@example.com"
                className="w-full h-10 rounded-xl px-4 text-sm text-white placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
            </div>

            <div>
              <label className="text-[11px] text-foreground/40 mb-1 block">策略描述</label>
              <textarea
                value={regDesc}
                onChange={(e) => setRegDesc(e.target.value)}
                placeholder="简要描述您的交易策略..."
                rows={2}
                className="w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 outline-none resize-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
            </div>

            <div>
              <label className="text-[11px] text-foreground/40 mb-1 block">网站</label>
              <input
                value={regWebsite}
                onChange={(e) => setRegWebsite(e.target.value)}
                placeholder="https://..."
                className="w-full h-10 rounded-xl px-4 text-sm text-white placeholder:text-white/20 outline-none"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
              />
            </div>

            {error && <p className="text-xs text-red-400 pl-1">{error}</p>}

            <button
              onClick={handleRegister}
              disabled={loading || !regName.trim() || !regEmail.trim()}
              className="w-full h-11 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97] disabled:opacity-40"
              style={{ background: "linear-gradient(135deg, #0abab5, #34d399)", boxShadow: "0 4px 15px rgba(10,186,181,0.3)" }}
            >
              {loading ? "提交中..." : "提交注册申请"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
