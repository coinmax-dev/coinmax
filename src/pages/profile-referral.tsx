import { Skeleton } from "@/components/ui/skeleton";
import { useState, useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { shortenAddress, formatCompact } from "@/lib/constants";
import { useMaPrice } from "@/hooks/use-ma-price";
import { ArrowLeft, Copy, Users, UserPlus, DollarSign, WalletCards, Layers, ChevronRight, History, Network } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getProfile, getReferralTree, getCommissionRecords } from "@/lib/api";
import type { Profile, CommissionSummary } from "@shared/types";
import { useTranslation } from "react-i18next";

interface ReferralData {
  referrals: Array<{
    id: string;
    walletAddress: string;
    rank: string;
    nodeType: string;
    totalDeposited: string;
    level: number;
    subReferrals: Array<{
      id: string;
      walletAddress: string;
      rank: string;
      nodeType: string;
      totalDeposited: string;
      level: number;
    }>;
  }>;
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
  const referralLink = refCode ? `${window.location.origin}?ref=${refCode}` : "--";
  const parentWallet = (profile as any)?.parentWallet || null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
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
    <div className="min-h-screen pb-24" style={{ background: "#0a0a0a" }} data-testid="page-profile-referral">
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0a1a10 0%, #0f2818 30%, #0a1510 60%, #0a0a0a 100%)" }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 70% 20%, rgba(163,230,53,0.12) 0%, transparent 55%)" }} />
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15" style={{ background: "radial-gradient(circle, rgba(74,222,128,0.5), transparent 70%)", filter: "blur(30px)" }} />

        <div className="relative px-4 pt-3 pb-5">
          <div className="flex items-center justify-center relative mb-5">
            <button
              onClick={() => navigate("/profile")}
              className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <ArrowLeft className="h-5 w-5 text-white/90" />
            </button>
            <h1 className="text-[17px] font-bold tracking-wide text-white">{t("profile.promotionCenter")}</h1>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
            <span className="text-[13px] font-bold text-white">{t("profile.currentLevel")}</span>
          </div>

          <div className="relative mb-4 rounded-2xl overflow-hidden" style={{ height: 200, background: "linear-gradient(135deg, rgba(10,30,18,0.8), rgba(15,40,24,0.5), rgba(20,50,30,0.3))", border: "1px solid rgba(74,222,128,0.12)" }}>
            <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(ellipse at 80% 20%, rgba(163,230,53,0.25), transparent 60%)" }} />
            <div className="absolute inset-0 opacity-15" style={{ background: "radial-gradient(ellipse at 20% 80%, rgba(74,222,128,0.3), transparent 50%)" }} />
            <svg viewBox="0 0 420 200" className="w-full h-full relative" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#22c55e" />
                  <stop offset="50%" stopColor="#4ade80" />
                  <stop offset="100%" stopColor="#a3e635" />
                </linearGradient>
                <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(74,222,128,0.2)" />
                  <stop offset="100%" stopColor="rgba(74,222,128,0)" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path d="M 30 165 C 60 160, 80 152, 110 145 C 140 138, 160 128, 190 118 C 220 108, 240 95, 270 78 C 300 61, 320 42, 350 28 C 370 18, 390 12, 400 10" stroke="url(#lineGrad)" strokeWidth="3" fill="none" filter="url(#glow)" strokeLinecap="round" />
              <path d="M 30 165 C 60 160, 80 152, 110 145 C 140 138, 160 128, 190 118 C 220 108, 240 95, 270 78 C 300 61, 320 42, 350 28 C 370 18, 390 12, 400 10 L 400 190 L 30 190 Z" fill="url(#areaGrad)" />
              {[
                { x: 30, y: 165, label: "V1" },
                { x: 95, y: 148, label: "V2" },
                { x: 160, y: 128, label: "V3" },
                { x: 225, y: 105, label: "V4" },
                { x: 290, y: 72, label: "V5", reward: "30,000 CMX" },
                { x: 350, y: 28, label: "V6", reward: "100,000 CMX" },
                { x: 400, y: 10, label: "V7", reward: "300,000 CMX" },
              ].map((p: any) => (
                <g key={p.label}>
                  <circle cx={p.x} cy={p.y} r="6" fill="rgba(74,222,128,0.15)" stroke="none">
                    <animate attributeName="r" values="6;9;6" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={p.x} cy={p.y} r="4" fill="#4ade80" stroke="#0f2818" strokeWidth="2" />
                  <text x={p.x} y={p.y - 14} textAnchor="middle" fill="white" fontSize="11" fontWeight="700">{p.label}</text>
                  {p.reward && (
                    <text x={p.x + 8} y={p.y + 16} textAnchor="start" fill="rgba(163,230,53,0.55)" fontSize="7.5" fontWeight="500">
                      {p.reward}
                    </text>
                  )}
                </g>
              ))}
              <text x="355" y="68" fill="rgba(255,255,255,0.2)" fontSize="7.5" fontWeight="500">50 people</text>
              <text x="365" y="48" fill="rgba(255,255,255,0.2)" fontSize="7.5" fontWeight="500">200 people</text>
              <text x="340" y="100" fill="rgba(255,255,255,0.12)" fontSize="7">30 people</text>
            </svg>
          </div>

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

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl p-3.5 text-center" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.4)" }}>
            <div className="text-[11px] text-white/50 font-medium mb-2">{t("profile.directInvites")}</div>
            <Users className="h-5 w-5 mx-auto text-white/50 mb-1.5" />
            <div className="text-[18px] font-black text-white">{isConnected ? (teamData?.directCount || 0) : "--"}</div>
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
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full" style={{ background: "linear-gradient(180deg, #4ade80, #22c55e)" }} />
              <span className="text-[13px] font-bold text-white">
                {t("profile.teamMembersCount", { count: teamData?.teamSize || 0 })}
              </span>
            </div>

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
                {teamData.referrals.map((ref) => (
                  <div key={ref.id}>
                    <button
                      className="w-full rounded-xl p-3 flex items-center gap-3 text-left transition-all active:scale-[0.98]"
                      style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.35)" }}
                      onClick={() => drillInto(ref.walletAddress, shortenAddress(ref.walletAddress))}
                    >
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "#4ade80" }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-mono text-white/80 truncate">
                          {shortenAddress(ref.walletAddress)}
                        </div>
                      </div>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0"
                        style={{ background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80" }}
                      >
                        {ref.rank}
                      </span>
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-md font-bold shrink-0"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)" }}
                      >
                        {ref.nodeType}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                    </button>
                    {ref.subReferrals && ref.subReferrals.length > 0 && (
                      <div className="ml-5 mt-1.5 space-y-1.5 border-l-2 pl-3" style={{ borderColor: "rgba(74,222,128,0.15)" }}>
                        {ref.subReferrals.map((sub) => (
                          <button
                            key={sub.id}
                            className="w-full rounded-lg p-2.5 flex items-center gap-2.5 text-left transition-all active:scale-[0.98]"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.15)" }}
                            onClick={() => drillInto(sub.walletAddress, shortenAddress(sub.walletAddress))}
                          >
                            <div className="h-1.5 w-1.5 rounded-full shrink-0 bg-white/25" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-mono text-white/60 truncate">
                                {shortenAddress(sub.walletAddress)}
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
                        ))}
                      </div>
                    )}
                  </div>
                ))}
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
