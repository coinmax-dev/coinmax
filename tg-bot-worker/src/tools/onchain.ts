import type { Env, BotUser, ToolResult } from "../types";

const BSC_RPC = "https://bsc-dataseed1.binance.org";
const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

// Key contract addresses
const CONTRACTS: Record<string, [string, string]> = {
  "Vault": ["0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744", "BSC"],
  "BatchBridge": ["0xAa80a499B8738E3Fd7779057F7E3a7D73c045c4D", "BSC"],
  "Server Wallet": ["0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff", "BSC"],
  "Node Wallet": ["0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9", "BSC"],
  "SwapRouter": ["0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3", "BSC"],
  "Deployer": ["0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1", "BSC"],
  "ARB FundRouter": ["0x71237E535d5E00CDf18A609eA003525baEae3489", "ARB"],
};

const ARB_WALLETS: Record<string, [string, number]> = {
  "Slot0(30%)": ["0xd12097C9A12617c49220c032C84aCc99B6fFf57b", 3000],
  "Slot1(8%)": ["0xDf90770C89732a7eba5B727fCd6a12f827102EE6", 800],
  "Slot2(12%)": ["0x1C4D983620B3c8c2f7607c0943f2A5989e655599", 1200],
  "Slot3(20%)": ["0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff", 2000],
  "Slot4(30%)": ["0x7DEa369864583E792D230D360C0a4C56c2103FE4", 3000],
};

export async function verifyOnchain(env: Env, user: BotUser, params: Record<string, string>): Promise<ToolResult> {
  const check = params.check || "all";
  const parts: string[] = [];

  if (check === "funds" || check === "all") {
    parts.push(await checkAllFunds());
  }
  if (check === "wallet" && params.wallet) {
    parts.push(await checkWallet(params.wallet));
  }
  if (check === "tx" && params.txHash) {
    parts.push(await checkTransaction(params.txHash));
  }
  if (check === "vault_fd" || check === "all") {
    parts.push(await checkVaultConfig());
  }

  return { text: parts.join("\n\n") || "无结果" };
}

async function checkAllFunds(): Promise<string> {
  const lines: string[] = ["<b>⛓ 链上资金验证</b>\n<b>BSC (USDT)</b>"];

  for (const [name, [addr, chain]] of Object.entries(CONTRACTS)) {
    if (chain !== "BSC") continue;
    const bal = await erc20Bal(BSC_RPC, BSC_USDT, addr, 18);
    const bnb = await nativeBal(BSC_RPC, addr);
    lines.push(`  ${name}: $${bal.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDT | ${bnb.toFixed(4)} BNB`);
  }

  lines.push("\n<b>ARB (USDC)</b>");
  const frBal = await erc20Bal(ARB_RPC, ARB_USDC, CONTRACTS["ARB FundRouter"][0], 6);
  lines.push(`  FundRouter: $${frBal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  let arbTotal = frBal;
  for (const [name, [addr]] of Object.entries(ARB_WALLETS)) {
    const bal = await erc20Bal(ARB_RPC, ARB_USDC, addr, 6);
    arbTotal += bal;
    lines.push(`  ${name}: $${bal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  }
  lines.push(`  <b>ARB 合计: $${arbTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>`);

  return lines.join("\n");
}

async function checkWallet(wallet: string): Promise<string> {
  const usdtBal = await erc20Bal(BSC_RPC, BSC_USDT, wallet, 18);
  const bnbBal = await nativeBal(BSC_RPC, wallet);

  // Check if it's a contract
  const code = await rpcCall(BSC_RPC, "eth_getCode", [wallet, "latest"]);
  const isContract = code && code !== "0x" && code.length > 4;

  return `<b>⛓ ${wallet.slice(0, 12)}... 链上数据</b>
类型: ${isContract ? "合约" : "EOA钱包"}
BSC USDT: $${usdtBal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
BSC BNB: ${bnbBal.toFixed(4)}`;
}

async function checkTransaction(txHash: string): Promise<string> {
  const receipt = await rpcCall(BSC_RPC, "eth_getTransactionReceipt", [txHash]);
  if (!receipt) return `TX ${txHash.slice(0, 16)}... 未找到（可能不在BSC上）`;

  const status = parseInt(receipt.status, 16);
  const gasUsed = parseInt(receipt.gasUsed, 16);
  const to = receipt.to;

  // Parse transfer events
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const transfers = (receipt.logs || [])
    .filter((l: any) => l.topics?.[0] === transferTopic)
    .map((l: any) => {
      const from = "0x" + l.topics[1].slice(-40);
      const toAddr = "0x" + l.topics[2].slice(-40);
      const amount = parseInt(l.data, 16) / 1e18;
      return `  ${from.slice(0, 8)}→${toAddr.slice(0, 8)} $${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    })
    .slice(0, 5);

  return `<b>⛓ TX 验证</b>
Hash: <code>${txHash.slice(0, 20)}...</code>
状态: ${status === 1 ? "✅ 成功" : "❌ 失败"}
Gas: ${gasUsed.toLocaleString()}
合约: ${to?.slice(0, 12)}...

<b>Token 转账:</b>
${transfers.join("\n") || "  无"}`;
}

async function checkVaultConfig(): Promise<string> {
  // Read Vault fundDistributor
  const fdData = await rpcCall(BSC_RPC, "eth_call", [{
    to: "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744",
    data: "0xde9d6d59"
  }, "latest"]);
  const fd = fdData ? "0x" + fdData.slice(-40) : "读取失败";

  return `<b>⛓ Vault 配置验证</b>
fundDistributor: <code>${fd}</code>
${fd.includes("aa80") ? "✅ 指向 BatchBridge" : fd.includes("85e4") ? "✅ 指向 Server Wallet" : "⚠️ 未知地址"}`;
}

async function erc20Bal(rpc: string, token: string, holder: string, decimals: number): Promise<number> {
  const data = `0x70a08231000000000000000000000000${holder.slice(2).toLowerCase()}`;
  const result = await rpcCall(rpc, "eth_call", [{ to: token, data }, "latest"]);
  return parseInt(result || "0x0", 16) / (10 ** decimals);
}

async function nativeBal(rpc: string, addr: string): Promise<number> {
  const result = await rpcCall(rpc, "eth_getBalance", [addr, "latest"]);
  return parseInt(result || "0x0", 16) / 1e18;
}

async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<any> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const data: any = await res.json();
    return data.result;
  } catch { return null; }
}
