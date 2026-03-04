import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { ArrowLeft, ArrowUpRight, Calendar, WalletCards, Coins } from "lucide-react";
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

  const getMilestoneDesc = (ms: { rank: string; desc: string; requiredHolding: number; requiredReferrals: number }) => {
    if (nodeType === "MINI") {
      if (ms.rank === "V2") return t("profile.milestoneV2Mini");
      if (ms.rank === "V4") return t("profile.milestoneV4Mini");
    }
    if (ms.requiredReferrals > 0)
      return t("profile.rankDescHoldingRefs", { amount: ms.requiredHolding, refs: ms.requiredReferrals });
    if (ms.rank === "V6")
      return t("profile.rankDescUnlockAll", { amount: ms.requiredHolding });
    if (ms.requiredHolding > 0)
      return t("profile.rankDescHolding", { amount: ms.requiredHolding });
    return ms.desc;
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


  return (
    <div className="min-h-screen pb-24" style={{ background: "#0a0a0a" }} data-testid="page-profile-nodes">
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0f2818 0%, #0a1a10 50%, #0a0a0a 100%)" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% -10%, rgba(74,222,128,0.25) 0%, transparent 65%)" }} />
        <div className="absolute top-0 left-1/4 w-40 h-40 opacity-15" style={{ background: "radial-gradient(circle, rgba(52,211,153,0.5), transparent 70%)", filter: "blur(30px)" }} />
        <div className="absolute top-10 right-1/4 w-32 h-32 opacity-10" style={{ background: "radial-gradient(circle, rgba(34,197,94,0.6), transparent 70%)", filter: "blur(25px)" }} />
        <div className="relative px-4 pt-3 pb-5">
          <div className="flex items-center justify-center relative mb-5">
            <button
              onClick={() => navigate("/profile")}
              className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <ArrowLeft className="h-5 w-5 text-white/90" />
            </button>
            <h1 className="text-[17px] font-bold tracking-wide text-white">{t("profile.nodeDetailsTitle")}</h1>
          </div>

          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-white">{t("profile.myNodesLabel")}</span>
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(74,222,128,0.15)", color: "#4ade80", border: "1px solid rgba(74,222,128,0.2)" }}
              >
                {activeCount} {t("common.active")}
              </span>
            </div>
            <span className="text-[11px] font-bold text-white/60">
              {daysActive}/{totalDays || 0} {t("profile.dayUnit")}
            </span>
          </div>

          <div className="mb-2">
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full rounded-full transition-all duration-700 relative overflow-hidden"
                style={{
                  width: `${totalDays > 0 ? Math.min(Math.max((daysActive / totalDays) * 100, 1), 100) : 0}%`,
                  background: "linear-gradient(90deg, #22c55e, #4ade80)",
                  boxShadow: "0 0 8px rgba(74,222,128,0.3)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-40"
                  style={{
                    background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)",
                    animation: "shimmer 2s ease-in-out infinite",
                  }}
                />
              </div>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] text-white/30">{t("profile.dayZero")}</span>
              <span className="text-[9px] text-white/30">{totalDays || 0}{t("profile.dayUnit")}</span>
            </div>
          </div>

          {activeNodes.length > 0 && milestones.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-white/55 font-medium">{t("profile.milestoneCountdown")}</span>
                {currentMilestone && (
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-md"
                    style={{ background: "rgba(250,204,21,0.12)", color: "#facc15", border: "1px solid rgba(250,204,21,0.2)" }}
                  >
                    {currentMilestone.rank} — {currentMilestone.daysLeft}{t("profile.daysLeft")}
                  </span>
                )}
              </div>

              <div className="relative">
                <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(overallProgress, 2)}%`,
                      background: "linear-gradient(90deg, #22c55e, #4ade80, #a3e635)",
                      boxShadow: "0 0 10px rgba(74,222,128,0.3)",
                    }}
                  />
                </div>

                <div className="flex justify-between mt-1" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  {milestoneStates.map((ms, idx) => {
                    return (
                      <div
                        key={ms.rank}
                        className="flex flex-col items-center cursor-pointer"
                        style={{ width: `${100 / milestones.length}%` }}
                        onClick={() => {}}
                      >
                        <div
                          className="w-4 h-4 rounded-full -mt-[13px] flex items-center justify-center transition-all relative z-10"
                          style={{
                            background: ms.isAchieved
                              ? "linear-gradient(135deg, #22c55e, #16a34a)"
                              : ms.isCurrent
                              ? "linear-gradient(135deg, #facc15, #eab308)"
                              : ms.isFailed || ms.isExpired
                              ? "linear-gradient(135deg, #ef4444, #dc2626)"
                              : "rgba(255,255,255,0.12)",
                            border: ms.isAchieved
                              ? "2px solid #4ade80"
                              : ms.isCurrent
                              ? "2px solid #fde047"
                              : ms.isFailed || ms.isExpired
                              ? "2px solid #f87171"
                              : "2px solid rgba(255,255,255,0.15)",
                            boxShadow: ms.isCurrent
                              ? "0 0 12px rgba(250,204,21,0.6)"
                              : ms.isAchieved
                              ? "0 0 8px rgba(74,222,128,0.5)"
                              : "none",
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
                          ms.isCurrent ? "text-yellow-300" :
                          ms.isFailed || ms.isExpired ? "text-red-400" :
                          "text-white/35"
                        }`}>
                          {ms.rank}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {currentMilestone && (
                <div
                  className="mt-3 rounded-xl px-3 py-2.5 flex items-center justify-between"
                  style={{ background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-yellow-400 shrink-0 animate-pulse" style={{ boxShadow: "0 0 6px rgba(250,204,21,0.5)" }} />
                    <span className="text-[11px] text-white/70 truncate font-medium">{getMilestoneDesc(currentMilestone)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isConnected ? (
        <div className="px-4 mt-4">
          <div className="rounded-2xl p-8 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.45)" }}>
            <WalletCards className="h-8 w-8 text-white/30 mx-auto mb-3" />
            <p className="text-sm text-white/50">{t("profile.connectToViewNodes")}</p>
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
          <div className="rounded-2xl p-4 space-y-3" style={{ background: "#181818", border: "1px solid rgba(255,255,255,0.45)", boxShadow: "0 2px 20px rgba(0,0,0,0.3)" }}>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                className="rounded-xl py-3 px-3 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.18), rgba(74,222,128,0.06))", border: "1px solid rgba(74,222,128,0.35)" }}
                onClick={() => { setPurchaseNodeType("MAX"); setPurchaseDialogOpen(true); }}
              >
                <span className="text-[12px] font-bold text-white">{t("profile.applyLargeNode")}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />
              </button>
              <button
                className="rounded-xl py-3 px-3 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97]"
                style={{ background: "linear-gradient(135deg, rgba(74,222,128,0.18), rgba(74,222,128,0.06))", border: "1px solid rgba(74,222,128,0.35)" }}
                onClick={() => { setPurchaseNodeType("MINI"); setPurchaseDialogOpen(true); }}
              >
                <span className="text-[12px] font-bold text-white">{t("profile.applySmallNode")}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-green-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-center -mt-0.5">
              <span className="text-[10px] text-white/45">{t("profile.contribution")} {NODE_PLANS.MAX.price} USDC</span>
              <span className="text-[10px] text-white/45">{t("profile.contribution")} {NODE_PLANS.MINI.price} USDC</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.25)" }}>
                <div className="text-[10px] text-white/55 font-medium uppercase tracking-wide">{t("profile.nodeTotalAmount")}</div>
                <Coins className="h-5 w-5 mx-auto text-green-400" />
                <div className="text-[16px] font-black text-white">${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.25)" }}>
                <div className="text-[10px] text-white/55 font-medium uppercase tracking-wide">{t("profile.releaseDays")}</div>
                <Calendar className="h-5 w-5 mx-auto text-green-400" />
                <div className="text-[16px] font-black text-white">{daysActive}/{totalDays || 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.25)" }}>
                <div className="text-[10px] text-white/55 font-medium">{t("profile.releasedEarnings")}</div>
                <div className="text-[14px] font-bold text-green-400">{formatCompactMA(releasedEarnings)}</div>
              </div>
              <div className="rounded-xl p-3 text-center space-y-1" style={{ background: "#222", border: "1px solid rgba(255,255,255,0.25)" }}>
                <div className="text-[10px] text-white/55 font-medium">{t("profile.releaseStatus")}</div>
                <div className="flex items-center justify-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${releaseStatus !== "--" ? "bg-green-400 animate-pulse" : "bg-white/25"}`} style={releaseStatus !== "--" ? { boxShadow: "0 0 6px rgba(74,222,128,0.5)" } : {}} />
                  <span className="text-[14px] font-bold text-white/90">{releaseStatus}</span>
                </div>
              </div>
            </div>

            <div
              className="rounded-xl px-3 py-2.5 flex items-center justify-between"
              style={{ background: "#222", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white/55">{t("profile.availableBalance")}:</span>
                <span className="text-[12px] font-bold text-white">{formatCompactMA(availableBalance)}/{formatCompactMA(lockedEarnings)}</span>
              </div>
              <button
                className="text-[11px] rounded-lg px-3 py-1 font-semibold transition-colors active:scale-95"
                style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}
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
                className="py-2.5 rounded-xl text-[12px] font-bold transition-all text-center"
                style={{
                  border: activeTab === tab.key
                    ? "1px solid rgba(74,222,128,0.5)"
                    : "1px solid rgba(255,255,255,0.3)",
                  color: activeTab === tab.key ? "#4ade80" : "rgba(255,255,255,0.6)",
                  background: activeTab === tab.key ? "rgba(74,222,128,0.1)" : "#181818",
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "purchase" && (
            <div className="space-y-2.5">
              {allMemberships.length === 0 ? (
                <div className="text-center py-16 text-white/35 text-[14px] italic">
                  {t("profile.noData")}
                </div>
              ) : (
                allMemberships.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl p-3.5 space-y-2"
                    style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-white">
                        {m.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                      </span>
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                        m.status === "ACTIVE" ? "text-green-400" :
                        m.status === "PENDING_MILESTONES" ? "text-yellow-300" :
                        m.status === "CANCELLED" ? "text-red-400" :
                        "text-white/40"
                      }`} style={{
                        background: m.status === "ACTIVE" ? "rgba(74,222,128,0.15)" :
                        m.status === "PENDING_MILESTONES" ? "rgba(250,204,21,0.12)" :
                        m.status === "CANCELLED" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.06)",
                        border: m.status === "ACTIVE" ? "1px solid rgba(74,222,128,0.25)" :
                        m.status === "PENDING_MILESTONES" ? "1px solid rgba(250,204,21,0.2)" :
                        m.status === "CANCELLED" ? "1px solid rgba(239,68,68,0.2)" : "1px solid rgba(255,255,255,0.1)",
                      }}>
                        {m.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px] text-white/55">
                      <span>{t("profile.contribution")}: {Number(m.contributionAmount || m.depositAmount || 0)} USDC</span>
                      <span>{t("profile.frozenFunds")}: {Number(m.frozenAmount || 0).toLocaleString()} USDC</span>
                      <span>{t("profile.startDate")}: {formatDate(m.startDate)}</span>
                      <span>{t("profile.endDate")}: {formatDate(m.endDate)}</span>
                    </div>
                    {m.milestones && m.milestones.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap mt-1">
                        {m.milestones.map((ms, i) => (
                          <span
                            key={i}
                            className="text-[9px] px-2 py-0.5 rounded-md font-bold"
                            style={{
                              background: ms.status === "ACHIEVED" ? "rgba(74,222,128,0.15)" :
                                ms.status === "FAILED" ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.08)",
                              border: ms.status === "ACHIEVED" ? "1px solid rgba(74,222,128,0.3)" :
                                ms.status === "FAILED" ? "1px solid rgba(239,68,68,0.25)" : "1px solid rgba(255,255,255,0.15)",
                              color: ms.status === "ACHIEVED" ? "#4ade80" :
                                ms.status === "FAILED" ? "#f87171" : "rgba(255,255,255,0.45)",
                            }}
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
            <div className="space-y-2.5">
              {earningsRecords.length === 0 ? (
                <div className="text-center py-16 text-white/35 text-[14px] italic">
                  {t("profile.noData")}
                </div>
              ) : (
                earningsRecords.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl p-3.5 flex items-center justify-between"
                    style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}
                  >
                    <div>
                      <div className="text-[13px] font-semibold text-white/90">
                        {r.rewardType === "FIXED_YIELD" ? t("profile.dailyEarnings") :
                         r.rewardType === "POOL_DIVIDEND" ? t("profile.poolDividend") :
                         t("profile.teamCommission")}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {r.details?.node_type || "--"} · {formatDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-[14px] font-bold text-green-400">
                      +{formatMA(Number(r.amount || 0))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "detail" && (
            <div className="space-y-2.5">
              {activeNodes.length === 0 ? (
                <div className="text-center py-16 text-white/35 text-[14px] italic">
                  {t("profile.noData")}
                </div>
              ) : (
                activeNodes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl p-3.5 space-y-2"
                    style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-bold text-white">
                        {n.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                      </span>
                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                        n.status === "ACTIVE" ? "text-green-400" : "text-yellow-300"
                      }`} style={{
                        background: n.status === "ACTIVE" ? "rgba(74,222,128,0.15)" : "rgba(250,204,21,0.12)",
                        border: n.status === "ACTIVE" ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(250,204,21,0.2)",
                      }}>
                        {n.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px] text-white/55">
                      <span>{t("profile.frozenFunds")}: {Number(n.frozenAmount || 0).toLocaleString()} USDC</span>
                      <span>{t("profile.dailyEarnings")}: {(Number(n.dailyRate || 0) * 100).toFixed(1)}%</span>
                      <span>{t("profile.milestoneSchedule")}: {n.milestoneStage}/{n.totalMilestones}</span>
                      <span>{t("profile.earningsCapacity")}: {(Number(n.earningsCapacity || 0) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${n.totalMilestones > 0 ? (n.milestoneStage / n.totalMilestones) * 100 : 0}%`,
                          background: "linear-gradient(90deg, #22c55e, #4ade80)",
                          boxShadow: "0 0 6px rgba(74,222,128,0.3)",
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


      <NodePurchaseDialog
        open={purchaseDialogOpen}
        onOpenChange={setPurchaseDialogOpen}
        nodeType={purchaseNodeType}
        walletAddr={walletAddr}
      />
    </div>
  );
}
