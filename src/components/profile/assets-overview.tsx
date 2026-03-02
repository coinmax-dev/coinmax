import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { useQuery } from "@tanstack/react-query";
import { useMaPrice } from "@/hooks/use-ma-price";
import type { Profile } from "@shared/types";
import { getProfile } from "@/lib/api";
import { useTranslation } from "react-i18next";

export function AssetsOverview() {
  const { t } = useTranslation();
  const account = useActiveAccount();
  const { formatMA } = useMaPrice();
  const walletAddr = account?.address || "";

  const { data: profile, isLoading } = useQuery<Profile>({
    queryKey: ["profile", walletAddr],
    queryFn: () => getProfile(walletAddr),
    enabled: !!walletAddr,
  });

  const deposited = Number(profile?.totalDeposited || 0);
  const withdrawn = Number(profile?.totalWithdrawn || 0);
  const referralEarnings = Number(profile?.referralEarnings || 0);
  const net = deposited - withdrawn + referralEarnings;

  return (
    <div className="gradient-green-dark p-4 pt-2 rounded-b-2xl" style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
      <h2 className="text-lg font-bold mb-3" data-testid="text-profile-title">{t("profile.assetsOverview")}</h2>
      <Card className="border-border bg-card/50 glow-green-sm">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] text-muted-foreground mb-1">{t("profile.totalAssets")}</div>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-net-assets">{formatMA(net)}</div>
              )}
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center glow-green-sm">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
