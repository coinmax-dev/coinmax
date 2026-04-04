import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Telegram Bind — Two endpoints:
 *
 * 1. POST /telegram-bind (Telegram webhook)
 *    User sends /bind to bot → generates 6-digit code
 *
 * 2. POST /telegram-bind?action=verify
 *    Frontend sends { wallet, code } → verifies and binds
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "8707941134:AAHVuVgFSv4x1DsesARmLtPLT3x_RVhQO9I";
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── Frontend verify: bind telegram to wallet ──
  if (action === "verify") {
    try {
      const { wallet, code } = await req.json();
      if (!wallet || !code) {
        return json({ error: "Missing wallet or code" }, 400);
      }

      // Find valid code
      const { data: bind, error } = await supabase
        .from("telegram_bind_codes")
        .select("*")
        .eq("code", code.toUpperCase())
        .is("used_by", null)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (error || !bind) {
        return json({ error: "验证码无效或已过期" }, 400);
      }

      // Bind to profile
      await supabase.from("profiles").update({
        telegram_chat_id: bind.chat_id,
        telegram_username: bind.username,
        telegram_verified_at: new Date().toISOString(),
      }).ilike("wallet_address", wallet);

      // Mark code as used
      await supabase.from("telegram_bind_codes").update({
        used_by: wallet,
      }).eq("id", bind.id);

      // Send confirmation to Telegram
      await sendTg(bind.chat_id, `✅ 绑定成功！\n\n钱包: ${wallet.slice(0, 6)}...${wallet.slice(-4)}\n\n您将收到跟单交易信号通知。`);

      return json({ ok: true, username: bind.username });
    } catch (e: any) {
      return json({ error: e.message }, 500);
    }
  }

  // ── Frontend unbind ──
  if (action === "unbind") {
    try {
      const { wallet } = await req.json();
      if (!wallet) return json({ error: "Missing wallet" }, 400);

      const { data: profile } = await supabase
        .from("profiles")
        .select("telegram_chat_id")
        .ilike("wallet_address", wallet)
        .single();

      if (profile?.telegram_chat_id) {
        await sendTg(profile.telegram_chat_id, "❌ 您的 Telegram 已与 CoinMax 解绑。");
      }

      await supabase.from("profiles").update({
        telegram_chat_id: null,
        telegram_username: null,
        telegram_verified_at: null,
      }).ilike("wallet_address", wallet);

      return json({ ok: true });
    } catch (e: any) {
      return json({ error: e.message }, 500);
    }
  }

  // ── Telegram Webhook: bot receives messages ──
  try {
    const update = await req.json();
    const message = update.message;
    if (!message?.text) return json({ ok: true });

    const chatId = String(message.chat.id);
    const username = message.from?.username || "";
    const text = message.text.trim();

    if (text === "/start" || text === "/bind") {
      // Generate 6-digit alphanumeric code
      const code = generateCode();

      // Clean up old codes for this chat
      await supabase.from("telegram_bind_codes")
        .delete()
        .eq("chat_id", chatId)
        .is("used_by", null);

      // Save new code
      await supabase.from("telegram_bind_codes").insert({
        code,
        chat_id: chatId,
        username,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });

      await sendTg(chatId, `🔐 <b>CoinMax 绑定验证码</b>\n\n<code>${code}</code>\n\n请在 CoinMax 跟单设置页面输入此验证码完成绑定。\n⏰ 10分钟内有效。`);

    } else if (text === "/status") {
      // Check if bound
      const { data } = await supabase
        .from("profiles")
        .select("wallet_address, telegram_verified_at")
        .eq("telegram_chat_id", chatId)
        .single();

      if (data) {
        await sendTg(chatId, `✅ 已绑定\n\n钱包: ${data.wallet_address.slice(0, 6)}...${data.wallet_address.slice(-4)}\n绑定时间: ${data.telegram_verified_at}`);
      } else {
        await sendTg(chatId, `❌ 未绑定\n\n发送 /bind 获取验证码。`);
      }

    } else if (text === "/help") {
      await sendTg(chatId, `🤖 <b>CoinMax AI 跟单 Bot</b>\n\n/bind — 获取绑定验证码\n/status — 查看绑定状态\n/help — 帮助\n\n绑定后您将收到:\n📊 开仓信号通知\n✅ 平仓盈亏通知`);

    } else {
      await sendTg(chatId, `发送 /bind 获取绑定验证码\n发送 /help 查看帮助`);
    }

    return json({ ok: true });
  } catch (e: any) {
    console.error("Webhook error:", e);
    return json({ ok: true }); // always 200 for Telegram
  }
});

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1 to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function sendTg(chatId: string, text: string) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
