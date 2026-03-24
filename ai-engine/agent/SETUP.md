# CoinMax AI Trading Agent - Mac Mini 部署教程

## 概述

在 Mac Mini 上部署 AI 交易分析 Agent，使用本地大模型 (Ollama) + 云端 AI 交叉验证，每 15 分钟自动分析市场并推送到 CoinMax 平台。

### 优势
- **本地模型免费无限调用** — Ollama 运行 Llama 3.1 / Qwen 2.5 等模型
- **无超时限制** — 不受 Supabase 30s Edge Function 限制
- **更深度分析** — 可以跑 70B 参数大模型，准确率更高
- **自主搜索新闻** — 结合新闻和链上数据分析
- **24/7 运行** — Mac Mini 低功耗持续运行

---

## 第一步：安装 Ollama

```bash
# 下载安装 Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 或者 Mac 上用 brew
brew install ollama

# 启动 Ollama 服务
ollama serve
```

## 第二步：下载 AI 模型

推荐模型（按 Mac Mini 配置选择）：

| 配置 | 推荐模型 | 大小 | 命令 |
|------|---------|------|------|
| 8GB RAM | llama3.1:8b | 4.7GB | `ollama pull llama3.1:8b` |
| 16GB RAM | qwen2.5:14b | 9GB | `ollama pull qwen2.5:14b` |
| 32GB+ RAM | llama3.1:70b | 40GB | `ollama pull llama3.1:70b` |

```bash
# 至少下载一个模型
ollama pull llama3.1:8b

# 推荐同时下载 Qwen（中文更强）
ollama pull qwen2.5:14b

# 验证模型可用
ollama list
```

## 第三步：配置 Agent

```bash
# 进入 agent 目录
cd ai-engine/agent

# 安装依赖
npm install

# 复制配置文件
cp .env.example .env
```

编辑 `.env` 文件：

```env
# Supabase (必填)
SUPABASE_URL=https://enedbksmftcgtszrkppc.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...（你的 service_role key）

# Ollama (默认 localhost)
OLLAMA_URL=http://localhost:11434

# 云端 AI（可选，用于交叉验证）
OPENAI_API_KEY=sk-proj-xxx
CLAUDE_API_KEY=sk-ant-xxx
DEEPSEEK_API_KEY=sk-xxx

# Agent 设置
ANALYSIS_INTERVAL_MIN=15    # 每15分钟分析一次
TOP_COINS_COUNT=5           # 每次选5个最佳币种
```

## 第四步：测试运行

```bash
# 单次运行测试
npm run once
```

预期输出：
```
[14:30:00] CoinMax AI Trading Agent starting...
[14:30:00] Supabase: https://enedbksmftcgtszrkppc.supabase.co
[14:30:00] Ollama: http://localhost:11434
[14:30:00] === Starting AI Analysis ===
[14:30:00] Ollama: 2 models (using llama3.1:8b)
[14:30:01] Market: 10 coins | News: 5 articles
[14:30:01] Step 1: AI Coin Screening...
[14:30:05]   Local (llama3.1:8b): BTC,ETH,SOL,DOGE,XRP
[14:30:07]   GPT-4o: BTC,ETH,SOL,BNB,DOGE
[14:30:07]   Selected: BTC, ETH, SOL, DOGE, BNB
[14:30:07] Step 2: Deep Analysis...
[14:30:15]   BTC: 4/4 models
[14:30:22]   ETH: 4/4 models
[14:30:30]   SOL: 3/4 models
[14:30:37]   DOGE: 4/4 models
[14:30:42]   BNB: 4/4 models
[14:30:42] === Done: 5 coins, 19 analyses in 42.1s ===
```

## 第五步：持续运行

### 方法 A：直接运行
```bash
npm start
# Agent 会每 15 分钟自动运行
# Ctrl+C 停止
```

### 方法 B：后台运行（推荐）
```bash
# 使用 pm2 进程管理器
npm install -g pm2

# 启动
pm2 start trading-agent.js --name coinmax-agent

# 查看状态
pm2 status

# 查看日志
pm2 logs coinmax-agent

# 设置开机自启
pm2 startup
pm2 save
```

### 方法 C：系统服务（macOS）
```bash
# 创建 LaunchAgent
cat > ~/Library/LaunchAgents/com.coinmax.agent.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coinmax.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/ai-engine/agent/trading-agent.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/path/to/ai-engine/agent</string>
</dict>
</plist>
EOF

# 加载服务
launchctl load ~/Library/LaunchAgents/com.coinmax.agent.plist
```

---

## 工作流程

```
每 15 分钟:

  1. 获取数据
     ├── CoinGecko: 10 个币种价格/涨跌/成交量
     ├── Fear & Greed Index: 市场恐贪指数
     └── NewsAPI: 最新加密货币新闻

  2. AI 选币 (Step 1)
     ├── 本地 Llama/Qwen: 从 10 币中选 Top 5 (免费)
     └── GPT-4o: 交叉验证 Top 5 (1 次 API 调用)
     → 合并投票 → 选出最佳 5 个币种

  3. 深度分析 (Step 2)
     ├── 本地 Llama/Qwen: 每个币的方向+理由 (免费)
     ├── GPT-4o: 交叉验证 (5 次调用)
     ├── Claude: 交叉验证 (5 次调用)
     └── DeepSeek: 交叉验证 (5 次调用)
     → 每个币有 4 个模型的独立分析

  4. 推送到 Supabase
     └── ai_market_analysis 表
         → simulate-trading 每 5 分钟读取
         → 基于 AI 分析调整交易信号
```

## 成本估算

| 项目 | 费用/月 |
|------|---------|
| 本地 Ollama | $0 (免费) |
| GPT-4o-mini | ~$2-5 (每日 ~100 调用) |
| Claude Haiku | ~$2-5 |
| DeepSeek | ~$0.5-1 |
| Mac Mini 电费 | ~$5-10 |
| **总计** | **~$10-20/月** |

## 监控

查看 Supabase Dashboard → ai_market_analysis 表，确认数据在更新：
- 每 15 分钟应有 ~20 条新记录
- asset="SCREENING" 的行显示 AI 选币结果
- 其他行是具体币种的方向分析

## 故障排查

```bash
# Ollama 没启动？
ollama serve

# 模型没下载？
ollama list
ollama pull llama3.1:8b

# Supabase 连接失败？
curl -s "https://enedbksmftcgtszrkppc.supabase.co/rest/v1/" -H "apikey: YOUR_KEY"

# 查看 Agent 日志
pm2 logs coinmax-agent --lines 50
```
