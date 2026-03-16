import { useState, useEffect, useRef } from "react";

const HL_API = "https://api.hyperliquid.xyz/info";
const VAULT_ADDRESS = "0xd6e56265890b76413d1d527eb9b75e334c0c5b42";

interface HLVaultData {
  tvl: number;
  tvlFormatted: string;
  pnl: number;
  pnlPct: number;
  apr: number;
  followers: number;
  positions: number;
  loaded: boolean;
}

function isZh() {
  try { return (localStorage.getItem("coinmax-lang") || "en") === "zh"; } catch { return false; }
}

function formatTvl(tvl: number) {
  if (isZh()) {
    if (tvl >= 100_000_000) return `$${(tvl / 100_000_000).toFixed(2)}亿`;
    if (tvl >= 10_000) return `$${(tvl / 10_000).toFixed(2)}万`;
    return `$${tvl.toFixed(2)}`;
  }
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(2)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(1)}K`;
  return `$${tvl.toFixed(2)}`;
}

async function fetchVaultData(): Promise<HLVaultData> {
  try {
    // Get vault details
    const detailsRes = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "vaultDetails", vaultAddress: VAULT_ADDRESS }),
    });

    if (!detailsRes.ok) throw new Error(`HTTP ${detailsRes.status}`);
    const details = await detailsRes.json();

    // Get clearinghouse state for positions
    const stateRes = await fetch(HL_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: VAULT_ADDRESS }),
    });

    const state = stateRes.ok ? await stateRes.json() : null;

    const accountValue = state
      ? parseFloat(state.marginSummary?.accountValue || "0")
      : parseFloat(details?.portfolio?.accountValue || "0");

    const allTimePnl = parseFloat(details?.allTimePnl || "0");
    const followers = details?.followerCount || 0;
    const apr = parseFloat(details?.apr || "0") * 100;

    // Count active positions
    const activePositions = state
      ? (state.assetPositions || []).filter((ap: any) => parseFloat(ap.position?.szi || "0") !== 0).length
      : 0;

    // PnL percentage
    const initialDeposit = accountValue - allTimePnl;
    const pnlPct = initialDeposit > 0 ? (allTimePnl / initialDeposit) * 100 : 0;

    return {
      tvl: accountValue,
      tvlFormatted: formatTvl(accountValue),
      pnl: allTimePnl,
      pnlPct,
      apr,
      followers,
      positions: activePositions,
      loaded: true,
    };
  } catch (e) {
    console.error("[useHLVault] fetch error:", e);
    return {
      tvl: 0, tvlFormatted: "$0", pnl: 0, pnlPct: 0,
      apr: 0, followers: 0, positions: 0, loaded: false,
    };
  }
}

/**
 * Hook: fetch HyperLiquid vault TVL + PnL in real-time.
 * Refreshes every 60 seconds.
 */
export function useHLVault() {
  const [data, setData] = useState<HLVaultData>({
    tvl: 0, tvlFormatted: "--", pnl: 0, pnlPct: 0,
    apr: 0, followers: 0, positions: 0, loaded: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const result = await fetchVaultData();
      if (mounted) setData(result);
      timer.current = setTimeout(load, 60_000);
    };

    load();
    return () => { mounted = false; clearTimeout(timer.current); };
  }, []);

  return data;
}
