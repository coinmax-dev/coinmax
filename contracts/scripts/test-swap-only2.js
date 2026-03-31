const { ethers } = require("hardhat");
async function main() {
  const BRIDGE = "0x7a987C68D63Df1C9A1a3a7395cd72CaaEd26acE6";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);

  console.log("USDT:", ethers.formatEther(await usdt.balanceOf(BRIDGE)));
  console.log("USDC:", ethers.formatEther(await usdc.balanceOf(BRIDGE)));

  console.log("\nCalling swapOnly()...");
  try {
    const tx = await bridge.swapOnly({ gasLimit: 500000 });
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    console.log("✅ Status:", r.status);
    console.log("USDT after:", ethers.formatEther(await usdt.balanceOf(BRIDGE)));
    console.log("USDC after:", ethers.formatEther(await usdc.balanceOf(BRIDGE)));
  } catch (e) {
    console.log("❌", e.message?.slice(0, 300));
  }
}
main().catch(console.error);
