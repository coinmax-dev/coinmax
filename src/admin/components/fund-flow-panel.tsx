/**
 * V4 Fund Flow Panel — 资金链路总览
 */

import { useQuery } from "@tanstack/react-query";
import { readContract, getContract } from "thirdweb";
import { bsc } from "thirdweb/chains";
import { useThirdwebClient } from "@/hooks/use-thirdweb";
import {
  MA_TOKEN_ADDRESS, CUSD_ADDRESS, VAULT_V3_ADDRESS, PRICE_ORACLE_ADDRESS,
  USDT_ADDRESS, USDC_ADDRESS, RELEASE_ADDRESS, FLASH_SWAP_ADDRESS,
  ENGINE_WALLET_ADDRESS, SERVER_WALLET_ADDRESS, DEPLOYER_ADDRESS,
  FLASHSWAP_MASTER, FLASHSWAP_ROTATION, PANCAKE_ROUTER_ADDRESS, PANCAKE_USDT_USDC_POOL,
  MA_STAKING_ADDRESS, NODE_NFT_ADDRESS,
} from "@/lib/contracts";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";

function bscScan(addr: string) {
  return `https://bscscan.com/address/${addr}`;
}
function fmt(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

const CONTRACTS = [
  { label: "VaultV4", addr: VAULT_V3_ADDRESS, desc: "cUSD ERC4626 金库" },
  { label: "MA Token", addr: MA_TOKEN_ADDRESS, desc: "MA 代币" },
  { label: "cUSD", addr: CUSD_ADDRESS, desc: "cUSD 稳定币" },
  { label: "Oracle", addr: PRICE_ORACLE_ADDRESS, desc: "MA 价格预言机" },
  { label: "ReleaseV4", addr: RELEASE_ADDRESS, desc: "MA 释放合约" },
  { label: "FlashSwapV4", addr: FLASH_SWAP_ADDRESS, desc: "闪兑合约" },
  { label: "MAStaking", addr: MA_STAKING_ADDRESS, desc: "MA 锁仓" },
  { label: "NodeNFT", addr: NODE_NFT_ADDRESS, desc: "节点 NFT" },
  { label: "PancakeSwap Router", addr: PANCAKE_ROUTER_ADDRESS, desc: "PancakeSwap V3" },
  { label: "USDT/USDC Pool", addr: PANCAKE_USDT_USDC_POOL, desc: "0.01% fee tier" },
];

const WALLETS = [
  { label: "Engine", addr: ENGINE_WALLET_ADDRESS, desc: "Engine 钱包 (铸造/结算)" },
  { label: "Server (Receiver)", addr: SERVER_WALLET_ADDRESS, desc: "USDC 接收钱包" },
  { label: "Deployer", addr: DEPLOYER_ADDRESS, desc: "合约部署者 (Admin)" },
  { label: "FlashSwap Master", addr: FLASHSWAP_MASTER, desc: "闪兑总钱包" },
  ...FLASHSWAP_ROTATION.map((addr, i) => ({ label: `Rotation-${i+1}`, addr, desc: "闪兑轮换" })),
];

export function FundFlowPanel() {
  const { client } = useThirdwebClient();
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["fund-flow-v4", refreshKey],
    queryFn: async () => {
      if (!client) return null;
      const balances: Record<string, { usdc: number; usdt: number; ma: number; bnb: number }> = {};

      const allAddrs = [...WALLETS.map(w => w.addr), ...CONTRACTS.filter(c => c.addr).map(c => c.addr)];
      const uniqueAddrs = Array.from(new Set(allAddrs)).filter(Boolean);

      for (const addr of uniqueAddrs) {
        try {
          const usdcC = getContract({ client, chain: bsc, address: USDC_ADDRESS });
          const usdtC = getContract({ client, chain: bsc, address: USDT_ADDRESS });
          const maC = getContract({ client, chain: bsc, address: MA_TOKEN_ADDRESS });

          const [usdc, usdt, ma] = await Promise.all([
            readContract({ contract: usdcC, method: "function balanceOf(address) view returns (uint256)", params: [addr] }).catch(() => BigInt(0)),
            readContract({ contract: usdtC, method: "function balanceOf(address) view returns (uint256)", params: [addr] }).catch(() => BigInt(0)),
            readContract({ contract: maC, method: "function balanceOf(address) view returns (uint256)", params: [addr] }).catch(() => BigInt(0)),
          ]);

          balances[addr] = {
            usdc: Number(usdc) / 1e18,
            usdt: Number(usdt) / 1e18,
            ma: Number(ma) / 1e18,
            bnb: 0,
          };
        } catch { balances[addr] = { usdc: 0, usdt: 0, ma: 0, bnb: 0 }; }
      }
      return balances;
    },
    enabled: !!client,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white/80">V4 资金链路</h3>
        <button onClick={() => setRefreshKey(k => k + 1)} className="text-[10px] text-primary flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      {/* Wallets */}
      <div>
        <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">Server 钱包</div>
        <div className="space-y-1.5">
          {WALLETS.map(w => {
            const bal = data?.[w.addr];
            return (
              <div key={w.addr} className="flex items-center justify-between bg-white/[0.03] rounded-lg px-3 py-2 text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-white/70">{w.label}</span>
                  <a href={bscScan(w.addr)} target="_blank" rel="noopener" className="text-primary/50 hover:text-primary font-mono">
                    {fmt(w.addr)} <ExternalLink className="h-2.5 w-2.5 inline" />
                  </a>
                  <span className="text-white/20">{w.desc}</span>
                </div>
                <div className="flex gap-3 text-right shrink-0">
                  {isLoading ? <Skeleton className="h-4 w-16" /> : bal ? (
                    <>
                      {bal.usdc > 0.01 && <span className="text-blue-400 font-mono">{bal.usdc.toFixed(2)} USDC</span>}
                      {bal.usdt > 0.01 && <span className="text-green-400 font-mono">{bal.usdt.toFixed(2)} USDT</span>}
                      {bal.ma > 0.01 && <span className="text-primary font-mono">{bal.ma.toFixed(2)} MA</span>}
                      {bal.usdc < 0.01 && bal.usdt < 0.01 && bal.ma < 0.01 && <span className="text-white/20">-</span>}
                    </>
                  ) : <span className="text-white/20">-</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contracts */}
      <div>
        <div className="text-[10px] text-white/40 mb-2 uppercase tracking-wider">合约地址</div>
        <div className="space-y-1">
          {CONTRACTS.map(c => (
            <div key={c.addr} className="flex items-center justify-between text-[10px] px-2 py-1">
              <div className="flex items-center gap-2">
                <span className="text-white/50 font-medium">{c.label}</span>
                <span className="text-white/20">{c.desc}</span>
              </div>
              <a href={bscScan(c.addr)} target="_blank" rel="noopener" className="text-primary/40 hover:text-primary font-mono">
                {fmt(c.addr)} <ExternalLink className="h-2 w-2 inline" />
              </a>
            </div>
          ))}
        </div>
      </div>

      {/* Fund Flow Diagram */}
      <div className="bg-white/[0.02] rounded-xl p-3 text-[9px] text-white/40 space-y-1">
        <div className="text-[10px] text-white/50 font-bold mb-2">资金流向</div>
        <div>入金: 用户 USDT → PancakeSwap(121) → USDC → Server(0xe193)</div>
        <div>结算: Engine 铸造 cUSD/MA → VaultV4 / 用户</div>
        <div>闪兑: 用户 MA → FlashSwap合约(burn) → Master/Rotation USDC → PancakeSwap(121) → USDT → 用户</div>
        <div>释放: Engine mint MA → 用户钱包</div>
      </div>
    </div>
  );
}
