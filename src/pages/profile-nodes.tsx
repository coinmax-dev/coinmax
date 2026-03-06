import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveAccount } from "thirdweb/react";
import { ArrowLeft, ArrowUpRight, WalletCards, Zap, ShieldCheck, ChevronRight, TrendingUp, Lock, Unlock, Award } from "lucide-react";
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

  const progressPercent = totalDays > 0 ? Math.min(Math.max((daysActive / totalDays) * 100, 1), 100) : 0;

  // Tiffany + Green palette
  const tiffany = "#0abab5";
  const tiffanyLight = "#81d8d0";
  const accentGreen = "#34d399";

  return (
    <div className="min-h-screen pb-24" style={{ background: "#080b0e" }} data-testid="page-profile-nodes">
      {/* Header with Tiffany-Green gradient */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #0a1f1e 0%, #0c1a18 30%, #080b0e 100%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 30% -10%, rgba(10,186,181,0.35) 0%, transparent 55%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 75% 0%, rgba(52,211,153,0.2) 0%, transparent 50%)" }} />
        <div className="absolute top-0 left-0 w-full h-full opacity-15" style={{ background: "radial-gradient(circle at 50% 40%, rgba(129,216,208,0.3), transparent 60%)" }} />

        <div className="relative px-4 sm:px-6 pt-3 pb-6">
          <div className="flex items-center justify-center relative mb-5">
            <button
              onClick={() => navigate("/profile")}
              className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "rgba(10,186,181,0.1)", border: "1px solid rgba(10,186,181,0.25)" }}
            >
              <ArrowLeft className="h-5 w-5 text-white/90" />
            </button>
            <h1 className="text-lg sm:text-xl font-bold tracking-wide text-white">{t("profile.nodeDetailsTitle")}</h1>
          </div>

          {/* Main progress card */}
          <div
            className="rounded-2xl p-4 sm:p-5 relative overflow-hidden"
            style={{
              background: "linear-gradient(145deg, rgba(10,186,181,0.1), rgba(52,211,153,0.05), rgba(16,16,20,0.95))",
              border: "1px solid rgba(10,186,181,0.2)",
              backdropFilter: "blur(20px)",
            }}
          >
            <div className="absolute top-0 right-0 w-28 h-28 opacity-20" style={{ background: "radial-gradient(circle, rgba(10,186,181,0.5), transparent 70%)", filter: "blur(20px)" }} />
            <div className="absolute bottom-0 left-0 w-20 h-20 opacity-15" style={{ background: "radial-gradient(circle, rgba(52,211,153,0.4), transparent 70%)", filter: "blur(15px)" }} />

            <div className="relative flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-bold text-white">{t("profile.myNodesLabel")}</span>
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-bold"
                  style={{ background: "rgba(10,186,181,0.15)", color: tiffanyLight, border: `1px solid rgba(10,186,181,0.3)` }}
                >
                  {activeCount} {t("common.active")}
                </span>
              </div>
              <div className="text-right">
                <div className="text-xl sm:text-2xl font-black text-white">{daysActive}<span className="text-xs text-white/40 font-medium">/{totalDays || 0}</span></div>
                <div className="text-[11px] sm:text-xs text-white/35">{t("profile.dayUnit")}</div>
              </div>
            </div>

            {/* Progress bar with tiffany-green gradient */}
            <div className="relative mb-1">
              <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-1000 relative overflow-hidden"
                  style={{
                    width: `${progressPercent}%`,
                    background: `linear-gradient(90deg, ${tiffany}, ${accentGreen}, #a3e635)`,
                    boxShadow: `0 0 12px rgba(10,186,181,0.4)`,
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
                      animation: "shimmer 2s ease-in-out infinite",
                    }}
                  />
                </div>
              </div>
            </div>

            {activeNodes.length > 0 && milestones.length > 0 && (
              <div className="mt-3">
                <div className="flex justify-between items-end px-0.5">
                  {milestoneStates.map((ms, idx) => (
                    <div key={ms.rank} className="flex flex-col items-center" style={{ width: `${100 / milestones.length}%` }}>
                      <div
                        className="w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center relative"
                        style={{
                          background: ms.isAchieved
                            ? `linear-gradient(135deg, ${tiffany}, ${accentGreen})`
                            : ms.isCurrent
                            ? "linear-gradient(135deg, #facc15, #eab308)"
                            : ms.isFailed || ms.isExpired
                            ? "linear-gradient(135deg, #ef4444, #dc2626)"
                            : "rgba(255,255,255,0.08)",
                          boxShadow: ms.isCurrent
                            ? "0 0 12px rgba(250,204,21,0.5)"
                            : ms.isAchieved
                            ? `0 0 8px rgba(10,186,181,0.4)`
                            : "none",
                        }}
                      >
                        {ms.isAchieved && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                        {ms.isCurrent && <div className="w-2 h-2 rounded-full bg-white" />}
                        {(ms.isFailed || ms.isExpired) && (
                          <svg width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        )}
                      </div>
                      <span className={`text-[11px] sm:text-xs mt-1 font-bold`} style={{
                        color: ms.isAchieved ? tiffanyLight :
                        ms.isCurrent ? "#fde047" :
                        ms.isFailed || ms.isExpired ? "#f87171" :
                        "rgba(255,255,255,0.25)"
                      }}>
                        {ms.rank}
                      </span>
                    </div>
                  ))}
                </div>

                {currentMilestone && (
                  <div
                    className="mt-3 rounded-xl px-3 py-2 flex items-center gap-2"
                    style={{ background: "rgba(250,204,21,0.06)", border: "1px solid rgba(250,204,21,0.15)" }}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0 animate-pulse" style={{ boxShadow: "0 0 6px rgba(250,204,21,0.5)" }} />
                    <span className="text-xs text-white/60 truncate font-medium flex-1">{getMilestoneDesc(currentMilestone)}</span>
                    <span className="text-xs font-bold text-yellow-400 shrink-0">{currentMilestone.daysLeft}{t("profile.daysLeft")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!isConnected ? (
        <div className="px-4 sm:px-6 mt-4">
          <div className="rounded-2xl p-8 text-center" style={{ background: "#12161a", border: "1px solid rgba(10,186,181,0.15)" }}>
            <WalletCards className="h-10 w-10 text-white/30 mx-auto mb-3" />
            <p className="text-base text-white/50">{t("profile.connectToViewNodes")}</p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="px-4 sm:px-6 mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="px-4 sm:px-6 -mt-1 space-y-3">
          {/* Purchase buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              className="rounded-2xl p-4 flex flex-col items-start gap-2 transition-all active:scale-[0.97] relative overflow-hidden group"
              style={{
                background: "linear-gradient(145deg, #0f2625, #101418)",
                border: `1px solid rgba(10,186,181,0.25)`,
              }}
              onClick={() => { setPurchaseNodeType("MAX"); setPurchaseDialogOpen(true); }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 opacity-20 group-hover:opacity-35 transition-opacity" style={{ background: `radial-gradient(circle, rgba(10,186,181,0.5), transparent 70%)`, filter: "blur(12px)" }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-1.5" style={{ background: `linear-gradient(135deg, ${tiffany}, ${accentGreen})`, boxShadow: `0 3px 12px rgba(10,186,181,0.35)` }}>
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white">{t("profile.applyLargeNode")}</div>
                <div className="text-xs text-white/40 mt-0.5">${NODE_PLANS.MAX.price} USDT</div>
              </div>
              <div className="flex items-center gap-1 self-end">
                <span className="text-[11px]" style={{ color: `rgba(10,186,181,0.7)` }}>{t("profile.nodeTotal")} ${NODE_PLANS.MAX.frozenAmount.toLocaleString()}</span>
                <ArrowUpRight className="h-3.5 w-3.5" style={{ color: `rgba(10,186,181,0.7)` }} />
              </div>
            </button>

            <button
              className="rounded-2xl p-4 flex flex-col items-start gap-2 transition-all active:scale-[0.97] relative overflow-hidden group"
              style={{
                background: "linear-gradient(145deg, #161a20, #101418)",
                border: "1px solid rgba(129,216,208,0.15)",
              }}
              onClick={() => { setPurchaseNodeType("MINI"); setPurchaseDialogOpen(true); }}
            >
              <div className="absolute top-0 right-0 w-20 h-20 opacity-10 group-hover:opacity-20 transition-opacity" style={{ background: "radial-gradient(circle, rgba(129,216,208,0.4), transparent 70%)", filter: "blur(10px)" }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-1.5" style={{ background: "linear-gradient(135deg, #3b6b68, #2a4a48)", boxShadow: "0 3px 10px rgba(59,107,104,0.3)" }}>
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white">{t("profile.applySmallNode")}</div>
                <div className="text-xs text-white/40 mt-0.5">${NODE_PLANS.MINI.price} USDT</div>
              </div>
              <div className="flex items-center gap-1 self-end">
                <span className="text-[11px] text-white/35">{t("profile.nodeTotal")} ${NODE_PLANS.MINI.frozenAmount.toLocaleString()}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-white/35" />
              </div>
            </button>
          </div>

          {/* Stats grid — 4 individual cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-4 sm:p-5 relative overflow-hidden" style={{ background: "linear-gradient(145deg, #101820, #0e1216)", border: "1px solid rgba(10,186,181,0.12)" }}>
              <div className="absolute top-0 right-0 w-20 h-20 opacity-10" style={{ background: `radial-gradient(circle, ${tiffany}, transparent 70%)`, filter: "blur(10px)" }} />
              <div className="flex items-center gap-1.5 mb-2.5">
                <TrendingUp className="h-4 w-4" style={{ color: tiffanyLight }} />
                <span className="text-[11px] sm:text-xs text-white/40 font-medium uppercase tracking-wider">{t("profile.nodeTotalAmount")}</span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-white">${totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5 relative overflow-hidden" style={{ background: "linear-gradient(145deg, #0e1a18, #0e1216)", border: `1px solid rgba(52,211,153,0.12)` }}>
              <div className="absolute top-0 right-0 w-20 h-20 opacity-10" style={{ background: `radial-gradient(circle, ${accentGreen}, transparent 70%)`, filter: "blur(10px)" }} />
              <div className="flex items-center gap-1.5 mb-2.5">
                <Unlock className="h-4 w-4" style={{ color: accentGreen }} />
                <span className="text-[11px] sm:text-xs text-white/40 font-medium uppercase tracking-wider">{t("profile.releasedEarnings")}</span>
              </div>
              <div className="text-xl sm:text-2xl font-black" style={{ color: accentGreen }}>{formatCompactMA(releasedEarnings)}</div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5 relative overflow-hidden" style={{ background: "linear-gradient(145deg, #14161c, #0e1216)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Award className="h-4 w-4" style={{ color: "#c4b5fd" }} />
                <span className="text-[11px] sm:text-xs text-white/40 font-medium uppercase tracking-wider">{t("profile.releaseStatus")}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${releaseStatus !== "--" ? "animate-pulse" : ""}`} style={{
                  background: releaseStatus !== "--" ? tiffany : "rgba(255,255,255,0.2)",
                  boxShadow: releaseStatus !== "--" ? `0 0 6px rgba(10,186,181,0.5)` : "none",
                }} />
                <span className="text-base sm:text-lg font-bold text-white/90">{releaseStatus}</span>
              </div>
            </div>

            <div className="rounded-2xl p-4 sm:p-5 relative overflow-hidden" style={{ background: "linear-gradient(145deg, #161418, #0e1216)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Lock className="h-4 w-4" style={{ color: "#fbbf24" }} />
                <span className="text-[11px] sm:text-xs text-white/40 font-medium uppercase tracking-wider">{t("profile.availableBalance")}</span>
              </div>
              <div className="text-base sm:text-lg font-bold text-white">{formatCompactMA(availableBalance)}</div>
              <div className="text-[11px] text-white/25 mt-0.5">/ {formatCompactMA(lockedEarnings)}</div>
            </div>
          </div>

          {/* Withdraw button */}
          <button
            className="w-full rounded-2xl h-12 sm:h-14 flex items-center justify-center gap-2 text-sm sm:text-base font-bold transition-all active:scale-[0.97]"
            style={{
              background: `linear-gradient(135deg, rgba(10,186,181,0.1), rgba(52,211,153,0.05))`,
              border: `1px solid rgba(10,186,181,0.2)`,
              color: tiffanyLight,
            }}
          >
            {t("profile.withdrawBtn")}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>

          {/* Tabs */}
          <div
            className="flex rounded-xl overflow-hidden"
            style={{ background: "#0e1216", border: "1px solid rgba(10,186,181,0.1)" }}
          >
            {([
              { key: "purchase" as TabKey, label: t("profile.purchaseRecords") },
              { key: "earnings" as TabKey, label: t("profile.earningsDetailTab") },
              { key: "detail" as TabKey, label: t("profile.myDetailTab") },
            ]).map((tab) => (
              <button
                key={tab.key}
                className="flex-1 py-3 text-xs sm:text-sm font-bold transition-all text-center relative"
                style={{
                  color: activeTab === tab.key ? tiffanyLight : "rgba(255,255,255,0.4)",
                  background: activeTab === tab.key ? "rgba(10,186,181,0.08)" : "transparent",
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full" style={{ background: `linear-gradient(90deg, ${tiffany}, ${accentGreen})` }} />
                )}
              </button>
            ))}
          </div>

          {/* Purchase tab */}
          {activeTab === "purchase" && (
            <div className="space-y-2">
              {allMemberships.length === 0 ? (
                <div className="text-center py-16 text-white/30 text-sm">
                  {t("profile.noData")}
                </div>
              ) : (
                allMemberships.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl p-4 space-y-2.5"
                    style={{ background: "#0e1216", border: `1px solid ${m.nodeType === "MAX" ? "rgba(10,186,181,0.12)" : "rgba(255,255,255,0.08)"}` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: m.nodeType === "MAX" ? "rgba(10,186,181,0.15)" : "rgba(255,255,255,0.06)" }}>
                          {m.nodeType === "MAX" ? <Zap className="h-4 w-4" style={{ color: tiffanyLight }} /> : <ShieldCheck className="h-4 w-4 text-white/50" />}
                        </div>
                        <span className="text-sm font-bold text-white">
                          {m.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                        </span>
                      </div>
                      <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold`} style={{
                        color: m.status === "ACTIVE" ? tiffanyLight :
                        m.status === "PENDING_MILESTONES" ? "#fde047" :
                        m.status === "CANCELLED" ? "#f87171" : "rgba(255,255,255,0.35)",
                        background: m.status === "ACTIVE" ? "rgba(10,186,181,0.12)" :
                        m.status === "PENDING_MILESTONES" ? "rgba(250,204,21,0.1)" :
                        m.status === "CANCELLED" ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.05)",
                      }}>
                        {m.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-xs text-white/45">
                      <span>{t("profile.contribution")}: {Number(m.contributionAmount || m.depositAmount || 0)} USDT</span>
                      <span>{t("profile.frozenFunds")}: {Number(m.frozenAmount || 0).toLocaleString()} USDT</span>
                      <span>{t("profile.startDate")}: {formatDate(m.startDate)}</span>
                      <span>{t("profile.endDate")}: {formatDate(m.endDate)}</span>
                    </div>
                    {m.milestones && m.milestones.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {m.milestones.map((ms, i) => (
                          <span
                            key={i}
                            className="text-[11px] px-2.5 py-1 rounded-md font-bold"
                            style={{
                              background: ms.status === "ACHIEVED" ? "rgba(10,186,181,0.12)" :
                                ms.status === "FAILED" ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.04)",
                              color: ms.status === "ACHIEVED" ? tiffanyLight :
                                ms.status === "FAILED" ? "#f87171" : "rgba(255,255,255,0.3)",
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

          {/* Earnings tab */}
          {activeTab === "earnings" && (
            <div className="space-y-2">
              {earningsRecords.length === 0 ? (
                <div className="text-center py-16 text-white/30 text-sm">
                  {t("profile.noData")}
                </div>
              ) : (
                earningsRecords.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl p-4 flex items-center justify-between"
                    style={{ background: "#0e1216", border: "1px solid rgba(10,186,181,0.08)" }}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white/90">
                        {r.rewardType === "FIXED_YIELD" ? t("profile.dailyEarnings") :
                         r.rewardType === "POOL_DIVIDEND" ? t("profile.poolDividend") :
                         t("profile.teamCommission")}
                      </div>
                      <div className="text-xs text-white/35">
                        {r.details?.node_type || "--"} · {formatDate(r.createdAt)}
                      </div>
                    </div>
                    <div className="text-base sm:text-lg font-bold" style={{ color: accentGreen }}>
                      +{formatMA(Number(r.amount || 0))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Detail tab */}
          {activeTab === "detail" && (
            <div className="space-y-2">
              {activeNodes.length === 0 ? (
                <div className="text-center py-16 text-white/30 text-sm">
                  {t("profile.noData")}
                </div>
              ) : (
                activeNodes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-xl p-4 space-y-3"
                    style={{ background: "#0e1216", border: `1px solid ${n.nodeType === "MAX" ? "rgba(10,186,181,0.12)" : "rgba(255,255,255,0.08)"}` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: n.nodeType === "MAX" ? "rgba(10,186,181,0.15)" : "rgba(255,255,255,0.06)" }}>
                          {n.nodeType === "MAX" ? <Zap className="h-4 w-4" style={{ color: tiffanyLight }} /> : <ShieldCheck className="h-4 w-4 text-white/50" />}
                        </div>
                        <span className="text-sm font-bold text-white">
                          {n.nodeType === "MAX" ? t("profile.applyLargeNode") : t("profile.applySmallNode")}
                        </span>
                      </div>
                      <span className={`text-[11px] px-2.5 py-1 rounded-full font-bold`} style={{
                        color: n.status === "ACTIVE" ? tiffanyLight : "#fde047",
                        background: n.status === "ACTIVE" ? "rgba(10,186,181,0.12)" : "rgba(250,204,21,0.1)",
                      }}>
                        {n.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-lg p-3 text-center" style={{ background: "rgba(10,186,181,0.04)", border: "1px solid rgba(10,186,181,0.08)" }}>
                        <div className="text-[11px] sm:text-xs text-white/35">{t("profile.frozenFunds")}</div>
                        <div className="text-base sm:text-lg font-bold text-white">{Number(n.frozenAmount || 0).toLocaleString()}</div>
                      </div>
                      <div className="rounded-lg p-3 text-center" style={{ background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.08)" }}>
                        <div className="text-[11px] sm:text-xs text-white/35">{t("profile.dailyEarnings")}</div>
                        <div className="text-base sm:text-lg font-bold" style={{ color: accentGreen }}>{(Number(n.dailyRate || 0) * 100).toFixed(1)}%</div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] sm:text-xs text-white/35">{t("profile.milestoneSchedule")}</span>
                        <span className="text-xs font-bold text-white/60">{n.milestoneStage}/{n.totalMilestones}</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${n.totalMilestones > 0 ? (n.milestoneStage / n.totalMilestones) * 100 : 0}%`,
                            background: `linear-gradient(90deg, ${tiffany}, ${accentGreen})`,
                            boxShadow: `0 0 6px rgba(10,186,181,0.3)`,
                          }}
                        />
                      </div>
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
