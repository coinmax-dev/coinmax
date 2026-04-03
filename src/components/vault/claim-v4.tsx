import { useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";

/**
 * V4 Claim — Withdraw from 待释放余额
 *
 * User selects split ratio → POST /claim-v4
 * Engine: mint MA → burn 0-20% → linear release remaining
 *
 * No direct contract call from user.
 */

const SPLIT_RATIOS = [
  { key: "A", burnPct: 0, days: 60, label: "0% 销毁 / 60天释放" },
  { key: "B", burnPct: 5, days: 45, label: "5% 销毁 / 45天释放" },
  { key: "C", burnPct: 10, days: 30, label: "10% 销毁 / 30天释放" },
  { key: "D", burnPct: 20, days: 14, label: "20% 销毁 / 14天释放" },
];

export function ClaimV4() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { toast } = useToast();
  const [selectedRatio, setSelectedRatio] = useState(SPLIT_RATIOS[2]); // default C
  const [amount, setAmount] = useState("");

  const amountNum = parseFloat(amount) || 0;
  const walletAddr = account?.address || "";

  // Get available balance from DB (via API)
  const { data: releaseBalance } = useQuery({
    queryKey: ["release-balance", walletAddr],
    queryFn: async () => {
      // TODO: Add API endpoint to get user's released balance
      // For now return 0
      return { released: 0, locked: 0, total: 0 };
    },
    enabled: !!walletAddr,
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/claim-v4`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: walletAddr,
          amount: amountNum,
          splitRatio: selectedRatio.key,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Claim failed");
      return data;
    },
    onSuccess: (data) => {
      setAmount("");
      toast({
        title: t("claim.success", "提现成功"),
        description: t("claim.detail", "销毁 {{burned}} MA, {{released}} MA 将在 {{days}} 天内释放", {
          burned: data.burned?.toFixed(2),
          released: data.released?.toFixed(2),
          days: selectedRatio.days,
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["release-balance"] });
    },
    onError: (err: Error) => {
      toast({ title: t("claim.failed", "提现失败"), description: err.message, variant: "destructive" });
    },
  });

  if (!account) return null;

  const available = releaseBalance?.released || 0;
  const isValid = amountNum > 0 && amountNum <= available;
  const burnAmount = amountNum * selectedRatio.burnPct / 100;
  const releaseAmount = amountNum - burnAmount;
  const dailyRelease = releaseAmount / selectedRatio.days;

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-bold">{t("claim.title", "提现 (待释放余额)")}</h3>

      {/* Available balance */}
      <div className="p-3 rounded-xl bg-white/5">
        <div className="flex justify-between text-sm">
          <span className="text-white/50">{t("claim.available", "可提现余额")}</span>
          <span className="font-bold text-green-400">{available.toFixed(2)} MA</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-white/50">{t("claim.locked", "锁仓中")}</span>
          <span>{(releaseBalance?.locked || 0).toFixed(2)} MA</span>
        </div>
      </div>

      {/* Amount */}
      <div className="relative">
        <input
          type="number"
          placeholder={t("claim.inputAmount", "输入提现金额")}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white pr-16"
        />
        <button
          onClick={() => setAmount(String(available))}
          className="absolute right-2 top-2 text-xs text-green-400 px-2 py-1 rounded bg-green-400/10"
        >
          {t("common.max", "全部")}
        </button>
      </div>

      {/* Split ratio selection */}
      <div className="space-y-2">
        <p className="text-xs text-white/50">{t("claim.selectRatio", "选择收益分成比例")}</p>
        {SPLIT_RATIOS.map((ratio) => (
          <button
            key={ratio.key}
            onClick={() => setSelectedRatio(ratio)}
            className={`w-full p-3 rounded-xl border text-left text-sm ${
              selectedRatio.key === ratio.key
                ? "border-green-500 bg-green-500/10"
                : "border-white/10"
            }`}
          >
            <div className="flex justify-between">
              <span className="font-bold">{t("claim.plan", "方案")} {ratio.key}</span>
              <span className="text-white/50">{ratio.label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Preview */}
      {amountNum > 0 && (
        <div className="p-3 rounded-xl bg-white/5 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-white/50">{t("claim.total", "提现总额")}</span>
            <span>{amountNum.toFixed(2)} MA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-400">{t("claim.burn", "销毁")} ({selectedRatio.burnPct}%)</span>
            <span className="text-red-400">-{burnAmount.toFixed(2)} MA</span>
          </div>
          <div className="flex justify-between font-bold">
            <span className="text-green-400">{t("claim.receive", "实际释放")}</span>
            <span className="text-green-400">{releaseAmount.toFixed(2)} MA</span>
          </div>
          <div className="flex justify-between text-white/40">
            <span>{t("claim.daily", "每日释放")}</span>
            <span>{dailyRelease.toFixed(2)} MA / {selectedRatio.days}{t("common.days", "天")}</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        className="w-full p-3 rounded-xl bg-green-500 text-white font-bold disabled:opacity-40"
        disabled={!isValid || claimMutation.isPending}
        onClick={() => claimMutation.mutate()}
      >
        {claimMutation.isPending
          ? t("common.processing", "处理中...")
          : t("claim.submit", "确认提现")}
      </button>
    </div>
  );
}
