import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatUSD } from "@/lib/constants";
import type { CryptoPrice } from "@/hooks/use-crypto-price";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

interface PriceHeaderProps {
  coin: CryptoPrice | undefined;
  isLoading: boolean;
}

export function PriceHeader({ coin, isLoading }: PriceHeaderProps) {
  const { t } = useTranslation();

  if (isLoading || !coin) {
    return (
      <div className="mb-3">
        <Skeleton className="h-4 w-24 mb-2" />
        <Skeleton className="h-9 w-48 mb-1" />
      </div>
    );
  }

  const isPositive = coin.price_change_percentage_24h >= 0;

  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 mb-0.5">
        <img src={coin.image} alt={coin.name} className="h-4 w-4 rounded-full" />
        <span className="text-xs text-muted-foreground/70">{t("dashboard.priceLabel", { symbol: coin.symbol.toUpperCase() })}</span>
      </div>
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className="text-2xl font-bold tracking-tight leading-tight" data-testid="text-price">
          {formatUSD(coin.current_price)}
        </span>
        <Badge
          className={`text-[10px] px-1.5 py-0 ${
            isPositive
              ? "bg-primary/15 text-neon-value no-default-hover-elevate no-default-active-elevate"
              : "bg-red-500/15 text-red-400 no-default-hover-elevate no-default-active-elevate"
          }`}
        >
          {isPositive ? <TrendingUp className="mr-0.5 h-2.5 w-2.5" /> : <TrendingDown className="mr-0.5 h-2.5 w-2.5" />}
          {isPositive ? "+" : ""}{coin.price_change_percentage_24h.toFixed(2)}%
        </Badge>
      </div>
    </div>
  );
}
