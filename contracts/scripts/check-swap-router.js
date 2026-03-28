const { ethers } = require("hardhat");

async function main() {
  const GATEWAY = "0xaC126bd86728D81dA05Df67f1E262085d072C36D";
  const gw = await ethers.getContractAt("CoinMaxGateway", GATEWAY);

  console.log("=== Gateway Swap Config ===");
  console.log("  dexRouter:", await gw.dexRouter());
  console.log("  poolFee:", (await gw.poolFee()).toString());
  console.log("  usdt:", await gw.usdt());
  console.log("  usdc:", await gw.usdc());
  console.log("  maxSlippageBps:", (await gw.maxSlippageBps()).toString());
  console.log("  maxDepositAmount:", ethers.formatEther(await gw.maxDepositAmount()), "USDT");
  console.log("  cooldownPeriod:", (await gw.cooldownPeriod()).toString(), "seconds");

  // Check the PancakeSwap V3 router
  const PANCAKE = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
  console.log("\n  Expected PancakeSwap V3 Router:", PANCAKE);
  
  const actual = await gw.dexRouter();
  console.log("  Match:", actual.toLowerCase() === PANCAKE.toLowerCase() ? "✅" : "❌");

  // Check NodesV2 for comparison
  const NODES_V2 = "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";
  const nodes = await ethers.getContractAt("CoinMaxNodesV2", NODES_V2);
  console.log("\n=== NodesV2 Config ===");
  console.log("  swapRouter:", await nodes.swapRouter());
  console.log("  usdc:", await nodes.usdc());
  console.log("  fundDistributor:", await nodes.fundDistributor());
  
  // The old working SwapRouter
  const OLD_SWAP = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  console.log("\n=== Old SwapRouter (working) ===");
  try {
    const oldSR = await ethers.getContractAt("CoinMaxSwapRouter", OLD_SWAP);
    console.log("  pancakeRouter:", await oldSR.pancakeRouter());
    console.log("  usdt:", await oldSR.usdt());
    console.log("  usdc:", await oldSR.usdc());
    console.log("  poolFee:", (await oldSR.poolFee()).toString());
  } catch (e) {
    // Try reading manually
    const iface = new ethers.Interface([
      "function pancakeRouter() view returns (address)",
      "function usdt() view returns (address)",
      "function usdc() view returns (address)",
      "function poolFee() view returns (uint24)",
    ]);
    const provider = ethers.provider;
    const read = async (sig) => {
      const data = iface.encodeFunctionData(sig);
      const result = await provider.call({ to: OLD_SWAP, data });
      return iface.decodeFunctionResult(sig, result)[0];
    };
    console.log("  pancakeRouter:", await read("pancakeRouter"));
    console.log("  usdt:", await read("usdt"));
    console.log("  usdc:", await read("usdc"));
    console.log("  poolFee:", (await read("poolFee")).toString());
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
