# CoinMax — 策略提供方对接文档

> Version: 1.0 | 2026-03-15
> Contact: tech@coinmax.ai

---

## 概述

CoinMax 是一个 AI 驱动的加密货币跟单平台。我们接受外部策略提供方将交易信号接入平台，供用户订阅跟单。

本文档面向 **策略提供方**，介绍如何将您的策略接入 CoinMax 系统。

---

## 支持的资产

`BTC` `ETH` `SOL` `BNB` `DOGE` `XRP`

（更多资产可按需开放）

---

## 接入方式一览

| 方式 | 适用场景 | 难度 | 延迟 |
|------|---------|------|------|
| **A. Webhook（推荐）** | 任何系统 (TradingView, Python, 手动) | ⭐ 简单 | <1s |
| **B. AI 模型** | 自有 AI/ML 预测模型 | ⭐⭐ 中等 | <3s |
| **C. Supabase SDK** | TypeScript/JavaScript 系统 | ⭐⭐ 中等 | <1s |
| **D. Hummingbot** | 已有 Hummingbot 策略 | ⭐⭐⭐ 较复杂 | 实时 |

---

## 方式 A: Webhook 接入（推荐）

最简单的接入方式。向我们的 Webhook 端点发送 HTTP POST 请求即可。

### 端点

```
POST https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/signal-webhook
```

### 认证

在请求头中添加以下任一认证方式：

```
Authorization: Bearer <YOUR_API_KEY>
```

或（TradingView 兼容）：

```
x-webhook-secret: <YOUR_API_KEY>
```

> API Key 由 CoinMax 团队分配，请联系我们获取。

### 请求格式

我们支持 3 种 JSON 格式，系统自动识别：

#### 格式 1: CoinMax 标准格式（完整）

```json
{
  "asset": "BTC",
  "action": "OPEN_LONG",
  "confidence": 78,
  "strength": "MEDIUM",
  "strategy_type": "directional",
  "leverage": 3,
  "stop_loss_pct": 0.02,
  "take_profit_pct": 0.03,
  "position_size_pct": 0.5,
  "source_models": ["MyStrategy v2.1"],
  "rag_context": "Based on EMA crossover + volume spike"
}
```

**字段说明:**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `asset` | string | 是 | 交易对: `BTC`, `ETH`, `SOL` 等 |
| `action` | string | 是 | `OPEN_LONG` / `OPEN_SHORT` / `CLOSE` / `HOLD` |
| `confidence` | number | 是 | 信心度 0-100 |
| `strength` | string | 否 | `STRONG`(≥75) / `MEDIUM`(≥60) / `WEAK`(<60)，不填自动计算 |
| `strategy_type` | string | 否 | `directional` / `grid` / `dca`，默认 `directional` |
| `leverage` | number | 否 | 杠杆倍数，默认 2x，上限由提供方配置决定 |
| `stop_loss_pct` | number | 否 | 止损百分比，如 0.02 = 2%，默认 2% |
| `take_profit_pct` | number | 否 | 止盈百分比，如 0.03 = 3%，默认 3% |
| `position_size_pct` | number | 否 | 仓位比例 0-1，如 0.5 = 50%，默认 50% |
| `source_models` | string[] | 否 | 策略来源标识 |
| `rag_context` | string | 否 | 决策理由（供回溯分析） |

#### 格式 2: TradingView Alert 格式

```json
{
  "ticker": "BTCUSDT",
  "action": "buy",
  "price": 67230,
  "confidence": 75,
  "comment": "RSI oversold bounce"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `ticker` 或 `symbol` | string | 交易对（自动去除 USDT/USD/PERP 后缀） |
| `action` / `order` / `side` | string | `buy`/`long` → OPEN_LONG, `sell`/`short` → OPEN_SHORT, `close`/`exit`/`flat` → CLOSE |
| `confidence` | number | 可选，默认 70 |
| `leverage` | number | 可选，默认 2 |
| `stoploss` / `stop_loss` | number | 可选，默认 0.02 |
| `takeprofit` / `take_profit` | number | 可选，默认 0.03 |
| `comment` / `message` | string | 可选，决策备注 |

**TradingView Alert 配置示例:**

```
Webhook URL: https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/signal-webhook

Message:
{
  "ticker": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "confidence": 75
}

Header: x-webhook-secret: <YOUR_API_KEY>
```

#### 格式 3: 极简格式

最少 2 个字段即可发送信号：

```json
{
  "direction": "long",
  "asset": "BTC"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `direction` 或 `side` | string | `long`/`buy` → OPEN_LONG, `short`/`sell` → OPEN_SHORT |
| `asset` 或 `coin` | string | 资产名称，默认 BTC |

### 响应

**成功 (200):**
```json
{
  "status": "ok",
  "signal_id": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "your_provider_name",
  "action": "OPEN_LONG",
  "asset": "BTC",
  "confidence": 78,
  "strength": "MEDIUM"
}
```

**HOLD 信号 (200):**
```json
{
  "status": "skipped",
  "reason": "HOLD signal, no action taken"
}
```

**错误:**
```json
// 401 Unauthorized
{ "error": "Unauthorized. Provide Bearer token or x-webhook-secret header." }

// 400 Asset not allowed
{ "error": "Asset AVAX not allowed for provider your_name" }

// 500 Database error
{ "error": "DB error: ..." }
```

### cURL 示例

```bash
# 开多 BTC，信心度 80%
curl -X POST \
  https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/signal-webhook \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "asset": "BTC",
    "action": "OPEN_LONG",
    "confidence": 80,
    "leverage": 3,
    "stop_loss_pct": 0.02,
    "take_profit_pct": 0.04
  }'
```

### Python 示例

```python
import requests

API_KEY = "YOUR_API_KEY"
WEBHOOK_URL = "https://jqgimdgtpwnunrlwexib.supabase.co/functions/v1/signal-webhook"

def send_signal(asset: str, action: str, confidence: int, **kwargs):
    resp = requests.post(
        WEBHOOK_URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "asset": asset,
            "action": action,
            "confidence": confidence,
            **kwargs,
        },
    )
    return resp.json()

# 开多 BTC
result = send_signal("BTC", "OPEN_LONG", 80, leverage=3, stop_loss_pct=0.02)
print(result)

# 平仓 ETH
result = send_signal("ETH", "CLOSE", 90)
print(result)
```

---

## 方式 B: AI 模型接入

将您的 AI/ML 预测模型作为额外预测源加入 CoinMax 的多模型共识系统。

### 您需要做什么

部署一个 HTTP API，接收市场数据，返回预测结果。

### 请求格式（CoinMax → 您的 API）

```
POST https://your-api.com/predict
Content-Type: application/json
Authorization: Bearer <your_model_api_key>  (如需要)
```

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are a crypto analyst. Return JSON: {prediction, confidence, targetPrice, reasoning}"
    },
    {
      "role": "user",
      "content": "Analyze BTC/USDT at $67,230.\n  Technical: RSI(14)=55.3, MACD=BULLISH_CROSS, BB=52%\n  On-Chain: Funding=0.01%, L/S_ratio=1.15\n  Predict the 1-hour movement."
    }
  ]
}
```

### 响应格式（您的 API → CoinMax）

您的 API 需要返回以下结构之一：

**OpenAI 兼容格式（推荐）:**
```json
{
  "choices": [
    {
      "message": {
        "content": "{\"prediction\":\"BULLISH\",\"confidence\":78,\"targetPrice\":67850,\"reasoning\":\"EMA crossover with volume confirmation\"}"
      }
    }
  ]
}
```

**简化格式:**
```json
{
  "prediction": "BULLISH",
  "confidence": 78,
  "targetPrice": 67850,
  "reasoning": "EMA crossover with volume confirmation"
}
```

### 预测字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prediction` | string | 是 | `BULLISH` / `BEARISH` / `NEUTRAL` |
| `confidence` | number | 是 | 0-100 |
| `targetPrice` | number | 是 | 预测目标价格 |
| `reasoning` | string | 否 | 决策理由 |

### 注册流程

联系 CoinMax 团队提供以下信息：
- 模型名称 / 标签
- API 端点 URL
- API Key（如有）

我们通过环境变量 `CUSTOM_MODELS` 注册您的模型：
```
CUSTOM_MODELS=YourModel|https://your-api.com/predict|your_api_key
```

### 您自动获得

- 准确率追踪（7天/30天/全部）
- 动态权重调整（越准权重越高）
- RAG 记忆增强（系统从相似历史行情中学习您模型的表现）
- Admin Dashboard 准确率展示
- 预测自动验证（每分钟对比实际价格）

---

## 方式 C: Supabase SDK 直连

适合 TypeScript/JavaScript 开发者，通过 Supabase Client 直接写入信号表。

### 安装

```bash
npm install @supabase/supabase-js
```

### 代码

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://jqgimdgtpwnunrlwexib.supabase.co",
  "<SERVICE_ROLE_KEY>"  // 由 CoinMax 团队提供
);

// 发布交易信号
async function publishSignal(signal: {
  asset: string;
  action: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE";
  confidence: number;
  leverage?: number;
  stop_loss_pct?: number;
  take_profit_pct?: number;
}) {
  const strength =
    signal.confidence >= 75 ? "STRONG" :
    signal.confidence >= 60 ? "MEDIUM" : "WEAK";

  const direction =
    signal.action === "OPEN_LONG" ? "LONG" :
    signal.action === "OPEN_SHORT" ? "SHORT" : "NEUTRAL";

  const { data, error } = await supabase
    .from("trade_signals")
    .insert({
      ...signal,
      direction,
      strength,
      strategy_type: "directional",
      leverage: signal.leverage ?? 2,
      stop_loss_pct: signal.stop_loss_pct ?? 0.02,
      take_profit_pct: signal.take_profit_pct ?? 0.03,
      position_size_pct: 0.5,
      source_models: ["YourStrategy"],
      status: "active",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

// 使用示例
const signalId = await publishSignal({
  asset: "BTC",
  action: "OPEN_LONG",
  confidence: 82,
  leverage: 3,
  stop_loss_pct: 0.015,
  take_profit_pct: 0.04,
});
console.log("Signal published:", signalId);
```

### 监听信号执行结果

```typescript
// 订阅信号状态更新
supabase
  .channel("my-signals")
  .on("postgres_changes", {
    event: "UPDATE",
    schema: "public",
    table: "trade_signals",
    filter: "source_models=cs.{YourStrategy}",
  }, (payload) => {
    console.log("Signal updated:", payload.new);
    if (payload.new.status === "executed") {
      console.log("PnL:", payload.new.result_pnl);
    }
  })
  .subscribe();
```

---

## 方式 D: Hummingbot 策略接入

如果您已有 Hummingbot V2 策略，可直接接入我们的执行框架。

请联系技术团队获取 Controller 模板和部署指导。

---

## 信号生命周期

```
策略发出信号 → trade_signals 表 (status: active)
                    │
                    ├── Realtime 广播 → 前端用户看到
                    ├── 执行引擎接收 → 风控检查
                    │       ├── 通过 → 执行交易 (status: executed)
                    │       └── 拒绝 → (status: cancelled, close_reason: "risk_check")
                    │
                    └── 超时未执行 → (status: expired)

交易结束后 → result_pnl 更新 → 计入策略绩效
```

---

## 信号验证规则

系统在接收信号后会进行以下检查：

| 检查项 | 规则 | 未通过处理 |
|--------|------|-----------|
| 资产白名单 | 必须在提供方的 `allowedAssets` 列表中 | 返回 400 |
| HOLD 信号 | action=HOLD 不执行 | 返回 200 (skipped) |
| 信心度范围 | 自动 clamp 到 0-100 | 修正后继续 |
| 杠杆上限 | 不超过提供方的 `maxLeverage` | 修正为最大值 |
| 仓位比例 | 自动 clamp 到 0-1 | 修正后继续 |

---

## 绩效追踪

接入后，您可以追踪以下指标：

- **胜率**: 盈利信号 / 总信号
- **平均盈亏比**: 平均盈利 / 平均亏损
- **最大回撤**: 连续最大亏损
- **信号频率**: 每日/每周信号数量
- **执行率**: 被执行的信号 / 总信号

查询示例（SQL）:
```sql
SELECT
  COUNT(*) as total_signals,
  COUNT(*) FILTER (WHERE result_pnl > 0) as wins,
  COUNT(*) FILTER (WHERE result_pnl <= 0) as losses,
  ROUND(AVG(result_pnl)::numeric, 4) as avg_pnl,
  ROUND(SUM(result_pnl)::numeric, 4) as total_pnl
FROM trade_signals
WHERE source_models @> ARRAY['YourStrategy']
  AND status = 'executed'
  AND created_at > NOW() - INTERVAL '30 days';
```

---

## 接入流程

```
1. 联系 CoinMax 技术团队
2. 获取 API Key / Service Role Key
3. 选择接入方式 (A/B/C/D)
4. 开发对接 + 发送测试信号
5. Paper Trading 测试期（至少 7 天）
6. 绩效审核：胜率 > 55%，盈亏比 > 1.2
7. 通过审核 → 上线（用户可订阅）
8. 持续监控绩效，动态调整权重
```

---

## 常见问题

**Q: 信号发送频率有限制吗？**
A: 同一资产建议间隔至少 60 秒。系统有冷却期控制。

**Q: 可以同时发送多个资产的信号吗？**
A: 可以，每个资产独立处理。

**Q: 信号的有效期是多久？**
A: 默认 1 小时未执行则自动过期。可通过配置调整。

**Q: 如何测试而不影响真实用户？**
A: 测试阶段使用 Paper Trading 模式，信号不会触发真实交易。

**Q: 支持哪些交易所执行？**
A: Binance, Bybit, OKX, Bitget, HyperLiquid, dYdX。

---

## 联系方式

- 技术对接: tech@coinmax-ai.com
- Telegram: @coinmax_tech
- GitHub: github.com/coinmax-ai
