import { Skeleton } from "@/components/ui/skeleton";
import { useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { shortenAddress, formatCompact } from "@/lib/constants";
import { useMaPrice } from "@/hooks/use-ma-price";
import { ArrowLeft, Copy, Users, UserPlus, DollarSign, WalletCards, Layers, ChevronRight, ChevronDown, History, Network } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/copy";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getProfile, getReferralTree, getCommissionRecords } from "@/lib/api";
import type { Profile, CommissionSummary } from "@shared/types";
import { useTranslation } from "react-i18next";

interface ReferralMember {
  id: string;
  walletAddress: string;
  rank: string;
  nodeType: string;
  totalDeposited: string;
  level: number;
  refCode?: string;
  sponsorWallet?: string;
  sponsorCode?: string;
  subCount?: number;
  subReferrals?: ReferralMember[] | null;
}

interface ReferralData {
  referrals: ReferralMember[];
  teamSize: number;
  directCount: number;
}

type MainTab = "team" | "history";
type HistoryFilter = "deposit" | "redeem" | "income" | "invite" | "team";

export default function ProfileReferralPage() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { toast } = useToast();
  const { formatCompactMA, usdcToMA } = useMaPrice();
  const [, navigate] = useLocation();
  const walletAddr = account?.address || "";
  const isConnected = !!walletAddr;

  const [mainTab, setMainTab] = useState<MainTab>("team");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("income");

  const [addrStack, setAddrStack] = useState<Array<{ addr: string; label: string }>>([]);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [skipCount, setSkipCount] = useState(0);
  const viewingAddr = addrStack.length > 0 ? addrStack[addrStack.length - 1].addr : walletAddr;
  const isViewingSelf = viewingAddr === walletAddr;

  const drillInto = useCallback((addr: string, label: string) => {
    setAddrStack((prev) => [...prev, { addr, label }]);
  }, []);

  const goBack = useCallback(() => {
    setAddrStack((prev) => prev.slice(0, -1));
  }, []);

  const goToRoot = useCallback(() => {
    setAddrStack([]);
  }, []);

  const { data: profile } = useQuery<Profile>({
    queryKey: ["profile", walletAddr],
    queryFn: () => getProfile(walletAddr),
    enabled: isConnected,
  });

  const { data: teamData, isLoading } = useQuery<ReferralData>({
    queryKey: ["referrals", viewingAddr],
    queryFn: () => getReferralTree(viewingAddr),
    enabled: isConnected,
  });

  const { data: commission, isLoading: commissionLoading } = useQuery<CommissionSummary>({
    queryKey: ["commission", walletAddr],
    queryFn: () => getCommissionRecords(walletAddr),
    enabled: isConnected,
  });

  const totalCommission = Number(commission?.totalCommission || 0);
  const directTotal = Number(commission?.directReferralTotal || 0);
  const diffTotal = Number(commission?.differentialTotal || 0);

  const refCode = profile?.refCode;
  const currentRank = profile?.rank || "V0";
  // Self-referral link: sponsor=self, placement=self
  const referralLink = refCode ? `${window.location.origin}/r/${refCode}/${refCode}` : "--";
  const parentWallet = (profile as any)?.parentWallet || null;

  const copyToClipboard = async (text: string) => {
    await copyText(text);
    toast({ title: t("common.copied"), description: t("common.copiedDesc") });
  };

  const totalTeamDeposits = teamData?.referrals.reduce((sum, ref) => {
    const direct = Number(ref.totalDeposited || 0);
    const sub = ref.subReferrals?.reduce((s, r) => s + Number(r.totalDeposited || 0), 0) || 0;
    return sum + direct + sub;
  }, 0) || 0;

  const filteredRecords = commission?.records?.filter((r) => {
    if (historyFilter === "income") return true;
    if (historyFilter === "invite") return r.details?.type === "direct_referral";
    if (historyFilter === "team") return r.details?.type !== "direct_referral";
    return true;
  }) || [];

  return (
    <div className="min-h-screen pb-24 lg:pb-8 lg:pt-4" style={{ background: "#0a0a0a" }} data-testid="page-profile-referral">
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0a1a10 0%, #0f2818 30%, #0a1510 60%, #0a0a0a 100%)" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 70% 20%, rgba(163,230,53,0.12) 0%, transparent 55%)" }} />
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.5), transparent 70%)", filter: "blur(30px)" }} />

        <div className="relative px-4 pt-3 pb-5">
          <div className="flex items-center justify-center relative mb-5 lg:justify-start">
            <button
              onClick={() => navigate("/profile")}
              className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors lg:hidden"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <ArrowLeft className="h-5 w-5 text-white/90" />
            </button>
            <h1 className="text-[17px] font-bold tracking-wide text-white">{t("profile.promotionCenter")}</h1>
          </div>

          {/* Current Level Section */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
              <span className="text-[13px] font-bold text-white">{t("profile.currentLevel")}</span>
            </div>
            <span
              className="text-[13px] font-black px-3 py-1 rounded-lg"
              style={{
                background: "linear-gradient(135deg, rgba(74,222,128,0.15), rgba(163,230,53,0.1))",
                border: "1px solid rgba(74,222,128,0.3)",
                color: "#4ade80",
                textShadow: "0 0 8px rgba(74,222,128,0.4)",
              }}
            >
              {currentRank}
            </span>
          </div>

          {(() => {
            const rankNum = parseInt(currentRank.replace("V", "")) || 0;
            const levels = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"];
            return (
              <div
                className="relative mb-4 rounded-2xl overflow-hidden p-4 sm:p-5"
                style={{
                  background: "linear-gradient(145deg, rgba(10,30,18,0.9), rgba(8,20,14,0.95))",
                  border: "1px solid rgba(74,222,128,0.15)",
                }}
              >
                <div className="absolute top-0 right-0 w-32 h-32 opacity-20" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.5), transparent 70%)", filter: "blur(25px)" }} />

                {/* Level track */}
                <div className="relative flex items-center justify-between">
                  {/* Background track line */}
                  <div className="absolute left-[16px] right-[16px] sm:left-[20px] sm:right-[20px] top-1/2 -translate-y-1/2 h-[2px]" style={{ background: "rgba(255,255,255,0.06)" }} />
                  {/* Active track line */}
                  <div
                    className="absolute left-[16px] sm:left-[20px] top-1/2 -translate-y-1/2 h-[2px] transition-all duration-700"
                    style={{
                      width: rankNum > 0 ? `calc(${((Math.min(rankNum, 7) - 1) / 6) * 100}% - ${rankNum >= 7 ? 0 : 0}px)` : "0%",
                      maxWidth: "calc(100% - 32px)",
                      background: "linear-gradient(90deg, #22c55e, #4ade80)",
                      boxShadow: "0 0 6px rgba(74,222,128,0.3)",
                    }}
                  />

                  {levels.map((label) => {
                    const levelNum = parseInt(label.replace("V", ""));
                    const isActive = levelNum <= rankNum;
                    const isCurrent = label === currentRank;
                    return (
                      <div key={label} className="relative z-10 flex flex-col items-center">
                        {isCurrent && (
                          <div
                            className="absolute w-10 h-10 sm:w-12 sm:h-12 rounded-full"
                            style={{
                              background: "rgba(74,222,128,0.15)",
                              animation: "pulse 2.5s ease-in-out infinite",
                              top: "50%",
                              left: "50%",
                              transform: "translate(-50%, -50%)",
                            }}
                          />
                        )}
                        <div
                          className="relative w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center"
                          style={{
                            background: isCurrent
                              ? "linear-gradient(135deg, #22c55e, #4ade80)"
                              : isActive
                              ? "rgba(74,222,128,0.2)"
                              : "rgba(255,255,255,0.04)",
                            border: isCurrent
                              ? "2px solid rgba(74,222,128,0.8)"
                              : isActive
                              ? "1.5px solid rgba(74,222,128,0.3)"
                              : "1.5px solid rgba(255,255,255,0.08)",
                            boxShadow: isCurrent
                              ? "0 0 16px rgba(74,222,128,0.4)"
                              : "none",
                          }}
                        >
                          <span
                            className="text-[10px] sm:text-xs font-black"
                            style={{
                              color: isCurrent ? "#fff" : isActive ? "#4ade80" : "rgba(255,255,255,0.2)",
                            }}
                          >
                            {label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Progress text */}
                <div className="flex items-center justify-between mt-4">
                  <span className="text-[10px] text-white/30">{t("profile.currentLevel")}</span>
                  <span className="text-[11px] font-bold text-green-400">{rankNum} / 7</span>
                </div>
                <div className="w-full h-1 rounded-full overflow-hidden mt-1.5" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700 relative overflow-hidden"
                    style={{
                      width: `${Math.max((rankNum / 7) * 100, 2)}%`,
                      background: "linear-gradient(90deg, #22c55e, #4ade80)",
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
            );
          })()}

          <div className="flex items-center gap-2 mb-3">
            <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
            <span className="text-[13px] font-bold text-white">{t("profile.claimedAndPending")}</span>
          </div>

          <div className="rounded-2xl p-4" style={{ background: "#181818", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-white/50">{t("profile.totalRewards")}</span>
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #facc15, #eab308)" }}>
                <DollarSign className="h-3.5 w-3.5 text-black" />
              </div>
            </div>
            <div className="text-[24px] font-black text-white mb-3">
              {formatCompact(totalCommission)}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] text-white/40 mb-0.5">{t("profile.claimed")}</div>
                <div className="text-[16px] font-bold text-white">$0</div>
              </div>
              <div>
                <div className="text-[11px] text-white/40 mb-0.5">{t("profile.pendingRewards")}</div>
                <div className="text-[16px] font-bold text-white">{formatCompact(totalCommission)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 -mt-1 space-y-3">
        <div className="rounded-2xl p-4 space-y-4" style={{ background: "#181818", border: "1px solid rgba(255,255,255,0.4)" }}>
          <div>
            <div className="text-[13px] font-bold text-white mb-1">{t("profile.myParent")}</div>
            <div className="text-[12px] text-white/45 font-mono">
              {parentWallet ? shortenAddress(parentWallet) : "--"}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-bold text-white">{t("profile.inviteLink")}</span>
              <button
                className="text-[11px] font-bold px-3 py-1 rounded-lg transition-all active:scale-95"
                style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}
                onClick={() => copyToClipboard(referralLink)}
              >
                {refCode ? t("common.copy") : t("profile.generateInvite")}
              </button>
            </div>
            <div className="text-[11px] text-white/40 font-mono truncate">{referralLink}</div>
            <div className="h-px mt-2" style={{ background: "linear-gradient(90deg, transparent, rgba(74,222,128,0.3), transparent)" }} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-bold text-white">{t("profile.inviteCode")}</span>
              <button
                className="text-[11px] font-bold px-3 py-1 rounded-lg transition-all active:scale-95"
                style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80" }}
                onClick={() => copyToClipboard(refCode || "")}
              >
                {refCode ? t("common.copy") : t("profile.generateInvite")}
              </button>
            </div>
            <div className="text-[11px] text-white/40 font-mono">{refCode || "--"}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.directInvites")}</div>
            <UserPlus className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? (teamData?.directCount || 0) : "--"}</div>
          </div>
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.teamSize")}</div>
            <Users className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? (teamData?.teamSize || 0) : "--"}</div>
          </div>
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.teamPerformance")}</div>
            <DollarSign className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? formatCompact(totalTeamDeposits) : "--"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.inviteRewards")}</div>
            <UserPlus className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? formatCompact(directTotal) : "--"}</div>
          </div>
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.teamRewards")}</div>
            <Layers className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? formatCompact(diffTotal) : "--"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mt-1">
          {([
            { key: "team" as MainTab, label: t("profile.tabTeam"), icon: Network },
            { key: "history" as MainTab, label: t("profile.tabHistory"), icon: History },
          ]).map((tab) => (
            <button
              key={tab.key}
              className="py-3 rounded-xl text-[13px] font-bold transition-all text-center flex items-center justify-center gap-2"
              style={{
                border: mainTab === tab.key
                  ? "1px solid rgba(74,222,128,0.5)"
                  : "1px solid rgba(255,255,255,0.3)",
                color: mainTab === tab.key ? "#4ade80" : "rgba(255,255,255,0.6)",
                background: mainTab === tab.key ? "rgba(74,222,128,0.1)" : "#181818",
              }}
              onClick={() => setMainTab(tab.key)}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {mainTab === "team" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
                <span className="text-[13px] font-bold text-white">
                  {t("profile.teamMembersCount", { count: teamData?.teamSize || 0 })}
                </span>
              </div>
              {teamData?.referrals && teamData.referrals.some(r => (r.subReferrals?.length ?? 0) > 0) && (
                <button
                  className="text-[10px] px-2.5 py-1 rounded-lg font-bold transition-all"
                  style={{
                    background: expandedRefs.size > 0 ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.04)",
                    border: expandedRefs.size > 0 ? "1px solid rgba(74,222,128,0.25)" : "1px solid rgba(255,255,255,0.12)",
                    color: expandedRefs.size > 0 ? "#4ade80" : "rgba(255,255,255,0.4)",
                  }}
                  onClick={() => {
                    if (expandedRefs.size > 0) {
                      setExpandedRefs(new Set());
                    } else {
                      setExpandedRefs(new Set(teamData.referrals.filter(r => (r.subReferrals?.length ?? 0) > 0).map(r => r.id)));
                    }
                  }}
                >
                  {expandedRefs.size > 0 ? t("profile.collapseAll", "收起全部") : t("profile.expandAll", "展开全部")}
                </button>
              )}
            </div>

            {/* Skip first N controls */}
            {teamData?.referrals && teamData.referrals.length > 5 && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[10px] text-white/30 mr-0.5">压缩前:</span>
                {[0, 5, 10, 20, 30, 40, 50].filter(n => n === 0 || n < teamData.referrals.length).map(n => (
                  <button
                    key={n}
                    onClick={() => setSkipCount(n)}
                    className="text-[10px] px-2 py-1 rounded-md transition-all"
                    style={{
                      background: skipCount === n ? "rgba(74,222,128,0.15)" : "rgba(255,255,255,0.03)",
                      border: skipCount === n ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(255,255,255,0.08)",
                      color: skipCount === n ? "#4ade80" : "rgba(255,255,255,0.4)",
                      fontWeight: skipCount === n ? 700 : 400,
                    }}
                  >
                    {n === 0 ? "全部" : n}
                  </button>
                ))}
              </div>
            )}

            {!isViewingSelf && (
              <div className="flex items-center gap-1 mb-3 flex-wrap text-[12px]">
                <button
                  className="font-bold transition-colors"
                  style={{ color: "#4ade80" }}
                  onClick={goToRoot}
                >
                  {t("profile.myTeam")}
                </button>
                {addrStack.map((item, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 text-white/30" />
                    {idx < addrStack.length - 1 ? (
                      <button
                        className="font-bold"
                        style={{ color: "#4ade80" }}
                        onClick={() => setAddrStack((prev) => prev.slice(0, idx + 1))}
                      >
                        {item.label}
                      </button>
                    ) : (
                      <span className="text-white/50">{item.label}</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {!isConnected ? (
              <div className="rounded-2xl p-8 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
                <WalletCards className="h-8 w-8 text-white/25 mx-auto mb-3" />
                <p className="text-[13px] text-white/40">{t("profile.connectToViewTeam")}</p>
              </div>
            ) : isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
              </div>
            ) : !teamData?.referrals.length ? (
              <div className="rounded-2xl p-8 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
                <Users className="h-8 w-8 text-white/25 mx-auto mb-3" />
                <p className="text-[13px] text-white/40">{t("profile.noTeamMembers")}</p>
                {!isViewingSelf && (
                  <button
                    className="mt-3 text-[12px] font-bold px-4 py-1.5 rounded-lg transition-all"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)" }}
                    onClick={goBack}
                  >
                    <ArrowLeft className="inline h-3 w-3 mr-1" />{t("profile.goBack")}
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {skipCount > 0 && teamData.referrals.length > skipCount && (
                  <div
                    className="rounded-xl p-2.5 text-center text-[11px] text-white/35"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    已压缩前 {Math.min(skipCount, teamData.referrals.length)} 个成员
                  </div>
                )}
                {teamData.referrals.slice(skipCount).map((ref) => {
                  const subCount = ref.subReferrals?.length || 0;
                  const teamDeposits = ref.subReferrals?.reduce((s, r) => s + Number(r.totalDeposited || 0), 0) || 0;
                  const isExpanded = expandedRefs.has(ref.id);
                  const toggleExpand = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    setExpandedRefs(prev => {
                      const next = new Set(prev);
                      if (next.has(ref.id)) next.delete(ref.id); else next.add(ref.id);
                      return next;
                    });
                  };
                  return (
                  <div key={ref.id}>
                    <div
                      className="w-full rounded-xl p-3 flex items-center gap-3 text-left transition-all"
                      style={{
                        background: subCount > 0
                          ? "linear-gradient(135deg, #0f2318, #1a1a1a)"
                          : "#141414",
                        border: subCount > 0
                          ? "1px solid rgba(74,222,128,0.25)"
                          : "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      {/* Expand/collapse toggle */}
                      {subCount > 0 ? (
                        <button onClick={toggleExpand} className="shrink-0 p-0.5 rounded-md transition-colors" style={{ background: "rgba(255,255,255,0.04)" }}>
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-green-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-white/40" />
                          }
                        </button>
                      ) : (
                        <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "rgba(255,255,255,0.2)" }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <button
                          className="text-left w-full"
                          onClick={() => drillInto(ref.walletAddress, shortenAddress(ref.walletAddress))}
                        >
                          <div className="text-[12px] font-mono text-white/80 truncate">
                            {shortenAddress(ref.walletAddress)}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: subCount > 0 ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)", color: subCount > 0 ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.3)" }}>
                              {t("profile.teamCount", { count: subCount })}
                            </span>
                            <span className="text-[10px] text-white/35">
                              {t("profile.deposits", "Deposits")}: {formatCompact(Number(ref.totalDeposited || 0))}
                            </span>
                            <span className="text-[10px] text-white/25">
                              {t("profile.teamPerformance")}: {formatCompact(teamDeposits)}
                            </span>
                          </div>
                        </button>
                        {/* Sponsor info + placement link (shown when expanded) */}
                        {isExpanded && (
                          <div className="mt-2 pt-2 space-y-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                            {ref.sponsorWallet && (
                              <div className="text-[10px] text-white/30">
                                {t("profile.sponsorLabel", "Sponsor")}: <span className="font-mono text-white/50">{shortenAddress(ref.sponsorWallet)}</span>
                              </div>
                            )}
                            {/* Placement referral link: sponsor=current user, placement=this member */}
                            {refCode && ref.refCode && (
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[9px] font-mono text-yellow-400/70 truncate"
                                  style={{ background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.15)" }}
                                >
                                  {window.location.origin}/r/{refCode}/{ref.refCode}
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(`${window.location.origin}/r/${refCode}/${ref.refCode}`); }}
                                  className="shrink-0 p-1.5 rounded-lg transition-colors hover:bg-white/10"
                                  style={{ background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)" }}
                                  title={t("profile.placementLink", "Placement Link")}
                                >
                                  <Copy className="h-3 w-3 text-yellow-400/70" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-md font-bold"
                          style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80" }}
                        >
                          {ref.rank}
                        </span>
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-md font-bold"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)" }}
                        >
                          {ref.nodeType}
                        </span>
                      </div>
                      <button onClick={() => drillInto(ref.walletAddress, shortenAddress(ref.walletAddress))} className="shrink-0">
                        <ChevronRight className="h-3.5 w-3.5 text-white/30" />
                      </button>
                    </div>
                    {isExpanded && ref.subReferrals && ref.subReferrals.length > 0 && (
                      <div className="ml-5 mt-1.5 space-y-1.5 border-l-2 pl-3" style={{ borderColor: "rgba(74,222,128,0.15)" }}>
                        {ref.subReferrals.map((sub) => {
                          const hasTeam = (sub.subCount || 0) > 0;
                          return (
                          <button
                            key={sub.id}
                            className="w-full rounded-lg p-2.5 flex items-center gap-2.5 text-left transition-all active:scale-[0.98]"
                            style={{
                              background: hasTeam ? "linear-gradient(135deg, rgba(74,222,128,0.04), rgba(255,255,255,0.02))" : "rgba(255,255,255,0.03)",
                              border: hasTeam ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(255,255,255,0.1)",
                            }}
                            onClick={() => drillInto(sub.walletAddress, shortenAddress(sub.walletAddress))}
                          >
                            <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: hasTeam ? "#4ade80" : "rgba(255,255,255,0.2)" }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-mono text-white/60 truncate">
                                {shortenAddress(sub.walletAddress)}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: hasTeam ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)", color: hasTeam ? "rgba(74,222,128,0.7)" : "rgba(255,255,255,0.3)" }}>
                                  {t("profile.teamCount", { count: sub.subCount || 0 })}
                                </span>
                              </div>
                            </div>
                            <span
                              className="text-[11px] px-2 py-0.5 rounded font-bold shrink-0"
                              style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}
                            >
                              {sub.rank}
                            </span>
                            <ChevronRight className="h-3 w-3 text-white/20 shrink-0" />
                          </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {mainTab === "history" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
              <span className="text-[13px] font-bold text-white">{t("profile.tabHistory")}</span>
            </div>

            <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
              {([
                { key: "deposit" as HistoryFilter, label: t("profile.historyDeposit") },
                { key: "redeem" as HistoryFilter, label: t("profile.historyRedeem") },
                { key: "income" as HistoryFilter, label: t("profile.historyIncome") },
                { key: "invite" as HistoryFilter, label: t("profile.historyInvite") },
                { key: "team" as HistoryFilter, label: t("profile.historyTeam") },
              ]).map((f) => (
                <button
                  key={f.key}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all"
                  style={{
                    background: historyFilter === f.key ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.04)",
                    border: historyFilter === f.key ? "1px solid rgba(74,222,128,0.35)" : "1px solid rgba(255,255,255,0.12)",
                    color: historyFilter === f.key ? "#4ade80" : "rgba(255,255,255,0.45)",
                  }}
                  onClick={() => setHistoryFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {!isConnected ? (
              <div className="rounded-2xl p-8 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
                <WalletCards className="h-8 w-8 text-white/25 mx-auto mb-3" />
                <p className="text-[13px] text-white/40">{t("profile.connectToViewCommission")}</p>
              </div>
            ) : commissionLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="py-16 text-center text-white/30 text-[13px]">
                {t("profile.noHistoryData")}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredRecords.map((record) => {
                  const isDirectRef = record.details?.type === "direct_referral";
                  const amount = Number(record.amount || 0);
                  const depth = record.details?.depth || 0;
                  const rate = record.details?.rate;
                  const createdAt = record.createdAt
                    ? new Date(record.createdAt).toLocaleDateString(undefined, {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                      })
                    : "--";

                  return (
                    <div
                      key={record.id}
                      className="rounded-xl p-3.5 flex items-center justify-between"
                      style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.35)" }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: isDirectRef ? "rgba(74,222,128,0.1)" : "rgba(245,158,11,0.1)" }}
                        >
                          {isDirectRef ? (
                            <UserPlus className="h-4 w-4 text-green-400" />
                          ) : (
                            <Layers className="h-4 w-4 text-amber-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded font-bold"
                              style={{
                                background: isDirectRef ? "rgba(74,222,128,0.1)" : "rgba(245,158,11,0.1)",
                                color: isDirectRef ? "#4ade80" : "#f59e0b",
                              }}
                            >
                              {isDirectRef ? t("profile.directRef") : t("profile.differential")}
                            </span>
                            <span className="text-[10px] text-white/30">L{depth}</span>
                            {rate !== undefined && !isDirectRef && (
                              <span className="text-[10px] text-white/30">{(rate * 100).toFixed(0)}%</span>
                            )}
                          </div>
                          <div className="text-[10px] text-white/35 mt-0.5 truncate">
                            {t("profile.from")}: {record.sourceWallet ? shortenAddress(record.sourceWallet) : "--"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[13px] font-bold text-green-400">+{usdcToMA(amount).toFixed(2)} MA</div>
                        <div className="text-[10px] text-white/30">{createdAt}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
