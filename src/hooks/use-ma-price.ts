import { useQuery } from "@tanstack/react-query";
import { getMaPrice } from "@/lib/api";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { getPriceOracleContract } from "@/lib/contracts";
import { readContract } from "thirdweb";

const DEFAULT_MA_PRICE = 0.1;

export function useMaPrice() {
  const { client } = useThirdwebClient();

  // Primary: on-chain oracle price (same as K-line chart)
  const { data: oraclePrice } = useQuery({
    queryKey: ["ma-oracle-price-global"],
    queryFn: async () => {
      if (!client) return null;
      try {
        const raw = await readContract({
          contract: getPriceOracleContract(client),
          method: "function price() view returns (uint256)",
          params: [],
        });
        const p = Number(raw) / 1e6;
        return p > 0 ? p : null; // fallback to DB if oracle returns 0
      } catch {
        return null;
      }
    },
    enabled: !!client,
    staleTime: 0,
    refetchInterval: 3_000,
  });

  // Fallback: DB config price (also refreshes frequently to stay current)
  const { data: dbPrice, isLoading } = useQuery({
    queryKey: ["ma-price-db"],
    queryFn: getMaPrice,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  // Oracle takes priority, DB as fallback
  const price = oraclePrice ?? dbPrice?.price ?? DEFAULT_MA_PRICE;
  const source = oraclePrice ? "ORACLE" : dbPrice?.source ?? "DEFAULT";

  const usdcToMA = (usdc: number) => usdc / price;

  const formatMA = (usdc: number) => {
    const ma = usdcToMA(usdc);
    return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ma)} MA`;
  };

  const formatCompactMA = (usdc: number) => {
    const ma = usdcToMA(usdc);
    const zh = (() => { try { return (localStorage.getItem("coinmax-lang") || "en") === "zh"; } catch { return false; } })();
    if (zh) {
      if (ma >= 100_000_000) return `${(ma / 100_000_000).toFixed(2)}亿 MA`;
      if (ma >= 10_000) return `${(ma / 10_000).toFixed(2)}万 MA`;
      return `${ma.toFixed(2)} MA`;
    }
    if (ma >= 1_000_000) return `${(ma / 1_000_000).toFixed(2)}M MA`;
    if (ma >= 1_000) return `${(ma / 1_000).toFixed(1)}K MA`;
    return `${ma.toFixed(2)} MA`;
  };

  return { price, source, isLoading, usdcToMA, formatMA, formatCompactMA };
}
