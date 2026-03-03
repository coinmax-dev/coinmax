import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { ArrowLeft, ArrowUpRight, DollarSign, Calendar, Disc, Headphones, Info, WalletCards } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getNodeOverview, getNodeEarningsRecords, getNodeMemberships } from "@/lib/api";
import type { NodeOverview, NodeEarningsRecord, NodeMembership } from "@shared/types";
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

  const { data: earningsRecords = [] } = useQuery<NodeEarningsRecord[]>({
    queryKey: ["node-earnings", walletAddr],
    queryFn: () => getNodeEarningsRecords(walletAddr),
    enabled: isConnected,
  });

  const { data: allMemberships = [] } = useQuery<NodeMembership[]>({
    queryKey: ["node-memberships", walletAddr],
    queryFn: () => getNodeMemberships(walletAddr),
    enabled: isConnected,
  });

  const nodes = overview?.nodes ?? [];
  const activeNodes = nodes.filter((n) => n.status === "ACTIVE" || n.status === "PENDING_MILESTONES");
  const activeCount = activeNodes.length;
  const totalEarnings = Number(overview?.rewards?.totalEarnings || 0);
  const releasedEarnings = Number(overview?.releasedEarnings || overview?.rewards?.fixedYield || 0);
  const availableBalance = Number(overview?.availableBalance || 0);
  const lockedEarnings = Number(overview?.lockedEarnings || 0);

  const firstNode = activeNodes.length > 0 ? activeNodes[0] : null;
  const daysActive = firstNode?.startDate
    ? Math.floor((Date.now() - new Date(firstNode.startDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const nodeType = (firstNode?.nodeType || "MINI") as keyof typeof NODE_PLANS;
  const totalDays = firstNode ? (NODE_PLANS[nodeType]?.durationDays || 0) : 0;

  const currentRank = overview?.rank || "V0";
  const rankIndex = currentRank === "V0" ? 0 : parseInt(currentRank.replace("V", "")) || 0;
  const levelProgress = Math.min((rankIndex / 7) * 100, 100);

  const releaseStatus = activeNodes.length > 0
    ? activeNodes.some((n) => n.status === "ACTIVE") ? t("profile.releasing") : t("profile.pending")
    : "--";

  const formatDate = (d: string | null) => {
    if (!d) return "--";
    return new Date(d).toLocaleDateString();
  };

  const cardBorder = "1px solid rgba(74, 222, 128, 0.15)";
  const cardBg = "rgba(10, 15, 10, 0.6)";

  return (
    <div className="min-h-screen pb-24" style={{ background: "#0a0a0a" }} data-testid="page-profile-nodes">
      <div className="px-4 pt-3 pb-4">
        <div className="flex items-center justify-center relative mb-6">
          <button
            onClick={() => navigate("/profile")}
            className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <h1 className="text-[17px] font-bold tracking-wide">{t("profile.nodeDetailsTitle")}</h1>
        </div>

        <div className="space-y-3 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-white/50">
              {currentRank} ({t("profile.realLevel")})
            </span>
            <span className="text-[13px] font-bold text-white/90">{currentRank}</span>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${Math.max(levelProgress, 3)}%`,
                background: "linear-gradient(90deg, #22c55e, #84cc16, #eab308)",
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-white/90">{t("profile.myNodesLabel")}</span>
              <span className="text-[13px] text-white/60">🟡 {activeCount}/{totalDays || 0}Day</span>
            </div>
            <Info className="h-4 w-4 text-white/30" />
          </div>
        </div>
      </div>

      {!isConnected ? (
        <div className="px-4">
          <div className="rounded-2xl p-8 text-center" style={{ border: cardBorder, background: cardBg }}>
            <WalletCards className="h-8 w-8 text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/40">{t("profile.connectToViewNodes")}</p>
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
          <div className="px-4 space-y-4">
            <div className="rounded-2xl p-4 space-y-4" style={{ border: cardBorder, background: cardBg }}>
              <div className="grid grid-cols-2 gap-3">
                <button
                  className="rounded-full py-2.5 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.97]"
                  style={{ border: "1px solid rgba(74, 222, 128, 0.3)", background: "rgba(74, 222, 128, 0.06)" }}
                  onClick={() => navigate("/profile/nodes")}
                >
                  <span className="text-[13px] font-bold text-white/90">{t("profile.applyLargeNode")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-primary/70" />
                </button>
                <button
                  className="rounded-full py-2.5 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.97]"
                  style={{ border: "1px solid rgba(74, 222, 128, 0.3)", background: "rgba(74, 222, 128, 0.06)" }}
                  onClick={() => navigate("/profile/nodes")}
                >
                  <span className="text-[13px] font-bold text-white/90">{t("profile.applySmallNode")}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-primary/70" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center -mt-1">
                <span className="text-[11px] text-white/35">{t("profile.contribution")} {NODE_PLANS.MAX.price}</span>
                <span className="text-[11px] text-white/35">{t("profile.contribution")} {NODE_PLANS.MINI.price}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  className="rounded-xl p-4 text-center space-y-2"
                  style={{ border: cardBorder, background: "rgba(5,10,5,0.5)" }}
                >
                  <div className="text-[12px] text-white/45 font-medium">{t("profile.nodeTotalAmount")} 🔊</div>
                  <DollarSign className="h-6 w-6 mx-auto text-white/70" />
                  <div className="text-lg font-bold text-primary">${totalEarnings.toFixed(0)}</div>
                </div>
                <div
                  className="rounded-xl p-4 text-center space-y-2"
                  style={{ border: cardBorder, background: "rgba(5,10,5,0.5)" }}
                >
                  <div className="text-[12px] text-white/45 font-medium">{t("profile.releaseDays")}</div>
                  <Calendar className="h-6 w-6 mx-auto text-white/70" />
                  <div className="text-lg font-bold text-white/90">{daysActive}/{totalDays || 0}Day</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  className="rounded-xl p-4 text-center space-y-2"
                  style={{ border: cardBorder, background: "rgba(5,10,5,0.5)" }}
                >
                  <div className="text-[12px] text-white/45 font-medium">{t("profile.releasedEarnings")}</div>
                  <DollarSign className="h-6 w-6 mx-auto text-white/70" />
                  <div className="text-lg font-bold text-primary">${releasedEarnings.toFixed(0)}</div>
                </div>
                <div
                  className="rounded-xl p-4 text-center space-y-2"
                  style={{ border: cardBorder, background: "rgba(5,10,5,0.5)" }}
                >
                  <div className="text-[12px] text-white/45 font-medium">{t("profile.releaseStatus")}</div>
                  <Disc className="h-6 w-6 mx-auto text-white/70" />
                  <div className="text-lg font-bold text-white/90">{releaseStatus}</div>
                </div>
              </div>

              <div
                className="rounded-xl px-4 py-3 flex items-center justify-between"
                style={{ border: cardBorder, background: "rgba(5,10,5,0.5)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-white/50">{t("profile.availableBalance")}:</span>
                  <span className="text-[13px] font-bold text-white/90">${availableBalance.toFixed(0)}/${lockedEarnings.toFixed(0)}</span>
                  <Headphones className="h-3.5 w-3.5 text-white/30" />
                </div>
                <button
                  className="text-[12px] rounded-md px-3 py-1 text-white/50 transition-colors hover:text-white/80"
                  style={{ border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  {t("profile.withdrawBtn")}
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              {([
                { key: "purchase" as TabKey, label: t("profile.purchaseRecords") },
                { key: "earnings" as TabKey, label: t("profile.earningsDetailTab") },
                { key: "detail" as TabKey, label: t("profile.myDetailTab") },
              ]).map((tab) => (
                <button
                  key={tab.key}
                  className="px-4 py-2 rounded-lg text-[13px] font-medium transition-all"
                  style={{
                    border: activeTab === tab.key
                      ? "1px solid rgba(74, 222, 128, 0.5)"
                      : "1px solid rgba(255,255,255,0.1)",
                    color: activeTab === tab.key ? "#4ade80" : "rgba(255,255,255,0.4)",
                    background: activeTab === tab.key ? "rgba(74, 222, 128, 0.08)" : "transparent",
                  }}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "purchase" && (
              <div className="space-y-2">
                {allMemberships.length === 0 ? (
                  <div className="text-center py-16 text-white/25 text-[14px] italic">
                    {t("profile.noData")}
                  </div>
                ) : (
                  allMemberships.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-xl p-3 space-y-1.5"
                      style={{ border: cardBorder, background: cardBg }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-white/90">
                          {m.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                          m.status === "ACTIVE" ? "bg-green-500/15 text-green-400" :
                          m.status === "PENDING_MILESTONES" ? "bg-yellow-500/15 text-yellow-400" :
                          m.status === "CANCELLED" ? "bg-red-500/15 text-red-400" :
                          "bg-white/5 text-white/30"
                        }`}>
                          {m.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] text-white/35">
                        <span>{t("profile.contribution")}: ${Number(m.contributionAmount || m.depositAmount || 0).toFixed(0)}</span>
                        <span>{t("profile.frozenFunds")}: ${Number(m.frozenAmount || 0).toLocaleString()}</span>
                        <span>{t("profile.startDate")}: {formatDate(m.startDate)}</span>
                        <span>{t("profile.endDate")}: {formatDate(m.endDate)}</span>
                      </div>
                      {m.milestones && m.milestones.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {m.milestones.map((ms, i) => (
                            <span
                              key={i}
                              className={`text-[10px] px-1.5 py-0.5 rounded ${
                                ms.status === "ACHIEVED" ? "bg-green-500/15 text-green-400" :
                                ms.status === "FAILED" ? "bg-red-500/15 text-red-400" :
                                "bg-white/5 text-white/30"
                              }`}
                            >
                              {ms.requiredRank} ({ms.deadlineDays}d)
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "earnings" && (
              <div className="space-y-2">
                {earningsRecords.length === 0 ? (
                  <div className="text-center py-16 text-white/25 text-[14px] italic">
                    {t("profile.noData")}
                  </div>
                ) : (
                  earningsRecords.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl p-3 flex items-center justify-between"
                      style={{ border: cardBorder, background: cardBg }}
                    >
                      <div>
                        <div className="text-[13px] font-medium text-white/80">
                          {r.rewardType === "FIXED_YIELD" ? t("profile.dailyEarnings") :
                           r.rewardType === "POOL_DIVIDEND" ? t("profile.poolDividend") :
                           t("profile.teamCommission")}
                        </div>
                        <div className="text-[11px] text-white/30">
                          {r.details?.node_type || "--"} · {formatDate(r.createdAt)}
                        </div>
                      </div>
                      <div className="text-[13px] font-bold text-primary">
                        +${Number(r.amount || 0).toFixed(4)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "detail" && (
              <div className="space-y-2">
                {activeNodes.length === 0 ? (
                  <div className="text-center py-16 text-white/25 text-[14px] italic">
                    {t("profile.noData")}
                  </div>
                ) : (
                  activeNodes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl p-3 space-y-2"
                      style={{ border: cardBorder, background: cardBg }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-white/90">
                          {n.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                          n.status === "ACTIVE" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"
                        }`}>
                          {n.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[11px] text-white/35">
                        <span>{t("profile.frozenFunds")}: ${Number(n.frozenAmount || 0).toLocaleString()}</span>
                        <span>{t("profile.dailyEarnings")}: {(Number(n.dailyRate || 0) * 100).toFixed(1)}%</span>
                        <span>{t("profile.milestoneSchedule")}: {n.milestoneStage}/{n.totalMilestones}</span>
                        <span>{t("profile.earningsCapacity")}: {(Number(n.earningsCapacity || 0) * 100).toFixed(0)}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${n.totalMilestones > 0 ? (n.milestoneStage / n.totalMilestones) * 100 : 0}%`,
                            background: "linear-gradient(90deg, #22c55e, #84cc16)",
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
