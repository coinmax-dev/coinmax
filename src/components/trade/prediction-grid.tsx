import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TradeBet } from "@shared/types";

interface CellData {
  direction: "up" | "down";
  change: number;
  isOver5: boolean;
  isReversal: boolean;
  isLatest: boolean;
}

interface PredictionGridProps {
  bets: TradeBet[];
  gridType: "big" | "small";
  timeframe?: string;
}

function generateCellData(bets: TradeBet[], gridType: "big" | "small", timeframe?: string): (CellData | null)[] {
  const cols = gridType === "big" ? 7 : 15;
  const rows = gridType === "big" ? 8 : 8;
  const totalCells = cols * rows;
  const seed = timeframe === "30M" ? 17 : timeframe === "4H" ? 31 : timeframe === "1M" ? 53 : 7;

  const filledCount = gridType === "big"
    ? Math.floor(totalCells * 0.75) + (seed % 8)
    : Math.floor(totalCells * 0.7) + (seed % 15);

  const rawDirs: ("up" | "down")[] = [];
  const rawChanges: number[] = [];

  if (bets && bets.length > 0) {
    for (const bet of bets) {
      rawDirs.push(bet.direction === "up" || bet.direction === "bull" ? "up" : "down");
      rawChanges.push(Math.random() * 8);
    }
  }

  const remaining = filledCount - rawDirs.length;
  for (let i = 0; i < remaining; i++) {
    const v = ((i + seed) * 13 + seed * 3) % 100;
    rawDirs.push(v > 46 ? "up" : "down");
    const changeSeed = ((i + seed) * 7 + seed * 11) % 100;
    rawChanges.push(changeSeed < 12 ? 5 + (changeSeed % 10) * 0.5 : (changeSeed % 45) * 0.1);
  }

  const colData: (CellData | null)[] = [];
  let lastFilledIdx = -1;

  for (let i = 0; i < filledCount && i < rawDirs.length; i++) {
    const dir = rawDirs[i];
    const change = rawChanges[i] ?? 0;
    const isReversal = i > 0 && rawDirs[i] !== rawDirs[i - 1];
    colData.push({
      direction: dir,
      change,
      isOver5: change >= 5,
      isReversal,
      isLatest: false,
    });
    lastFilledIdx = i;
  }
  for (let i = colData.length; i < totalCells; i++) {
    colData.push(null);
  }

  if (lastFilledIdx >= 0 && colData[lastFilledIdx]) {
    colData[lastFilledIdx] = { ...colData[lastFilledIdx]!, isLatest: true };
  }

  if (gridType === "big") {
    const grid: (CellData | null)[] = new Array(totalCells).fill(null);
    for (let seq = 0; seq < totalCells; seq++) {
      const col = Math.floor(seq / rows);
      const row = seq % rows;
      const gridIdx = row * cols + col;
      grid[gridIdx] = colData[seq];
    }
    return grid;
  }

  return colData;
}

function BigRoadGrid({ cells, visibleCount }: { cells: (CellData | null)[]; visibleCount: number }) {
  const cols = 7;
  const rows = 8;
  const gridLine = "1px solid rgba(255,255,255,0.12)";

  return (
    <div className="relative overflow-hidden rounded-lg" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.15)" }}>
      <div className="flex">
        <div className="flex flex-col shrink-0" style={{ width: 24, borderRight: gridLine }}>
          {Array.from({ length: rows }, (_, r) => (
            <div
              key={r}
              className="flex items-center justify-center text-[11px] text-muted-foreground/50 font-mono"
              style={{ height: 46, borderBottom: gridLine }}
              data-testid={`row-label-${r + 1}`}
            >
              {r + 1}
            </div>
          ))}
        </div>

        <div
          className="grid flex-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 46px)`,
          }}
        >
          {Array.from({ length: cols * rows }, (_, i) => {
            const cell = cells[i];
            const gridBorder = { borderRight: gridLine, borderBottom: gridLine };

            if (!cell) return <div key={i} style={gridBorder} />;

            const row = Math.floor(i / cols);
            const col = i % cols;
            const seqIdx = col * rows + row;
            const isVisible = seqIdx < visibleCount;
            const isUp = cell.direction === "up";

            const upBg = "rgba(100,160,40,0.35)";
            const downBg = "rgba(150,25,65,0.4)";
            const upBorderColor = "rgba(160,220,60,0.7)";
            const downBorderColor = "rgba(220,50,100,0.65)";

            return (
              <div
                key={i}
                className="flex items-center justify-center p-[3px]"
                style={gridBorder}
                data-testid={`grid-cell-${i}`}
              >
                <div
                  className={`relative w-full h-full flex items-center justify-center rounded-[4px] transition-all duration-200 ${isVisible ? "opacity-100" : "opacity-0"}`}
                  style={{
                    background: isUp ? upBg : downBg,
                    border: `1.5px solid ${isUp ? upBorderColor : downBorderColor}`,
                    boxShadow: isVisible
                      ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 3px rgba(0,0,0,0.2)`
                      : "none",
                  }}
                >
                  <span className="text-white/90 text-[13px] font-bold select-none" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                    {isUp ? "↑" : "↓"}
                  </span>

                  {cell.isOver5 && isVisible && (
                    <span
                      className="absolute top-[2px] right-[2px] h-[6px] w-[6px] rounded-full"
                      style={{ backgroundColor: "#fbbf24", boxShadow: "0 0 6px #fbbf24, 0 0 12px rgba(251,191,36,0.5)" }}
                    />
                  )}

                  {cell.isReversal && isVisible && (
                    <span
                      className="absolute bottom-[2px] left-[2px] h-[6px] w-[6px] rounded-full"
                      style={{
                        backgroundColor: "#60a5fa",
                        boxShadow: "0 0 6px #60a5fa, 0 0 12px rgba(96,165,250,0.5)",
                        animation: cell.isLatest ? "reversalBounce 1.5s ease-in-out infinite" : "none",
                      }}
                    />
                  )}

                  {cell.isLatest && isVisible && (
                    <div
                      className="absolute inset-[-1px] rounded-[4px]"
                      style={{ border: "2px solid rgba(250,204,21,0.8)", animation: "gridBlink 1.2s ease-in-out infinite" }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex ml-[24px]" style={{ borderTop: gridLine }}>
        {Array.from({ length: cols }, (_, c) => (
          <div
            key={c}
            className="flex-1 text-center text-[11px] text-muted-foreground/50 font-mono py-1.5"
            style={{ borderRight: c < cols - 1 ? gridLine : "none" }}
            data-testid={`col-label-${c + 1}`}
          >
            {c + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SmallRoadColumn {
  direction: "up" | "down";
  circles: { isOver5: boolean }[];
}

function buildSmallRoadColumns(cells: (CellData | null)[]): SmallRoadColumn[] {
  const columns: SmallRoadColumn[] = [];
  let currentDir: "up" | "down" | null = null;
  let currentCol: { isOver5: boolean }[] = [];

  for (const cell of cells) {
    if (!cell) continue;
    if (currentDir === null || cell.direction !== currentDir) {
      if (currentCol.length > 0 && currentDir !== null) {
        columns.push({ direction: currentDir, circles: currentCol });
      }
      currentDir = cell.direction;
      currentCol = [{ isOver5: cell.isOver5 }];
    } else {
      currentCol.push({ isOver5: cell.isOver5 });
    }
  }
  if (currentCol.length > 0 && currentDir !== null) {
    columns.push({ direction: currentDir, circles: currentCol });
  }
  return columns;
}

function SmallRoadGrid({ cells, visibleCount }: { cells: (CellData | null)[]; visibleCount: number }) {
  const columns = useMemo(() => buildSmallRoadColumns(cells), [cells]);
  const maxRows = 9;
  const totalDisplayCols = 13;
  const startCol = Math.max(0, columns.length - (totalDisplayCols - 2));
  const dataCols = columns.slice(startCol);
  const emptyCols = totalDisplayCols - dataCols.length;
  const gridLine = "1px solid rgba(255,255,255,0.12)";

  const colOffsets = useMemo(() => {
    let offset = 0;
    for (let c = 0; c < startCol; c++) {
      offset += Math.min(columns[c].circles.length, maxRows);
    }
    const offsets: number[] = [];
    for (const col of dataCols) {
      offsets.push(offset);
      offset += Math.min(col.circles.length, maxRows);
    }
    return offsets;
  }, [columns, startCol, dataCols, maxRows]);

  return (
    <div className="relative overflow-hidden rounded-lg" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.15)" }}>
      <div className="flex">
        <div className="flex flex-col shrink-0" style={{ width: 24, borderRight: gridLine }}>
          {Array.from({ length: maxRows }, (_, r) => (
            <div
              key={r}
              className="flex items-center justify-center text-[11px] text-muted-foreground/50 font-mono"
              style={{ height: 34, borderBottom: gridLine }}
              data-testid={`row-label-${r + 1}`}
            >
              {r + 1}
            </div>
          ))}
        </div>

        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${totalDisplayCols}, 1fr)` }}
        >
          {dataCols.map((col, ci) => {
            const colCells = col.circles.slice(0, maxRows);
            const isUp = col.direction === "up";
            const strokeColor = isUp ? "#a3e635" : "#fb7185";
            const fillBg = isUp ? "rgba(130,200,50,0.2)" : "rgba(220,60,100,0.2)";
            const fillSolid = isUp ? "rgba(140,210,50,0.55)" : "rgba(230,60,100,0.55)";
            const baseIdx = colOffsets[ci] ?? 0;

            return (
              <div key={ci + startCol} className="flex flex-col">
                {Array.from({ length: maxRows }, (_, ri) => {
                  const circle = colCells[ri];
                  const globalIdx = baseIdx + ri;
                  const isVis = globalIdx < visibleCount;
                  const isLast = ci === dataCols.length - 1 && ri === colCells.length - 1;

                  return (
                    <div
                      key={ri}
                      className="flex items-center justify-center"
                      style={{
                        height: 34,
                        borderRight: gridLine,
                        borderBottom: gridLine,
                      }}
                    >
                      {circle && isVis ? (
                        <div
                          className="rounded-full transition-all duration-200"
                          style={{
                            width: 22,
                            height: 22,
                            border: `2.5px solid ${strokeColor}`,
                            backgroundColor: circle.isOver5 ? fillSolid : fillBg,
                            boxShadow: isLast
                              ? `0 0 8px ${strokeColor}, 0 0 16px ${strokeColor}60, inset 0 1px 0 rgba(255,255,255,0.15)`
                              : `0 0 4px ${strokeColor}40, inset 0 1px 0 rgba(255,255,255,0.1)`,
                            animation: isLast ? "gridBlink 1.2s ease-in-out infinite" : "none",
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {Array.from({ length: emptyCols }, (_, ei) => (
            <div key={`empty-${ei}`} className="flex flex-col">
              {Array.from({ length: maxRows }, (_, ri) => (
                <div
                  key={ri}
                  className="flex items-center justify-center"
                  style={{
                    height: 34,
                    borderRight: gridLine,
                    borderBottom: gridLine,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div
        className="grid ml-[24px]"
        style={{ gridTemplateColumns: `repeat(${totalDisplayCols}, 1fr)` }}
      >
        {Array.from({ length: totalDisplayCols }, (_, ci) => (
          <div
            key={ci}
            className="text-center text-[11px] text-muted-foreground/50 font-mono py-1.5"
            style={{ borderRight: ci < totalDisplayCols - 1 ? gridLine : "none", borderTop: gridLine }}
            data-testid={`col-label-${ci + startCol + 1}`}
          >
            {ci + startCol + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PredictionGrid({ bets, gridType, timeframe }: PredictionGridProps) {
  const { t, i18n } = useTranslation();
  const isZh = i18n.language?.startsWith("zh");
  const [visibleCount, setVisibleCount] = useState(0);
  const cells = useMemo(
    () => generateCellData(bets || [], gridType, timeframe),
    [bets, gridType, timeframe]
  );

  useEffect(() => {
    setVisibleCount(0);
    let frame = 0;
    const batchSize = gridType === "big" ? 3 : 5;
    const interval = setInterval(() => {
      frame += batchSize;
      if (frame >= cells.length) {
        setVisibleCount(cells.length);
        clearInterval(interval);
      } else {
        setVisibleCount(frame);
      }
    }, 18);
    return () => clearInterval(interval);
  }, [cells.length, gridType, timeframe]);

  const filled = cells.filter((c): c is CellData => c !== null);
  const ups = filled.filter(c => c.direction === "up").length;
  const downs = filled.filter(c => c.direction === "down").length;

  return (
    <div data-testid={`prediction-grid-${gridType}`}>
      <div className="flex items-center gap-3 mb-3 text-[12px] flex-wrap">
        <span className="font-bold" style={{ color: "#00e7a0" }} data-testid="text-bull-count">
          {isZh ? "多" : t("trade.bull")}: {ups}
        </span>
        <span className="font-bold" style={{ color: "#ff4976" }} data-testid="text-bear-count">
          {isZh ? "空" : t("trade.bear")}: {downs}
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#fbbf24", boxShadow: "0 0 6px #fbbf24, 0 0 10px rgba(251,191,36,0.4)" }} />
          {isZh ? "超过5%" : ">5%"}
        </span>
        {gridType === "big" && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#60a5fa", boxShadow: "0 0 6px #60a5fa, 0 0 10px rgba(96,165,250,0.4)" }} />
            {isZh ? "反转" : t("trade.reversal")}
          </span>
        )}
      </div>

      {gridType === "big" ? (
        <BigRoadGrid cells={cells} visibleCount={visibleCount} />
      ) : (
        <SmallRoadGrid cells={cells} visibleCount={visibleCount} />
      )}

      <style>{`
        @keyframes gridBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes reversalBounce {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.6); }
        }
      `}</style>
    </div>
  );
}
