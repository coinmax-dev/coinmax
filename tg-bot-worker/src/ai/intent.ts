import type { Env, BotUser } from "../types";
import { chat } from "./openai";
import { hasPermission } from "../auth";

export interface ParsedIntent {
  tool: string;
  params: Record<string, string>;
  confirmRequired: boolean;
  rawIntent: string;
}

const TOOL_DESCRIPTIONS = `
Available tools (respond with JSON):
- query_user: 查询用户完整信息(金库+节点+交易) {wallet: "0x..." or wallets: "0x...,0x..."} — requires: query. 支持多个地址逗号分隔
- query_vault: 查询金库入金详情 {wallet?: "0x...", summary?: "true"} — requires: query. 不传wallet返回全局总览（按方案统计+最近入金）; 传wallet返回该用户所有仓位+入金记录+赠送仓位+收益锁定状态
- query_node: 查询节点+激活状态 {wallet?: "0x...", summary?: "true"} — requires: query. 不传wallet返回全局总览（激活率+等级分布）; 传wallet返回节点详情+激活等级+收益容量+里程碑+团队数据
- query_transaction: 查询交易记录 {wallet?: "0x...", type?: "VAULT_DEPOSIT"|"NODE_PURCHASE", limit?: 10} — requires: query
- create_node: 创建节点订单 {wallet: "0x...", nodeType: "MAX"|"MINI", tag?: "string"} — requires: create_node, CONFIRM
- modify_data: 修改数据库 {table: "...", id: "...", updates: {...}} — requires: modify, CONFIRM
- submit_ticket: 提交工单 {title: "...", description: "...", priority?: "critical"|"high"|"medium"|"low", category?: "bug"|"feature"|"inquiry"} — requires: tickets
- list_tickets: 查看工单 {status?: "open"|"in_progress", assignedToMe?: true} — requires: tickets
- assign_ticket: 分配工单 {ticketId: "...", assignTo: telegram_chat_id} — requires: assign_tickets, CONFIRM
- view_logs: 查看操作日志 {action?: "...", limit?: 20} — requires: view_logs
- diagnose: 系统诊断 {check?: "funds"|"crons"|"health"|"all"} — requires: diagnose
- bridge_flush: 触发跨链分配 {} — requires: bridge, CONFIRM
- manage_role: 管理Bot角色 {chatId: number, role: "admin"|"engineer"|"support"|"customer"} — requires: manage_roles, CONFIRM
- chat: 普通对话/问答 {message: "..."} — no special permission
- vision: 图片/文档识别 — auto-detected from media
`;

export async function parseIntent(env: Env, user: BotUser, message: string, conversationHistory: string): Promise<ParsedIntent> {
  const permList = Object.entries({
    query: hasPermission(user.role, "query") || hasPermission(user.role, "query_masked"),
    create_node: hasPermission(user.role, "create_node"),
    modify: hasPermission(user.role, "modify"),
    tickets: hasPermission(user.role, "tickets"),
    assign_tickets: hasPermission(user.role, "assign_tickets"),
    view_logs: hasPermission(user.role, "view_logs"),
    diagnose: hasPermission(user.role, "diagnose"),
    bridge: hasPermission(user.role, "bridge"),
    manage_roles: hasPermission(user.role, "manage_roles"),
  }).filter(([, v]) => v).map(([k]) => k);

  // Pre-parse: extract wallet addresses
  const walletMatches = message.match(/0x[a-fA-F0-9]{40}/g);
  const walletsHint = walletMatches?.length
    ? `\nDetected wallets: ${walletMatches.join(", ")}\nUse query_user with wallet="${walletMatches.join(",")}" to check all at once.`
    : "";

  const prompt = `You are an intent parser for CoinMax admin bot.
User role: ${user.role} (permissions: ${permList.join(", ")})

Recent conversation:
${conversationHistory}

${TOOL_DESCRIPTIONS}
${walletsHint}

Rules:
- 0x addresses + "查", "看", "数据", "信息", "有没有" → query_user (full user info)
- "金库", "入金", "存入", "仓位" → query_vault (金库入金详情)
- "节点", "激活", "activation" → query_node (节点+激活状态)
- "金库总览", "入金统计" (no wallet) → query_vault with summary=true
- "节点总览", "激活统计" (no wallet) → query_node with summary=true
- "补充", "创建", "添加", "开通" + "节点" → create_node (confirmRequired=true)
- Multiple addresses: put all in wallet param comma-separated for query_user
- For modifications (create/update/delete), ALWAYS set confirmRequired=true
- If no permission → "chat" and explain
- General questions → "chat"
- Use conversation context: if previous message was about an address, carry forward

Respond ONLY with valid JSON: {"tool":"...","params":{...},"confirmRequired":false,"rawIntent":"简短中文描述"}

User message: ${message}`;

  const result = await chat(env, [
    { role: "system", content: prompt },
  ], { temperature: 0.1, maxTokens: 500 });

  try {
    const cleaned = result.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { tool: "chat", params: { message }, confirmRequired: false, rawIntent: message };
  }
}
