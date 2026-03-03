import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { ArrowLeft, ArrowUpRight, DollarSign, Calendar, Disc, Headphones, Info, WalletCards } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getNodeOverview } from "@/lib/api";
import type { NodeOverview } from "@shared/types";
import { NODE_PLANS } from "@/lib/data";
import { useTranslation } from "react-i18next";

type TabKey = "purchase" | "earnings" | "detail";

export default function ProfileNodesPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;
  const [activeTab, setActiveTab] = useState<TabKey>("purchase");

  const { data: overview, isLoading } = useQuery<NodeOverview>({
    queryKey: ["node-overview", walletAddr],
    queryFn: () => getNodeOverview(walletAddr),
    enabled: isConnected,
  });

  const nodes = overview?.nodes ?? [];
  const activeCount = nodes.filter((n) => n.status === "ACTIVE" || n.status === "PENDING_MILESTONES").length;
  const totalEarnings = Number(overview?.rewards?.totalEarnings || 0);
  const releasedEarnings = Number(overview?.rewards?.fixedYield || 0);
  const firstNode = nodes.length > 0 ? nodes[0] : null;
  const daysActive = firstNode?.startDate
    ? Math.floor((Date.now() - new Date(firstNode.startDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const nodeType = (firstNode?.nodeType || "MINI") as keyof typeof NODE_PLANS;
  const totalDays = firstNode ? (NODE_PLANS[nodeType]?.durationDays || 0) : 0;

  const levelProgress = 0;
  const currentLevel = "V0";

  return (
    <div className="space-y-4 pb-24" data-testid="page-profile-nodes">
      <div className="gradient-green-dark px-4 pb-4 pt-2 rounded-b-2xl" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
        <div className="flex items-center justify-center relative mb-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate("/profile")}
            className="absolute left-0"
            data-testid="button-back-profile"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">{t("profile.nodeDetailsTitle")}</h1>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {currentLevel} ({t("profile.realLevel")})
            </span>
            <span className="text-sm font-bold">{currentLevel}</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-black/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(levelProgress, 2)}%`,
                background: "linear-gradient(90deg, #4ade80, #22c55e, #a3e635)",
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{t("profile.myNodesLabel")}</span>
              <span className="text-sm">💎 {activeCount}/{totalDays || 0}Day</span>
            </div>
            <Info className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </div>

      {!isConnected ? (
        <div className="px-4" style={{ animation: "fadeSlideIn 0.5s ease-out 0.1s both" }}>
          <div className="glass-card rounded-2xl p-6 text-center" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <WalletCards className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{t("profile.connectToViewNodes")}</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="px-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="px-4 space-y-4" style={{ animation: "fadeSlideIn 0.45s ease-out 0.1s both" }}>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="glass-card rounded-xl py-3 px-4 flex items-center justify-between transition-all active:scale-[0.98]"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                onClick={() => navigate("/profile/nodes")}
              >
                <span className="text-sm font-bold">{t("profile.applyLargeNode")}</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button
                className="glass-card rounded-xl py-3 px-4 flex items-center justify-between transition-all active:scale-[0.98]"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                onClick={() => navigate("/profile/nodes")}
              >
                <span className="text-sm font-bold">{t("profile.applySmallNode")}</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="text-[11px] text-muted-foreground -mt-1">{t("profile.contribution")}{NODE_PLANS.MAX.price}</div>
              <div className="text-[11px] text-muted-foreground -mt-1">{t("profile.contribution")}{NODE_PLANS.MINI.price}</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div
                className="glass-card rounded-xl p-4 text-center space-y-2"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-xs text-muted-foreground">{t("profile.nodeTotalAmount")} 🔊</div>
                <DollarSign className="h-6 w-6 mx-auto text-primary" />
                <div className="text-lg font-bold text-primary">${totalEarnings}</div>
              </div>
              <div
                className="glass-card rounded-xl p-4 text-center space-y-2"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-xs text-muted-foreground">{t("profile.releaseDays")}</div>
                <Calendar className="h-6 w-6 mx-auto text-primary" />
                <div className="text-lg font-bold">{daysActive}/{totalDays || 0}Day</div>
              </div>
              <div
                className="glass-card rounded-xl p-4 text-center space-y-2"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-xs text-muted-foreground">{t("profile.releasedEarnings")}</div>
                <DollarSign className="h-6 w-6 mx-auto text-primary" />
                <div className="text-lg font-bold text-primary">${releasedEarnings}</div>
              </div>
              <div
                className="glass-card rounded-xl p-4 text-center space-y-2"
                style={{ border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="text-xs text-muted-foreground">{t("profile.releaseStatus")}</div>
                <Disc className="h-6 w-6 mx-auto text-primary" />
                <div className="text-lg font-bold">--</div>
              </div>
            </div>

            <div
              className="glass-card rounded-xl px-4 py-3 flex items-center justify-between"
              style={{ border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <div className="h-3 w-3 rounded-full bg-blue-500" />
                </div>
                <span className="text-sm">
                  {t("profile.availableBalance")}：<span className="font-bold">0/0</span>
                </span>
                <Headphones className="h-4 w-4 text-muted-foreground" />
              </div>
              <button className="text-xs border border-border rounded-md px-3 py-1 text-muted-foreground hover:text-foreground transition-colors">
                {t("profile.withdrawBtn")}
              </button>
            </div>
          </div>

          <div className="px-4" style={{ animation: "fadeSlideIn 0.5s ease-out 0.15s both" }}>
            <div className="flex gap-2 mb-4">
              {([
                { key: "purchase" as TabKey, label: t("profile.purchaseRecords") },
                { key: "earnings" as TabKey, label: t("profile.earningsDetailTab") },
                { key: "detail" as TabKey, label: t("profile.myDetailTab") },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    activeTab === tab.key
                      ? "border-primary text-primary bg-primary/10"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="text-center py-12 text-muted-foreground text-sm">
              {t("profile.noData")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
