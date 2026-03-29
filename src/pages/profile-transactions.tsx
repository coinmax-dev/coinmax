import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { formatCompact } from "@/lib/constants";
import { ArrowLeft, Calendar, WalletCards, ExternalLink, Link, Filter } from "lucide-react";
import { shortenAddress } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getTransactions } from "@/lib/api";
import type { Transaction } from "@shared/types";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const TX_TYPE_COLORS: Record<string, string> = {
  DEPOSIT: "bg-foreground/8 text-foreground/60",
  VAULT_DEPOSIT: "bg-foreground/8 text-foreground/60",
  WITHDRAW: "bg-foreground/8 text-foreground/60",
  VAULT_REDEEM: "bg-foreground/8 text-foreground/60",
  YIELD: "bg-foreground/8 text-foreground/60",
  YIELD_CLAIM: "bg-foreground/8 text-foreground/60",
  VIP_PURCHASE: "bg-foreground/8 text-foreground/60",
  NODE_PURCHASE: "bg-foreground/8 text-foreground/60",
  REWARD: "bg-foreground/8 text-foreground/60",
  TEAM_COMMISSION: "bg-foreground/8 text-foreground/60",
  DIRECT_REFERRAL: "bg-foreground/8 text-foreground/60",
  FIXED_YIELD: "bg-foreground/8 text-foreground/60",
  REWARD_RELEASE: "bg-foreground/8 text-foreground/60",
  COMPLETED: "bg-foreground/8 text-foreground/60",
  BONUS_GRANT: "bg-foreground/8 text-foreground/60",
  CONFIRMED: "bg-foreground/8 text-foreground/60",
};

// Labels resolved at render time via t()
const TX_TYPE_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
  DEPOSIT: { key: "tx.deposit", fallback: "入金" },
  VAULT_DEPOSIT: { key: "tx.vaultDeposit", fallback: "金库存入" },
  WITHDRAW: { key: "tx.withdraw", fallback: "提取" },
  VAULT_REDEEM: { key: "tx.vaultRedeem", fallback: "金库赎回" },
  YIELD: { key: "tx.yield", fallback: "收益" },
  YIELD_CLAIM: { key: "tx.yieldClaim", fallback: "收益提取" },
  VIP_PURCHASE: { key: "tx.vipPurchase", fallback: "VIP购买" },
  NODE_PURCHASE: { key: "tx.nodePurchase", fallback: "节点购买" },
  REWARD: { key: "tx.reward", fallback: "奖励" },
  TEAM_COMMISSION: { key: "tx.teamCommission", fallback: "团队奖励" },
  DIRECT_REFERRAL: { key: "tx.directReferral", fallback: "直推奖励" },
  FIXED_YIELD: { key: "tx.fixedYield", fallback: "节点收益" },
  REWARD_RELEASE: { key: "tx.rewardRelease", fallback: "释放到账" },
  BONUS_GRANT: { key: "tx.bonusGrant", fallback: "体验金赠送" },
};

const FILTER_KEYS = [
  { key: "ALL", labelKey: "common.all", fallback: "全部" },
  { key: "DEPOSIT,VAULT_DEPOSIT", labelKey: "tx.filterDeposit", fallback: "入金" },
  { key: "VIP_PURCHASE,NODE_PURCHASE", labelKey: "tx.filterPurchase", fallback: "购买" },
  { key: "YIELD,YIELD_CLAIM", labelKey: "tx.filterYield", fallback: "收益提取" },
  { key: "DIRECT_REFERRAL", labelKey: "tx.filterDirect", fallback: "直推奖励" },
  { key: "TEAM_COMMISSION", labelKey: "tx.filterTeam", fallback: "团队奖励" },
  { key: "FIXED_YIELD", labelKey: "tx.filterNode", fallback: "节点收益" },
  { key: "WITHDRAW,VAULT_REDEEM", labelKey: "tx.filterRedeem", fallback: "赎回/提取" },
];

export default function ProfileTransactionsPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;
  const [activeFilter, setActiveFilter] = useState("ALL");

  const { data: transactions = [], isLoading: txLoading } = useQuery<Transaction[]>({
    queryKey: ["transactions", walletAddr],
    queryFn: () => getTransactions(walletAddr),
    enabled: isConnected,
  });

  // Filter transactions
  const filtered = activeFilter === "ALL"
    ? transactions
    : transactions.filter(tx => activeFilter.split(",").includes(tx.type));

  return (
    <div className="space-y-4 pb-24 lg:pb-8 lg:pt-4" data-testid="page-profile-transactions">
      <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl lg:rounded-none lg:bg-transparent lg:p-0 lg:pt-2 lg:px-6" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <Button size="icon" variant="ghost" onClick={() => navigate("/profile")} data-testid="button-back-profile" className="lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-bold">{t("profile.transactionHistory")}</h1>
        </div>
      </div>

      {/* Filter tabs */}
      {isConnected && (
        <div className="px-4 flex gap-1.5 overflow-x-auto pb-1" style={{ animation: "fadeSlideIn 0.4s ease-out 0.05s both" }}>
          {FILTER_KEYS.map(f => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                activeFilter === f.key
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "bg-white/[0.03] text-foreground/30 border border-white/[0.06] hover:text-foreground/50"
              )}
            >
              {t(f.labelKey, f.fallback)}
            </button>
          ))}
        </div>
      )}

      <div className="px-4" style={{ animation: "fadeSlideIn 0.5s ease-out 0.1s both" }}>
        {!isConnected ? (
          <Card className="border-border bg-card border-dashed">
            <CardContent className="p-6 text-center">
              <WalletCards className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t("profile.connectToViewTransactions")}</p>
            </CardContent>
          </Card>
        ) : txLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="p-6 text-center">
              <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{t("profile.noTransactions")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((tx) => {
              const explorerUrl = tx.txHash && !tx.txHash.startsWith("trial") && !tx.txHash.startsWith("yield_") && !tx.txHash.startsWith("redeem_")
                ? `https://bscscan.com/tx/${tx.txHash}`
                : null;
              const typeCfg = TX_TYPE_LABEL_KEYS[tx.type];
              const typeLabel = typeCfg ? t(typeCfg.key, typeCfg.fallback) : tx.type;
              return (
                <Card key={tx.id} className="border-border bg-card">
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                        <Badge className={`text-[10px] shrink-0 no-default-hover-elevate no-default-active-elevate ${TX_TYPE_COLORS[tx.type] || "bg-muted text-muted-foreground"}`}>
                          {typeLabel}
                        </Badge>
                        <span className="text-xs font-bold text-neon-value font-mono">
                          {formatCompact(Number(tx.amount))} {tx.token}
                        </span>
                        <Badge className={`text-[9px] shrink-0 no-default-hover-elevate no-default-active-elevate ${
                          tx.status === "CONFIRMED" || tx.status === "COMPLETED"
                            ? "bg-foreground/8 text-foreground/50"
                            : "bg-foreground/5 text-foreground/30"
                        }`}>
                          {tx.status}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("zh-CN") : "--"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] border-foreground/10 text-foreground/40 no-default-hover-elevate no-default-active-elevate">
                        <Link className="h-2 w-2 mr-0.5" />BSC
                      </Badge>
                      {explorerUrl ? (
                        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-primary/60 hover:text-primary flex items-center gap-0.5">
                          {shortenAddress(tx.txHash!)} <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">-</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
