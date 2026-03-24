/**
 * Telegram Bind Dialog — Verify code to link Telegram for trade notifications
 */

import { useState } from "react";
import { MessageCircle, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";

interface TelegramBindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  walletAddress: string;
}

export function TelegramBindDialog({ open, onOpenChange, walletAddress }: TelegramBindDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const handleBind = async () => {
    if (!walletAddress || code.length < 6) return;
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-bind?action=verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ wallet: walletAddress, code: code.toUpperCase() }),
        }
      );
      const result = await res.json();
      if (result.error) throw new Error(result.error);

      toast({ title: "绑定成功", description: "Telegram 通知已开启" });
      onOpenChange(false);
      setCode("");
    } catch (e: any) {
      toast({ title: "绑定失败", description: e.message || "验证码无效或已过期", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center" style={{ boxShadow: "0 0 12px rgba(59,130,246,0.3)" }}>
              <MessageCircle className="h-4 w-4 text-white" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">绑定 Telegram</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">
                接收跟单信号和盈亏通知
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="border-border bg-background">
            <CardContent className="p-3">
              <div className="space-y-2 text-[12px] text-muted-foreground">
                <div className="flex items-start gap-2">
                  <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">1</span>
                  <span>打开 Telegram 搜索 <b>@coinmax_openclaw_bot</b></span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">2</span>
                  <span>发送 <code className="bg-primary/10 px-1 rounded">/bind</code> 获取验证码</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-primary/20 text-primary rounded-full h-4 w-4 flex items-center justify-center shrink-0 text-[11px] font-bold">3</span>
                  <span>在下方输入验证码完成绑定</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">验证码</label>
            <Input
              placeholder="输入6位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="text-xs font-mono tracking-widest text-center text-lg"
              maxLength={6}
            />
          </div>

          <div className="space-y-1 text-[12px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>新开仓信号推送</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>平仓盈亏通知</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
              <span>风险预警提醒</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            className="bg-gradient-to-r from-blue-600 to-indigo-500 border-blue-500/50 text-white"
            disabled={loading || code.length < 6}
            onClick={handleBind}
          >
            <MessageCircle className="mr-1 h-4 w-4" />
            {loading ? "验证中..." : "绑定 Telegram"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
