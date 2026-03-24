# CoinMax AI Agent — OpenClaw 部署教程

## 前提

你的 Mac Mini 已经运行了 OpenClaw（http://127.0.0.1:18789）。

## 第一步：修复 OpenClaw 警告

根据 `openclaw doctor` 的报告，先修复：

```bash
# 创建 OAuth credentials 目录
mkdir -p ~/.openclaw/credentials

# 修复 Gateway entrypoint
openclaw doctor --fix

# 运行安全审计
openclaw security audit --deep
```

## 第二步：创建 CoinMax Agent

```bash
# 方法 A：通过 CLI 创建
openclaw agents add coinmax-trader

# 方法 B：直接在 dashboard 聊天框输入
# 打开 http://127.0.0.1:18789/chat
# 输入: "创建一个新的 trading agent"
```

## 第三步：复制配置文件

把这个目录的文件复制到 OpenClaw workspace：

```bash
# 复制 AGENTS.md（Agent 指令）
cp AGENTS.md ~/.openclaw/workspace/AGENTS.md

# 复制 Skills
cp -r skills/crypto-market-data ~/.openclaw/workspace/skills/
cp -r skills/push-analysis ~/.openclaw/workspace/skills/
```

或者如果你用了自定义 agent 目录：

```bash
# 查看 agent 目录位置
openclaw agents list

# 假设目录是 ~/.openclaw/workspace-coinmax-trader/
AGENT_DIR=~/.openclaw/workspace-coinmax-trader
cp AGENTS.md $AGENT_DIR/AGENTS.md
cp -r skills/* $AGENT_DIR/skills/
```

## 第四步：验证 Skills 加载

```bash
# 重启 Gateway
openclaw gateway restart

# 检查 skills 是否加载
openclaw skills list
# 应该看到: crypto_market_data, push_analysis
```

## 第五步：测试分析

在 dashboard 聊天框（http://127.0.0.1:18789/chat）输入：

```
分析当前加密货币市场，选出最佳交易币种，并推送分析结果到 Supabase
```

Agent 会：
1. 调用 `crypto_market_data` skill 获取市场数据
2. 分析并选出 Top 5 币种
3. 对每个币给出方向+理由
4. 调用 `push_analysis` skill 推送到数据库

## 第六步：设置自动定时分析

```bash
# 每 15 分钟自动分析
openclaw cron add \
  --name "crypto-analysis" \
  --cron "*/15 * * * *" \
  --session isolated \
  --message "执行加密货币市场分析：1) 使用 crypto_market_data 获取市场数据 2) 选出 Top 5 最佳交易币种 3) 对每个币种深度分析方向和理由 4) 使用 push_analysis 推送所有结果到 Supabase" \
  --no-announce
```

验证 cron 已创建：
```bash
openclaw cron list
```

## 第七步：监控

### 在 Dashboard 查看
打开 http://127.0.0.1:18789/chat，可以看到 Agent 的分析历史。

### 在 Supabase 验证
```bash
curl -s "https://enedbksmftcgtszrkppc.supabase.co/rest/v1/ai_market_analysis?model=eq.openclaw-agent&order=created_at.desc&limit=5" \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3OTMxMjAsImV4cCI6MjA4OTM2OTEyMH0.B1cyUgbpV5JopebVHlLWCnwRwhqa0TRICRB9btQ23vU" | python3 -m json.tool
```

## 架构总结

```
OpenClaw Dashboard (127.0.0.1:18789)
  └── CoinMax Agent
        ├── AGENTS.md (交易分析指令)
        ├── skills/
        │   ├── crypto-market-data/  (获取市场数据)
        │   └── push-analysis/       (推送到 Supabase)
        └── Cron: 每15分钟自动运行
              ↓
        Supabase: ai_market_analysis 表
              ↓
        simulate-trading: 每5分钟读取 AI 分析调整交易
```

## 与云端 AI 的关系

OpenClaw Agent 和 Supabase Edge Function (`ai-market-analysis`) 是**并行运行**的：

| 来源 | 运行位置 | 频率 | 模型 |
|------|---------|------|------|
| Edge Function | Supabase 云端 | 每30分钟 | GPT-4o + Claude + Gemini + DeepSeek + Llama |
| OpenClaw Agent | Mac Mini 本地 | 每15分钟 | 本地 Ollama + 自主推理 |

两者的分析结果都写入同一个 `ai_market_analysis` 表，`simulate-trading` 会读取所有来源的最新分析。更多 AI 视角 = 更好的交易决策。
