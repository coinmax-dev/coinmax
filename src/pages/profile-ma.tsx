import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowDownUp, Info, Wallet } from "lucide-react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { readContract, prepareContractCall, waitForReceipt, getContract } from "thirdweb";
import { approve } from "thirdweb/extensions/erc20";
import { useQuery } from "@tanstack/react-query";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import { getMATokenContract, getUsdtContract, MA_TOKEN_ADDRESS, RELEASE_ADDRESS, BSC_CHAIN } from "@/lib/contracts";
import { transfer } from "thirdweb/extensions/erc20";
import { supabase } from "@/lib/supabase";
import { VAULT_PLANS } from "@/lib/data";
import { useMaPrice } from "@/hooks/use-ma-price";
import { createChart, ColorType, CrosshairMode, LineStyle, type UTCTimestamp } from "lightweight-charts";
import { ProfileNav } from "@/components/profile-nav";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ─── Price Chart ────────────────────────────────────────────

const UP = "#00e7a0";
const DOWN = "#ff4976";

function MAPriceChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [tf, setTf] = useState<"1H" | "4H" | "1D">("1H");
  const [chartMode, setChartMode] = useState<"candle" | "area">("area");
  const { price: livePrice } = useMaPrice();

  const buildData = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    const launch = Math.floor(new Date("2026-03-24T00:00:00Z").getTime() / 1000);
    const hoursSince = Math.floor((now - launch) / 3600);

    const intervals = { "1H": 3600, "4H": 14400, "1D": 86400 };
    const sec = intervals[tf];
    const count = tf === "1H" ? Math.min(hoursSince + 1, 168) : tf === "4H" ? Math.min(Math.ceil(hoursSince / 4) + 1, 84) : 30;

    // Deterministic RNG
    const rng = (s: number) => {
      let h = Math.abs(s | 0) * 2654435761;
      h = ((h >>> 16) ^ h) * 0x45d9f3b;
      h = ((h >>> 16) ^ h) * 0x45d9f3b;
      return ((h >>> 16) ^ h & 0xFFFF) / 0xFFFF;
    };
    const ss = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * x * (x * (x * 6 - 15) + 10); };

    const mom = [
      { b: 0.6, v: 0.015 }, { b: 0.8, v: 0.02 }, { b: 1.0, v: 0.025 },
      { b: 0.3, v: 0.02 }, { b: 0.9, v: 0.025 }, { b: 1.2, v: 0.03 }, { b: 0.7, v: 0.02 },
    ];
    const hourPat = [0.3,0.2,0.1,0,-0.1,-0.2,0.4,0.6,0.8,0.7,0.5,0.3,0.5,0.7,0.9,1,0.8,0.6,0.4,0.2,0,-0.1,0.1,0.2];

    const data: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
    let prev = 0.30;

    for (let i = 0; i < count; i++) {
      const t = (launch + i * sec) as UTCTimestamp;
      const h = Math.floor((i * sec) / 3600);
      const di = Math.min(Math.floor(h / 24), 6);
      const d = mom[di] || mom[6];

      // Price for each sub-candle tick
      const ticks: number[] = [];
      const subCount = tf === "1H" ? 4 : tf === "4H" ? 8 : 24;

      for (let j = 0; j < subCount; j++) {
        const subH = h + j * (sec / 3600 / subCount);
        const prog = Math.min(subH / 168, 1);
        const trend = 0.30 + 0.60 * ss(prog);
        const hBias = hourPat[Math.floor(subH) % 24] * 0.005 * d.b;
        const noise = (rng(Math.floor(subH) * 7 + j * 13 + 1) - 0.5) * 2 * d.v;
        const isDip = rng(Math.floor(subH) * 31 + j * 17 + 3) < 0.12;
        const isSpk = !isDip && rng(Math.floor(subH) * 47 + j * 19 + 5) < 0.10;
        let p = trend * (1 + noise + hBias + (isDip ? -d.v * 1.5 : 0) + (isSpk ? d.v * 2 : 0));
        if (prev > 0) { const m = prev * 0.03; p = Math.max(prev - m, Math.min(prev + m, p)); }
        p = Math.max(0.28, p);
        ticks.push(p);
        prev = p;
      }

      const o = ticks[0];
      const c = ticks[ticks.length - 1];
      const hi = Math.max(...ticks);
      const lo = Math.min(...ticks);

      data.push({
        time: t,
        open: +o.toFixed(4),
        high: +hi.toFixed(4),
        low: +lo.toFixed(4),
        close: +c.toFixed(4),
      });
    }

    // Force last candle close = live oracle price (unified across all timeframes)
    if (data.length > 0 && livePrice > 0) {
      const last = data[data.length - 1];
      last.close = +livePrice.toFixed(4);
      last.high = +Math.max(last.high, livePrice).toFixed(4);
      last.low = +Math.min(last.low, livePrice).toFixed(4);
    }

    return data;
  }, [tf, livePrice]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const isMobile = window.innerWidth < 768;
    const h = isMobile ? 240 : 340;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: h,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(255,255,255,0.35)",
        fontSize: isMobile ? 10 : 12,
        fontFamily: "'Space Grotesk', 'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.025)" },
        horzLines: { color: "rgba(255,255,255,0.025)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(0,231,160,0.3)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "rgba(0,231,160,0.85)" },
        horzLine: { color: "rgba(0,231,160,0.3)", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "rgba(0,231,160,0.85)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.05, bottom: 0.15 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: isMobile ? 4 : 8,
        barSpacing: isMobile ? 5 : 10,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const klineData = buildData();

    if (chartMode === "candle") {
      const series = chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN,
        borderUpColor: UP, borderDownColor: DOWN,
        wickUpColor: UP, wickDownColor: DOWN,
      });
      series.setData(klineData);
    } else {
      // Area chart (smoother, better on mobile)
      const series = chart.addAreaSeries({
        topColor: "rgba(0,231,160,0.20)",
        bottomColor: "rgba(0,231,160,0.01)",
        lineColor: UP,
        lineWidth: 2,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: UP,
        crosshairMarkerBackgroundColor: "#0a0f0d",
      });
      series.setData(klineData.map(d => ({ time: d.time, value: d.close })));
    }

    // Volume bars
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volSeries.setData(klineData.map(d => ({
      time: d.time,
      value: Math.abs(d.close - d.open) * 1e6 + Math.random() * 5000,
      color: d.close >= d.open ? "rgba(0,231,160,0.15)" : "rgba(255,73,118,0.15)",
    })));

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        const newH = window.innerWidth < 768 ? 240 : 340;
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height: newH });
      }
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chartRef.current?.remove(); chartRef.current = null; };
  }, [tf, chartMode, buildData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          {(["1H", "4H", "1D"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[10px] font-bold font-mono transition-all",
                tf === t ? "bg-primary/15 text-primary" : "text-white/20 hover:text-white/40"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          {(["area", "candle"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setChartMode(m)}
              className={cn(
                "px-2 py-1 rounded text-[9px] font-medium transition-all",
                chartMode === m ? "bg-white/10 text-white/60" : "text-white/15 hover:text-white/30"
              )}
            >
              {m === "area" ? "面积" : "K线"}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="rounded-lg overflow-hidden" />
    </div>
  );
}

// ─── Swap ────────────────────────────────────────────────────

function MASwap() {
  const account = useActiveAccount();
  const { client } = useThirdwebClient();
  const { mutateAsync: sendTransaction } = useSendTransaction();
  const [maAmount, setMaAmount] = useState("");
  const [outputToken, setOutputToken] = useState<"USDT" | "USDC">("USDT");
  const [isSwapped, setIsSwapped] = useState(false);
  const [swapStatus, setSwapStatus] = useState<"idle" | "transferring" | "recording" | "success" | "error">("idle");
  const [swapError, setSwapError] = useState("");

  const { data: maBalanceRaw } = useQuery({
    queryKey: ["ma-balance", account?.address],
    queryFn: async () => {
      if (!account?.address || !client) return BigInt(0);
      return readContract({ contract: getMATokenContract(client), method: "function balanceOf(address) view returns (uint256)", params: [account.address] });
    },
    enabled: !!account?.address && !!client,
    refetchInterval: 15000,
  });

  const { price: maPrice } = useMaPrice();

  const maBalance = Number(maBalanceRaw || BigInt(0)) / 1e18;
  const swapQuota = maBalance / 2;
  const inputAmount = parseFloat(maAmount) || 0;
  const outputAmount = isSwapped ? inputAmount / maPrice : inputAmount * maPrice;
  const exceedsQuota = !isSwapped && inputAmount > swapQuota;
  const fee = inputAmount * maPrice * 0.003;
  const isBusy = swapStatus === "transferring" || swapStatus === "recording";

  // Swap history
  const { data: swapHistory } = useQuery({
    queryKey: ["ma-swap-history", account?.address],
    queryFn: async () => {
      if (!account?.address) return [];
      const { data } = await import("@/lib/supabase").then(m =>
        m.supabase.from("ma_swap_records").select("*").eq("wallet_address", account!.address).order("created_at", { ascending: false }).limit(10)
      );
      return data || [];
    },
    enabled: !!account?.address,
  });

  const handleSwap = async () => {
    if (!account || !client || inputAmount <= 0 || exceedsQuota) return;
    const receiverAddress = import.meta.env.VITE_VIP_RECEIVER_ADDRESS || "0x93F655C3C6B595600fc735118dcEE10cd63d4C8f";
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    setSwapError("");
    try {
      setSwapStatus("transferring");

      // MA→USDT: transfer MA; USDT→MA: transfer USDT
      const contract = isSwapped ? getUsdtContract(client) : getMATokenContract(client);
      const tx = transfer({ contract, to: receiverAddress, amount: inputAmount });
      const result = await sendTransaction(tx);
      const receipt = await waitForReceipt({ client, chain: BSC_CHAIN, transactionHash: result.transactionHash });
      if (receipt.status === "reverted") throw new Error("Transaction reverted");

      // Record via edge function
      setSwapStatus("recording");
      const resp = await fetch(`${supabaseUrl}/functions/v1/ma-swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: account.address,
          txHash: receipt.transactionHash,
          direction: isSwapped ? "buy" : "sell",
          maAmount: inputAmount,
          outputToken,
          maPrice,       // oracle price follows K-line
          maBalance,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Swap failed");

      setSwapStatus("success");
      setMaAmount("");
      queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
      queryClient.invalidateQueries({ queryKey: ["ma-swap-history"] });
      setTimeout(() => setSwapStatus("idle"), 3000);
    } catch (err: any) {
      setSwapError(err.message || "Swap failed");
      setSwapStatus("error");
      setTimeout(() => setSwapStatus("idle"), 5000);
    }
  };

  return (
    <div className="space-y-3">
      {/* Balance + Quota */}
      <div className="rounded-2xl p-3.5" style={{ background: "linear-gradient(135deg, rgba(0,188,165,0.06) 0%, rgba(0,100,80,0.06) 100%)", border: "1px solid rgba(0,188,165,0.12)" }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] text-white/50">MA 余额</span>
          </div>
          <span className="text-[11px] text-white/30 font-mono">≈ ${(maBalance * maPrice).toFixed(2)}</span>
        </div>
        <div className="text-[22px] font-bold font-mono tracking-tight text-white">
          {maBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-[13px] text-primary">MA</span>
        </div>
        <div className="mt-2.5 flex gap-2">
          <div className="flex-1 bg-white/5 rounded-lg px-2.5 py-1.5">
            <div className="text-[9px] text-white/30">闪兑额度</div>
            <div className="text-[13px] font-semibold font-mono text-primary">{swapQuota.toLocaleString("en-US", { maximumFractionDigits: 0 })} MA</div>
          </div>
          <div className="flex-1 bg-white/5 rounded-lg px-2.5 py-1.5">
            <div className="text-[9px] text-white/30">MA 价格</div>
            <div className="text-[13px] font-semibold font-mono text-green-400">${maPrice.toFixed(4)}</div>
          </div>
        </div>
      </div>

      {/* Swap Card */}
      <div className="rounded-2xl p-3 sm:p-3.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        {/* Chain + From */}
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] text-white/30">{isSwapped ? "支付" : "卖出"}</div>
          <div className="flex items-center gap-1 text-[8px] text-yellow-400/50">
            <div className="w-2 h-2 rounded-full bg-yellow-500/30" />
            BSC Chain
          </div>
        </div>
        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5">
          <input
            type="number"
            value={maAmount}
            onChange={(e) => setMaAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-[16px] sm:text-[18px] font-mono font-semibold text-white outline-none placeholder:text-white/10 min-w-0"
          />
          <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1 shrink-0">
            <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold", isSwapped ? "bg-yellow-500/20 text-yellow-400" : "bg-primary/20 text-primary")}>
              {isSwapped ? "$" : "M"}
            </div>
            <span className="text-[11px] font-medium">{isSwapped ? outputToken : "MA"}</span>
          </div>
        </div>

        {!isSwapped && (
          <button onClick={() => setMaAmount(swapQuota.toFixed(0))} className="text-[9px] text-primary mt-1 ml-1">
            MAX {swapQuota.toFixed(0)}
          </button>
        )}

        {/* Swap Button */}
        <div className="flex justify-center -my-0.5 relative z-10">
          <button onClick={() => { setIsSwapped(!isSwapped); setMaAmount(""); }}
            className="w-7 h-7 rounded-full bg-card border border-white/10 flex items-center justify-center hover:border-primary/40 transition-all">
            <ArrowDownUp className="h-3 w-3 text-white/50" />
          </button>
        </div>

        {/* To */}
        <div className="text-[10px] text-white/30 mb-1">获得</div>
        <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5">
          <div className="flex-1 text-[16px] sm:text-[18px] font-mono font-semibold text-white/70 min-w-0">
            {inputAmount > 0 ? outputAmount.toFixed(isSwapped ? 2 : 4) : "0.00"}
            </div>
          <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1 shrink-0">
            <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold", isSwapped ? "bg-primary/20 text-primary" : "bg-yellow-500/20 text-yellow-400")}>
              {isSwapped ? "M" : "$"}
            </div>
            {!isSwapped ? (
              <select value={outputToken} onChange={(e) => setOutputToken(e.target.value as any)}
                className="text-[11px] font-medium bg-transparent outline-none">
                <option value="USDT">USDT</option>
                <option value="USDC">USDC</option>
              </select>
            ) : <span className="text-[11px] font-medium">MA</span>}
          </div>
        </div>

        {/* Info */}
        <div className="mt-2 px-0.5 space-y-0.5">
          <div className="flex justify-between text-[9px]">
            <span className="text-white/25">汇率</span>
            <span className="text-white/40 font-mono">1 MA = ${maPrice.toFixed(4)}</span>
          </div>
          <div className="flex justify-between text-[9px]">
            <span className="text-white/25">手续费</span>
            <span className="text-white/40 font-mono">0.3%</span>
          </div>
        </div>

        {exceedsQuota && (
          <div className="mt-2 flex items-start gap-1.5 bg-red-500/8 border border-red-500/15 rounded-lg px-2.5 py-1.5">
            <Info className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
            <span className="text-[10px] text-red-300">超出闪兑额度，需保留至少50% MA</span>
          </div>
        )}

        {/* Fee + status */}
        {inputAmount > 0 && !exceedsQuota && (
          <div className="flex justify-between text-[9px] mt-1 px-0.5">
            <span className="text-white/25">手续费</span>
            <span className="text-white/40 font-mono">${fee.toFixed(4)}</span>
          </div>
        )}

        {swapStatus === "success" && (
          <div className="mt-2 text-center text-[11px] text-green-400 bg-green-500/8 rounded-lg py-1.5">闪兑成功</div>
        )}
        {swapStatus === "error" && swapError && (
          <div className="mt-2 text-[10px] text-red-300 bg-red-500/8 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
            <Info className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
            {swapError}
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!account || inputAmount <= 0 || exceedsQuota || isBusy}
          className={cn(
            "w-full mt-3 py-3 rounded-xl text-[13px] font-bold transition-all",
            !account || exceedsQuota || inputAmount <= 0 || isBusy
              ? "bg-white/5 text-white/20"
              : "bg-primary text-black hover:bg-primary/90 active:scale-[0.98]"
          )}
        >
          {isBusy
            ? (swapStatus === "transferring" ? "转账中..." : "记录中...")
            : !account ? "连接钱包"
            : exceedsQuota ? "超出额度"
            : inputAmount <= 0 ? "输入数量"
            : isSwapped ? "买入 MA"
            : `闪兑 ${outputToken}`}
        </button>
      </div>

      {/* Swap History */}
      {swapHistory && swapHistory.length > 0 && (
        <div className="rounded-2xl p-3.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <h3 className="text-[11px] font-bold text-white/40 mb-2">闪兑记录</h3>
          <div className="space-y-1.5">
            {swapHistory.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-1.5 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded", s.direction === "sell" ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400")}>
                    {s.direction === "sell" ? "卖出" : "买入"}
                  </span>
                  <span className="text-[11px] text-white/50 font-mono">{Number(s.ma_amount).toFixed(2)} MA</span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-white/40 font-mono">${Number(s.usd_amount).toFixed(2)}</span>
                  <p className="text-[8px] text-white/15">{new Date(s.created_at).toLocaleDateString("zh-CN")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────

export default function ProfileMAPage() {
  const [, navigate] = useLocation();
  const { price } = useMaPrice();

  return (
    <div className="min-h-screen pb-28 lg:pb-8 lg:pt-4" style={{ background: "#0a0a0a" }}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-center relative lg:justify-start">
          <button onClick={() => navigate("/profile")} className="absolute left-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors lg:hidden">
            <ArrowLeft className="h-5 w-5 text-white/80" />
          </button>
          <h1 className="text-[15px] font-bold tracking-wide">MA Token</h1>
        </div>
      </div>

      <div className="flex lg:gap-4">
        <ProfileNav />
        <div className="flex-1 min-w-0 px-3 sm:px-4 lg:px-0 lg:pr-4 space-y-3 max-w-lg mx-auto lg:max-w-none lg:mx-0 overflow-hidden">
          {/* Price Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-end gap-2">
              <div>
                <div className="text-[10px] text-white/30 font-mono">MA / USD</div>
                <div className="text-[24px] sm:text-[26px] font-bold font-mono tracking-tight leading-none text-white">${price.toFixed(4)}</div>
              </div>
              <div className="text-[11px] font-semibold font-mono mb-0.5 text-green-400">+{((price - 0.30) / 0.30 * 100).toFixed(1)}%</div>
            </div>
            <div className="flex items-center gap-1 bg-yellow-500/8 border border-yellow-500/15 rounded-lg px-2 py-1">
              <div className="w-3 h-3 rounded-full bg-yellow-500/30 flex items-center justify-center text-[7px] font-bold text-yellow-400">B</div>
              <span className="text-[9px] text-yellow-400/70 font-semibold">BSC</span>
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-xl p-2 sm:p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <MAPriceChart />
          </div>

          {/* Vault Redeem */}
          <VaultRedeemSection />

          {/* MA Release (profit distribution) */}
          <MAReleaseSection />

          {/* Swap */}
          <MASwap />
        </div>
      </div>
    </div>
  );
}

// ─── Vault Redeem ────────────────────────────────────────────

function VaultRedeemSection() {
  const account = useActiveAccount();
  const { price: maPrice } = useMaPrice();
  const [redeeming, setRedeeming] = useState<string | null>(null);

  const { data: positions = [], refetch } = useQuery({
    queryKey: ["vault-positions-ma", account?.address],
    queryFn: async () => {
      if (!account?.address) return [];
      const { data: profile } = await supabase.from("profiles").select("id").eq("wallet_address", account.address).single();
      if (!profile) return [];
      const { data } = await supabase.from("vault_positions").select("*").eq("user_id", profile.id).eq("status", "ACTIVE").order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!account?.address,
  });

  if (!account || positions.length === 0) return null;

  const handleRedeem = async (pos: any) => {
    setRedeeming(pos.id);
    try {
      const { data: profile } = await supabase.from("profiles").select("id").eq("wallet_address", account!.address).single();
      if (!profile) throw new Error("Profile not found");

      // Call vault_withdraw RPC
      const { error } = await supabase.rpc("vault_withdraw", { addr: account!.address, pos_id: pos.id });
      if (error) throw error;

      refetch();
      queryClient.invalidateQueries({ queryKey: ["ma-balance"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    } catch (e: any) {
      console.error("Redeem failed:", e);
    } finally {
      setRedeeming(null);
    }
  };

  return (
    <div className="rounded-2xl p-3.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <h3 className="text-[12px] font-bold text-white/50 mb-2">金库锁仓赎回</h3>
      <div className="space-y-2">
        {positions.map((pos: any) => {
          const principal = Number(pos.principal);
          const totalMA = principal / maPrice;
          const end = pos.end_date ? new Date(pos.end_date) : null;
          const now = new Date();
          const isEarly = end ? now < end : false;
          const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400_000)) : 0;
          const penaltyMA = isEarly ? totalMA * 0.20 : 0;
          const receiveMA = totalMA - penaltyMA;
          const planConfig = VAULT_PLANS[pos.plan_type as keyof typeof VAULT_PLANS];

          return (
            <div key={pos.id} className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-bold text-white/70">${principal} USDT</span>
                  <span className="text-[10px] text-white/30">{planConfig?.label || pos.plan_type}</span>
                </div>
                <span className={cn("text-[10px] font-semibold", isEarly ? "text-yellow-400" : "text-green-400")}>
                  {isEarly ? `${daysLeft}天后到期` : "已到期"}
                </span>
              </div>

              <div className="text-[10px] space-y-1 text-white/40">
                <div className="flex justify-between">
                  <span>铸造 MA</span>
                  <span className="font-mono text-white/60">{totalMA.toFixed(2)} MA</span>
                </div>
                {isEarly && (
                  <div className="flex justify-between text-red-400/80">
                    <span>提前罚金 (20%)</span>
                    <span className="font-mono">-{penaltyMA.toFixed(2)} MA</span>
                  </div>
                )}
                <div className="flex justify-between text-white/60 font-semibold pt-1 border-t border-white/[0.05]">
                  <span>赎回获得</span>
                  <span className="font-mono text-primary">{receiveMA.toFixed(2)} MA</span>
                </div>
              </div>

              <button
                onClick={() => handleRedeem(pos)}
                disabled={redeeming === pos.id}
                className={cn(
                  "w-full py-2 rounded-lg text-[11px] font-bold transition-all",
                  redeeming === pos.id ? "bg-white/5 text-white/20" : "bg-primary/10 text-primary hover:bg-primary/20"
                )}
              >
                {redeeming === pos.id ? "赎回中..." : isEarly ? "提前赎回 (获得80% MA)" : "赎回 (100% MA)"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MA Release (profit distribution) ────────────────────────

function MAReleaseSection() {
  const account = useActiveAccount();
  const { client } = useThirdwebClient();

  const { data: accumulatedRaw } = useQuery({
    queryKey: ["ma-accumulated-section", account?.address],
    queryFn: async () => {
      if (!account?.address || !client || !RELEASE_ADDRESS) return BigInt(0);
      const contract = getContract({ client, chain: BSC_CHAIN, address: RELEASE_ADDRESS });
      return readContract({ contract, method: "function accumulated(address) view returns (uint256)", params: [account.address] });
    },
    enabled: !!account?.address && !!client && !!RELEASE_ADDRESS,
    refetchInterval: 15000,
  });

  const accumulated = Number(accumulatedRaw || BigInt(0)) / 1e18;

  if (!account || accumulated <= 0) return null;

  return (
    <div className="rounded-2xl p-3.5" style={{ background: "rgba(0,188,165,0.04)", border: "1px solid rgba(0,188,165,0.12)" }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] font-bold text-white/50">MA 盈利分红</h3>
        <span className="text-[13px] font-bold font-mono text-primary">{accumulated.toFixed(2)} MA</span>
      </div>
      <p className="text-[10px] text-white/30 mb-2">可提取的利息收益，选择释放方案后进入线性释放</p>
      <button
        onClick={() => window.location.href = "/vault"}
        className="w-full py-2 rounded-lg text-[11px] font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-all"
      >
        前往金库提取 →
      </button>
    </div>
  );
}

