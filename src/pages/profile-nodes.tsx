import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useActiveAccount } from "thirdweb/react";
import { ArrowLeft, ArrowUpRight, Calendar, WalletCards, Coins, AlertTriangle, Landmark } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getNodeOverview, getNodeEarningsRecords, getNodeMemberships, getNodeMilestoneRequirements } from "@/lib/api";
import type { NodeOverview, NodeEarningsRecord, NodeMembership } from "@shared/types";
import { NODE_PLANS, NODE_MILESTONES } from "@/lib/data";
import { useTranslation } from "react-i18next";
import { useMaPrice } from "@/hooks/use-ma-price";
import { NodePurchaseDialog } from "@/components/nodes/node-purchase-section";

type TabKey = "purchase" | "earnings" | "detail";

function getMilestoneDaysLeft(startDate: string | null, deadlineDays: number): number {
  if (!startDate) return deadlineDays;
  const start = new Date(startDate).getTime();
  const deadline = start + deadlineDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return Math.max(0, Math.ceil((deadline - now) / (1000 * 60 * 60 * 24)));
}

export default function ProfileNodesPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;
  const [activeTab, setActiveTab] = useState<TabKey>("purchase");
  const { formatMA, formatCompactMA } = useMaPrice();
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [purchaseNodeType, setPurchaseNodeType] = useState<"MAX" | "MINI">("MAX");
  const [showRequirementDialog, setShowRequirementDialog] = useState(false);
  const [requirementDialogData, setRequirementDialogData] = useState<{
    rank: string;
    holdingRequired: number;
    referralsRequired: number;
    currentHolding: number;
    currentReferrals: number;
  } | null>(null);

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

  const { data: requirements } = useQuery<{ vaultDeposited: number; directNodeReferrals: number }>({
    queryKey: ["node-milestone-requirements", walletAddr],
    queryFn: () => getNodeMilestoneRequirements(walletAddr),
    enabled: isConnected,
  });

  const vaultDeposited = requirements?.vaultDeposited ?? 0;
  const directNodeReferrals = requirements?.directNodeReferrals ?? 0;

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
  const milestones = NODE_MILESTONES[nodeType] || [];

  const currentRank = overview?.rank || "V0";

  const releaseStatus = activeNodes.length > 0
    ? activeNodes.some((n) => n.status === "ACTIVE") ? t("profile.releasing") : t("profile.pending")
    : "--";

  const formatDate = (d: string | null) => {
    if (!d) return "--";
    return new Date(d).toLocaleDateString();
  };

  const milestoneStates = milestones.map((ms, idx) => {
    const daysLeft = getMilestoneDaysLeft(firstNode?.startDate ?? null, ms.days);
    const dbMilestone = firstNode?.milestones?.find((m: any) => m.requiredRank === ms.rank) ?? firstNode?.milestones?.[idx];
    const isAchieved = dbMilestone?.status === "ACHIEVED";
    const isFailed = dbMilestone?.status === "FAILED";
    const isExpired = !isAchieved && daysLeft === 0;
    const prevMs = idx > 0 ? milestones[idx - 1] : null;
    const prevDbMilestone = prevMs ? (firstNode?.milestones?.find((m: any) => m.requiredRank === prevMs.rank) ?? firstNode?.milestones?.[idx - 1]) : null;
    const isCurrent = !isAchieved && !isFailed && !isExpired && (idx === 0 || prevDbMilestone?.status === "ACHIEVED");
    const holdingOk = nodeType === "MAX" ? vaultDeposited >= ms.requiredHolding : true;
    const referralsOk = ms.requiredReferrals === 0 || directNodeReferrals >= ms.requiredReferrals;
    const requirementsMet = holdingOk && referralsOk;
    const hasRequirements = ms.requiredHolding > 0 || ms.requiredReferrals > 0;
    return { ...ms, daysLeft, isAchieved, isFailed, isExpired, isCurrent, holdingOk, referralsOk, requirementsMet, hasRequirements };
  });

  const achievedCount = milestoneStates.filter(m => m.isAchieved).length;
  const currentMilestone = milestoneStates.find(m => m.isCurrent);
  const overallProgress = milestones.length > 0
    ? (achievedCount / milestones.length) * 100
    : 0;

  const handleMilestoneClick = (ms: typeof milestoneStates[number]) => {
    if (nodeType !== "MAX") return;
    if (!ms.holdingOk || !ms.referralsOk) {
      setRequirementDialogData({
        rank: ms.rank,
        holdingRequired: ms.requiredHolding,
        referralsRequired: ms.requiredReferrals,
        currentHolding: vaultDeposited,
        currentReferrals: directNodeReferrals,
      });
      setShowRequirementDialog(true);
    }
  };

  return (
    <div className="min-h-screen pb-24" style={{ background: "#060606" }} data-testid="page-profile-nodes">
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0d1f12 0%, #060606 100%)" }}>
        <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(74,222,128,0.15) 0%, transparent 70%)" }} />
        <div className="relative px-4 pt-3 pb-5">
          <div className="flex items-center justify-center relative mb-5">
            <button
              onClick={() => navigate("/profile")}
              className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-white/80" />
            </button>
            <h1 className="text-[17px] font-bold tracking-wide text-white">{t("profile.nodeDetailsTitle")}</h1>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-white">{t("profile.myNodesLabel")}</span>
              <span className="text-[12px] text-white/50">{activeCount} {t("common.active")}</span>
            </div>
            <span className="text-[12px] font-semibold text-white/60">{daysActive}/{totalDays || 0} Day</span>
          </div>

          {activeNodes.length > 0 && milestones.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-white/45 font-medium">{t("profile.milestoneCountdown")}</span>
                {currentMilestone && (
                  <span className="text-[11px] font-bold text-yellow-400">
                    {currentMilestone.rank} — {currentMilestone.daysLeft}{t("profile.daysLeft")}
                  </span>
                )}
              </div>

              <div className="relative">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(overallProgress, 2)}%`,
                      background: "linear-gradient(90deg, #22c55e, #84cc16, #eab308)",
                    }}
                  />
                </div>

                <div className="flex justify-between mt-0.5" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  {milestoneStates.map((ms, idx) => {
                    const pos = ((idx + 1) / milestones.length) * 100;
                    return (
                      <div
                        key={ms.rank}
                        className="flex flex-col items-center cursor-pointer"
                        style={{ width: `${100 / milestones.length}%` }}
                        onClick={() => ms.isCurrent && ms.hasRequirements && !ms.requirementsMet && handleMilestoneClick(ms)}
                      >
                        <div
                          className="w-3.5 h-3.5 rounded-full -mt-[11px] flex items-center justify-center transition-all relative z-10"
                          style={{
                            background: ms.isAchieved
                              ? "#22c55e"
                              : ms.isCurrent
                              ? "#eab308"
                              : ms.isFailed || ms.isExpired
                              ? "#ef4444"
                              : "#2a2a2a",
                            border: ms.isAchieved
                              ? "2px solid #16a34a"
                              : ms.isCurrent
                              ? "2px solid #ca8a04"
                              : ms.isFailed || ms.isExpired
                              ? "2px solid #dc2626"
                              : "2px solid #333",
                            boxShadow: ms.isCurrent ? "0 0 8px rgba(234,179,8,0.5)" : ms.isAchieved ? "0 0 6px rgba(34,197,94,0.4)" : "none",
                          }}
                        >
                          {ms.isAchieved && (
                            <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                          {(ms.isFailed || ms.isExpired) && (
                            <svg width="7" height="7" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                          )}
                        </div>
                        <span className={`text-[9px] mt-1 font-bold ${
                          ms.isAchieved ? "text-green-400" :
                          ms.isCurrent ? "text-yellow-400" :
                          ms.isFailed || ms.isExpired ? "text-red-400/70" :
                          "text-white/25"
                        }`}>
                          {ms.rank}
                        </span>
                        {ms.isCurrent && !ms.requirementsMet && ms.hasRequirements && (
                          <AlertTriangle className="h-2.5 w-2.5 text-yellow-400 mt-0.5" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {currentMilestone && (
                <div
                  className="mt-3 rounded-xl px-3 py-2 flex items-center justify-between"
                  style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0 animate-pulse" />
                    <span className="text-[11px] text-white/60 truncate">{currentMilestone.desc}</span>
                  </div>
                  {currentMilestone.hasRequirements && !currentMilestone.requirementsMet && nodeType === "MAX" && (
                    <button
                      className="shrink-0 text-[10px] font-bold text-yellow-400 px-2 py-0.5 rounded-md ml-2"
                      style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.2)" }}
                      onClick={() => handleMilestoneClick(currentMilestone)}
                    >
                      {t("profile.milestoneRequirements")}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isConnected ? (
        <div className="px-4 mt-4">
          <div className="rounded-2xl p-8 text-center" style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}>
            <WalletCards className="h-8 w-8 text-white/20 mx-auto mb-3" />
            <p className="text-sm text-white/35">{t("profile.connectToViewNodes")}</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="px-4 mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="px-4 -mt-1 space-y-3">
          <div className="rounded-2xl p-4 space-y-3" style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                className="rounded-xl py-2.5 px-3 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.04))", border: "1px solid rgba(74,222,128,0.2)" }}
                onClick={() => { setPurchaseNodeType("MAX"); setPurchaseDialogOpen(true); }}
              >
                <span className="text-[12px] font-bold text-white/90">{t("profile.applyLargeNode")}</span>
                <ArrowUpRight className="h-3 w-3 text-primary/70" />
              </button>
              <button
                className="rounded-xl py-2.5 px-3 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.12), rgba(74,222,128,0.04))", border: "1px solid rgba(74,222,128,0.2)" }}
                onClick={() => { setPurchaseNodeType("MINI"); setPurchaseDialogOpen(true); }}
              >
                <span className="text-[12px] font-bold text-white/90">{t("profile.applySmallNode")}</span>
                <ArrowUpRight className="h-3 w-3 text-primary/70" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-center -mt-0.5">
              <span className="text-[10px] text-white/30">{t("profile.contribution")} {NODE_PLANS.MAX.price} USDC</span>
              <span className="text-[10px] text-white/30">{t("profile.contribution")} {NODE_PLANS.MINI.price} USDC</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#161616" }}>
                <div className="text-[10px] text-white/40 font-medium uppercase tracking-wide">{t("profile.nodeTotalAmount")}</div>
                <Coins className="h-5 w-5 mx-auto text-primary/60" />
                <div className="text-[16px] font-black text-white">${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#161616" }}>
                <div className="text-[10px] text-white/40 font-medium uppercase tracking-wide">{t("profile.releaseDays")}</div>
                <Calendar className="h-5 w-5 mx-auto text-primary/60" />
                <div className="text-[16px] font-black text-white">{daysActive}/{totalDays || 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#161616" }}>
                <div className="text-[10px] text-white/40 font-medium">{t("profile.releasedEarnings")}</div>
                <div className="text-[14px] font-bold text-primary">{formatCompactMA(releasedEarnings)}</div>
              </div>
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#161616" }}>
                <div className="text-[10px] text-white/40 font-medium">{t("profile.releaseStatus")}</div>
                <div className="flex items-center justify-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${releaseStatus !== "--" ? "bg-green-400 animate-pulse" : "bg-white/20"}`} />
                  <span className="text-[14px] font-bold text-white/80">{releaseStatus}</span>
                </div>
              </div>
            </div>

            <div
              className="rounded-xl px-3 py-2.5 flex items-center justify-between"
              style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/40">{t("profile.availableBalance")}:</span>
                <span className="text-[12px] font-bold text-white/90">{formatCompactMA(availableBalance)}/{formatCompactMA(lockedEarnings)}</span>
              </div>
              <button
                className="text-[11px] rounded-lg px-3 py-1 font-medium text-white/60 transition-colors hover:text-white/90 active:scale-95"
                style={{ background: "#222", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                {t("profile.withdrawBtn")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {([
              { key: "purchase" as TabKey, label: t("profile.purchaseRecords") },
              { key: "earnings" as TabKey, label: t("profile.earningsDetailTab") },
              { key: "detail" as TabKey, label: t("profile.myDetailTab") },
            ]).map((tab) => (
              <button
                key={tab.key}
                className="py-2 rounded-xl text-[12px] font-semibold transition-all text-center"
                style={{
                  border: activeTab === tab.key
                    ? "1px solid rgba(74, 222, 128, 0.4)"
                    : "1px solid rgba(255,255,255,0.08)",
                  color: activeTab === tab.key ? "#4ade80" : "rgba(255,255,255,0.4)",
                  background: activeTab === tab.key ? "rgba(74, 222, 128, 0.08)" : "#0f0f0f",
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
                    style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-white/90">
                        {m.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        m.status === "ACTIVE" ? "bg-green-500/15 text-green-400" :
                        m.status === "PENDING_MILESTONES" ? "bg-yellow-500/15 text-yellow-400" :
                        m.status === "CANCELLED" ? "bg-red-500/15 text-red-400" :
                        "bg-white/5 text-white/30"
                      }`}>
                        {m.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-white/40">
                      <span>{t("profile.contribution")}: {Number(m.contributionAmount || m.depositAmount || 0)} USDC</span>
                      <span>{t("profile.frozenFunds")}: {Number(m.frozenAmount || 0).toLocaleString()} USDC</span>
                      <span>{t("profile.startDate")}: {formatDate(m.startDate)}</span>
                      <span>{t("profile.endDate")}: {formatDate(m.endDate)}</span>
                    </div>
                    {m.milestones && m.milestones.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-1">
                        {m.milestones.map((ms, i) => (
                          <span
                            key={i}
                            className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium ${
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
                    style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div>
                      <div className="text-[13px] font-medium text-white/80">
                        {r.rewardType === "FIXED_YIELD" ? t("profile.dailyEarnings") :
                         r.rewardType === "POOL_DIVIDEND" ? t("profile.poolDividend") :
                         t("profile.teamCommission")}
                      </div>
                      <div className="text-[10px] text-white/30">
                        {r.details?.node_type || "--"} · {formatDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-[13px] font-bold text-primary">
                      +{formatMA(Number(r.amount || 0))}
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
                    style={{ background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-white/90">
                        {n.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        n.status === "ACTIVE" ? "bg-green-500/15 text-green-400" : "bg-yellow-500/15 text-yellow-400"
                      }`}>
                        {n.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-[10px] text-white/40">
                      <span>{t("profile.frozenFunds")}: {Number(n.frozenAmount || 0).toLocaleString()} USDC</span>
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
      )}

      <Dialog open={showRequirementDialog} onOpenChange={setShowRequirementDialog}>
        <DialogContent className="max-w-sm" style={{ background: "#111", border: "1px solid rgba(255,255,255,0.15)" }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px]">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              {t("profile.milestoneNotReady")}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-white/40">
              {t("profile.milestoneNotReadyDesc")} — {requirementDialogData?.rank}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {requirementDialogData && requirementDialogData.holdingRequired > 0 && (
              <div
                className="rounded-xl p-3 space-y-1"
                style={{
                  border: vaultDeposited >= requirementDialogData.holdingRequired
                    ? "1px solid rgba(74, 222, 128, 0.3)"
                    : "1px solid rgba(239, 68, 68, 0.3)",
                  background: "#161616",
                }}
              >
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/60">{t("profile.holdingRequired")}</span>
                  <span className="font-bold text-white/90">{requirementDialogData.holdingRequired} USDC</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/60">{t("profile.currentHolding")}</span>
                  <span className={vaultDeposited >= requirementDialogData.holdingRequired ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                    {vaultDeposited.toFixed(0)} USDC
                  </span>
                </div>
                {vaultDeposited < requirementDialogData.holdingRequired && (
                  <p className="text-[10px] text-yellow-400/70 mt-1">{t("profile.depositToMeet")}</p>
                )}
              </div>
            )}
            {requirementDialogData && requirementDialogData.referralsRequired > 0 && (
              <div
                className="rounded-xl p-3 space-y-1"
                style={{
                  border: directNodeReferrals >= requirementDialogData.referralsRequired
                    ? "1px solid rgba(74, 222, 128, 0.3)"
                    : "1px solid rgba(239, 68, 68, 0.3)",
                  background: "#161616",
                }}
              >
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/60">{t("profile.directNodeRequired")}</span>
                  <span className="font-bold text-white/90">{requirementDialogData.referralsRequired}</span>
                </div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-white/60">{t("profile.currentDirectNodes")}</span>
                  <span className={directNodeReferrals >= requirementDialogData.referralsRequired ? "text-green-400 font-bold" : "text-red-400 font-bold"}>
                    {directNodeReferrals}
                  </span>
                </div>
                {directNodeReferrals < requirementDialogData.referralsRequired && (
                  <p className="text-[10px] text-yellow-400/70 mt-1">{t("profile.referralToMeet")}</p>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-[12px] rounded-xl"
              onClick={() => setShowRequirementDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            {requirementDialogData && vaultDeposited < requirementDialogData.holdingRequired && (
              <Button
                size="sm"
                className="flex-1 text-[12px] rounded-xl"
                onClick={() => {
                  setShowRequirementDialog(false);
                  navigate("/vault");
                }}
              >
                <Landmark className="mr-1 h-3 w-3" />
                {t("profile.goToVault")}
              </Button>
            )}
            {requirementDialogData && requirementDialogData.referralsRequired > 0 && directNodeReferrals < requirementDialogData.referralsRequired && vaultDeposited >= requirementDialogData.holdingRequired && (
              <Button
                size="sm"
                className="flex-1 text-[12px] rounded-xl"
                onClick={() => {
                  setShowRequirementDialog(false);
                  navigate("/profile/referral");
                }}
              >
                {t("profile.inviteFriends")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <NodePurchaseDialog
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
        nodeType={purchaseNodeType}
        walletAddr={walletAddr}
      />
    </div>
  );
}
