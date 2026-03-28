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
  DEPOSIT: "bg-primary/15 text-primary",
  VAULT_DEPOSIT: "bg-cyan-500/15 text-cyan-400",
  WITHDRAW: "bg-red-500/15 text-red-400",
  VAULT_REDEEM: "bg-orange-500/15 text-orange-400",
  YIELD: "bg-blue-500/15 text-blue-400",
  YIELD_CLAIM: "bg-emerald-500/15 text-emerald-400",
  VIP_PURCHASE: "bg-purple-500/15 text-purple-400",
  NODE_PURCHASE: "bg-amber-500/15 text-amber-400",
  REWARD: "bg-green-500/15 text-green-400",
  COMPLETED: "bg-primary/15 text-primary",
  CONFIRMED: "bg-primary/15 text-primary",
};

const TX_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: "入金",
  VAULT_DEPOSIT: "金库存入",
  WITHDRAW: "提取",
  VAULT_REDEEM: "金库赎回",
  YIELD: "收益",
  YIELD_CLAIM: "收益提取",
  VIP_PURCHASE: "VIP购买",
  NODE_PURCHASE: "节点购买",
  REWARD: "奖励",
};

const FILTERS = [
  { key: "ALL", label: "全部" },
  { key: "DEPOSIT,VAULT_DEPOSIT", label: "入金" },
  { key: "VIP_PURCHASE,NODE_PURCHASE", label: "购买" },
  { key: "YIELD,YIELD_CLAIM", label: "收益提取" },
  { key: "REWARD", label: "奖励" },
  { key: "WITHDRAW,VAULT_REDEEM", label: "赎回/提取" },
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
          {FILTERS.map(f => (
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
              {f.label}
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
              const typeLabel = TX_TYPE_LABELS[tx.type] || tx.type;
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
                            ? "bg-primary/15 text-primary"
                            : "bg-yellow-500/15 text-yellow-400"
                        }`}>
                          {tx.status}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString("zh-CN") : "--"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[9px] border-yellow-500/30 text-yellow-400 no-default-hover-elevate no-default-active-elevate">
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
