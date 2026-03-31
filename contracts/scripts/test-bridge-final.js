const { ethers } = require("hardhat");
async function main() {
  const BRIDGE = "0xfA44640106D9cb251bA0880B73D503cbf6822F20";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const [d] = await ethers.getSigners();

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);

  console.log("USDT:", ethers.formatEther(await usdt.balanceOf(BRIDGE)));
  console.log("USDC:", ethers.formatEther(await usdc.balanceOf(BRIDGE)));
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));

  const [ready, bal] = await bridge.canBridge();
  console.log("canBridge:", ready, "| USDT:", ethers.formatEther(bal));

  if (!ready) { console.log("Not ready"); return; }

  console.log("\nCalling swapAndBridge()...");
  try {
    const tx = await bridge.swapAndBridge({ gasLimit: 1000000 });
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    console.log("Status:", r.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");
    console.log("Gas:", r.gasUsed.toString());
    console.log("\nAfter:");
    console.log("USDT:", ethers.formatEther(await usdt.balanceOf(BRIDGE)));
    console.log("USDC:", ethers.formatEther(await usdc.balanceOf(BRIDGE)));
    console.log("totalSwapped:", ethers.formatEther(await bridge.totalSwapped()));
    console.log("totalBridged:", ethers.formatEther(await bridge.totalBridged()));
  } catch (e) {
    console.log("❌", e.message?.slice(0, 300));
  }
}
main().catch(console.error);
