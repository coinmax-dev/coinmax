import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link2, Copy, Users, UserPlus, ArrowDownToLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { copyText } from "@/lib/copy";
import { useActiveAccount } from "thirdweb/react";
import { useQuery } from "@tanstack/react-query";
import { getReferralTree } from "@/lib/api";
import { shortenAddress, formatCompact } from "@/lib/constants";
import type { Profile } from "@shared/types";
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

interface ReferralCardProps {
  refCode: string | undefined;
}

export function ReferralCard({ refCode }: ReferralCardProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const account = useActiveAccount();
  const walletAddr = account?.address || "";

  const { data: teamData, isLoading } = useQuery<ReferralData>({
    queryKey: ["referrals", walletAddr],
    queryFn: () => getReferralTree(walletAddr),
    enabled: !!walletAddr,
  });

  const copyToClipboard = async (text: string) => {
    await copyText(text);
    toast({ title: t("common.copied"), description: t("common.copiedDesc") });
  };

  const referralLink = refCode ? `${window.location.origin}/r/${refCode}/${refCode}` : "--";

  const totalTeamDeposits = teamData?.referrals.reduce((sum, ref) => {
    const direct = Number(ref.totalDeposited || 0);
    const sub = ref.subReferrals?.reduce((s, r) => s + Number(r.totalDeposited || 0), 0) || 0;
    return sum + direct + sub;
  }, 0) || 0;

  return (
    <div className="space-y-4" style={{ animation: "fadeSlideIn 0.4s ease-out 0.3s both" }}>
      <Card className="border-border bg-card">
        <CardContent className="p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{t("profile.referralLink")}</span>
              <Button
                size="sm"
                onClick={() => copyToClipboard(referralLink)}
                data-testid="button-copy-referral"
              >
                <Link2 className="mr-1 h-3 w-3" /> {t("common.copyLink")}
              </Button>
            </div>
            <div className="text-xs font-mono text-muted-foreground truncate" data-testid="text-referral-link">{referralLink}</div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{t("profile.referralCode")}</span>
              <Button
                size="sm"
                onClick={() => copyToClipboard(refCode || "")}
                data-testid="button-copy-code"
              >
                <Copy className="mr-1 h-3 w-3" /> {t("common.copy")}
              </Button>
            </div>
            <div className="text-xs font-mono text-muted-foreground" data-testid="text-ref-code">
              {refCode || "--"}
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-sm font-bold mb-3">{t("profile.teamPerformance")}</h3>
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-border bg-card">
            <CardContent className="p-3 text-center">
              <Users className="h-4 w-4 text-primary mx-auto mb-1" />
              <div className="text-lg font-bold" data-testid="text-team-size">{teamData?.teamSize || 0}</div>
              <div className="text-[12px] text-muted-foreground">{t("profile.teamSize")}</div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-3 text-center">
              <UserPlus className="h-4 w-4 text-primary mx-auto mb-1" />
              <div className="text-lg font-bold" data-testid="text-direct-count">{teamData?.directCount || 0}</div>
              <div className="text-[12px] text-muted-foreground">{t("profile.direct")}</div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="p-3 text-center">
              <ArrowDownToLine className="h-4 w-4 text-primary mx-auto mb-1" />
              <div className="text-lg font-bold" data-testid="text-team-deposits">{formatCompact(totalTeamDeposits)}</div>
              <div className="text-[12px] text-muted-foreground">{t("profile.deposits")}</div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-3">{t("profile.referralTree")}</h3>
        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : !teamData?.referrals.length ? (
          <Card className="border-border bg-card">
            <CardContent className="p-6 text-center">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground" data-testid="text-no-referrals">
                {t("profile.noTeamMembers")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-0" data-testid="referral-tree">
            {teamData.referrals.map((ref) => (
              <div key={ref.id} className="mb-3">
                <div className="flex items-center gap-2 p-2 rounded-md bg-card border border-border">
                  <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono truncate" data-testid={`text-ref-wallet-${ref.id}`}>
                      {shortenAddress(ref.walletAddress)}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-[11px] no-default-hover-elevate no-default-active-elevate shrink-0">
                    {ref.rank}
                  </Badge>
                  <Badge variant="secondary" className="text-[11px] no-default-hover-elevate no-default-active-elevate shrink-0">
                    {ref.nodeType}
                  </Badge>
                </div>
                {ref.subReferrals && ref.subReferrals.length > 0 && (
                  <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-3">
                    {ref.subReferrals.map((sub) => (
                      <div
                        key={sub.id}
                        className="flex items-center gap-2 p-2 rounded-md bg-card/50 border border-border/50"
                      >
                        <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-mono truncate" data-testid={`text-subref-wallet-${sub.id}`}>
                            {shortenAddress(sub.walletAddress)}
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] no-default-hover-elevate no-default-active-elevate shrink-0">
                          {sub.rank}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
