import { FileText, Copy, Check } from "lucide-react";
import { useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jqgimdgtpwnunrlwexib.supabase.co";

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-xl overflow-hidden mb-3" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.04)" }}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.04]">
        <span className="text-[10px] text-foreground/25 font-mono">{lang || ""}</span>
        <button onClick={handleCopy} className="text-[10px] text-foreground/30 hover:text-foreground/60 flex items-center gap-1">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre className="px-4 py-3 text-xs font-mono text-foreground/60 overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export default function ProviderDocs() {
  const endpoint = `${SUPABASE_URL}/functions/v1/signal-webhook`;

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center gap-2.5">
        <FileText className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold text-foreground">对接文档</h1>
      </div>

      {/* Endpoint */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">Webhook 端点</h2>
        <CodeBlock code={`POST ${endpoint}`} lang="HTTP" />
        <p className="text-xs text-foreground/40">认证方式 (二选一):</p>
        <CodeBlock code={`Authorization: Bearer YOUR_API_KEY\n\n# 或 (TradingView 兼容)\nx-webhook-secret: YOUR_API_KEY`} lang="Headers" />
      </section>

      {/* Format 1 */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-1">格式一: 标准格式</h2>
        <p className="text-xs text-foreground/35 mb-3">完整信号，包含所有参数</p>
        <CodeBlock lang="JSON" code={`{
  "asset": "BTC",
  "action": "OPEN_LONG",
  "confidence": 78,
  "strength": "MEDIUM",
  "strategy_type": "directional",
  "leverage": 3,
  "stop_loss_pct": 0.02,
  "take_profit_pct": 0.03,
  "position_size_pct": 0.5,
  "source_models": ["MyStrategy v2"],
  "rag_context": "EMA crossover + volume spike"
}`} />
        <div className="text-xs text-foreground/35 space-y-1">
          <p><code className="text-primary/60">action</code>: OPEN_LONG | OPEN_SHORT | CLOSE | HOLD</p>
          <p><code className="text-primary/60">confidence</code>: 0-100, 信心度</p>
          <p><code className="text-primary/60">strength</code>: STRONG({'>='}75) | MEDIUM({'>='}60) | WEAK, 不填自动计算</p>
          <p><code className="text-primary/60">stop_loss_pct</code>: 止损百分比, 0.02 = 2%</p>
        </div>
      </section>

      {/* Format 2 */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-1">格式二: TradingView 格式</h2>
        <p className="text-xs text-foreground/35 mb-3">TradingView Alert 兼容</p>
        <CodeBlock lang="JSON" code={`{
  "ticker": "BTCUSDT",
  "action": "buy",
  "price": 67230,
  "confidence": 75,
  "comment": "RSI oversold bounce"
}`} />
        <p className="text-xs text-foreground/35">action: buy/long, sell/short, close/exit/flat</p>
      </section>

      {/* Format 3 */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-1">格式三: 极简格式</h2>
        <p className="text-xs text-foreground/35 mb-3">最少 2 个字段</p>
        <CodeBlock lang="JSON" code={`{
  "direction": "long",
  "asset": "BTC"
}`} />
      </section>

      {/* Response */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">响应格式</h2>
        <p className="text-xs text-foreground/35 mb-2">成功 (200):</p>
        <CodeBlock lang="JSON" code={`{
  "status": "ok",
  "signal_id": "550e8400-...",
  "provider": "your_name",
  "action": "OPEN_LONG",
  "asset": "BTC",
  "confidence": 78,
  "strength": "MEDIUM"
}`} />
        <p className="text-xs text-foreground/35 mb-2">错误:</p>
        <CodeBlock lang="JSON" code={`// 401 Unauthorized
{ "error": "Unauthorized..." }

// 400 Asset not allowed
{ "error": "Asset AVAX not allowed..." }`} />
      </section>

      {/* cURL Example */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">cURL 示例</h2>
        <CodeBlock lang="bash" code={`curl -X POST \\
  ${endpoint} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "asset": "BTC",
    "action": "OPEN_LONG",
    "confidence": 80,
    "leverage": 3,
    "stop_loss_pct": 0.02
  }'`} />
      </section>

      {/* Python Example */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">Python 示例</h2>
        <CodeBlock lang="python" code={`import requests

API_KEY = "sp_your_api_key_here"
URL = "${endpoint}"

resp = requests.post(URL, headers={
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}, json={
    "asset": "BTC",
    "action": "OPEN_LONG",
    "confidence": 80,
    "leverage": 3,
    "stop_loss_pct": 0.02,
    "take_profit_pct": 0.04,
})
print(resp.json())`} />
      </section>

      {/* TradingView Setup */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <h2 className="text-sm font-bold text-foreground/70 mb-3">TradingView 配置</h2>
        <div className="text-xs text-foreground/40 space-y-2">
          <p>1. 在 TradingView Alert 中设置 Webhook URL:</p>
          <CodeBlock code={endpoint} lang="URL" />
          <p>2. 添加 Header: <code className="text-primary/60">x-webhook-secret: YOUR_API_KEY</code></p>
          <p>3. Alert Message:</p>
          <CodeBlock lang="JSON" code={`{
  "ticker": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "confidence": 75
}`} />
        </div>
      </section>
    </div>
  );
}
