const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const BB = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";
  const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";

  const bb = await ethers.getContractAt("CoinMaxBatchBridgeV2", BB);
  const usdt = await ethers.getContractAt("IERC20", USDT);

  const bal = await usdt.balanceOf(BB);
  console.log("BatchBridge USDT:", ethers.formatEther(bal));

  if (bal > 0n) {
    // Deployer is owner → withdraw to node wallet directly
    console.log("Withdrawing to node wallet...");
    await (await bb.withdrawAll(NODE_WALLET)).wait();
    console.log("✅ Done");
    console.log("Node Wallet USDT:", ethers.formatEther(await usdt.balanceOf(NODE_WALLET)));
  }
}
main().catch(console.error);
