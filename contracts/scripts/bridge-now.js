/**
 * Bridge NOW — minimal ABI approach
 * Run: npx hardhat run scripts/bridge-now.js --network bsc
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const BB   = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);

  // Use raw ABI since on-chain version differs from source
  const bb = new ethers.Contract(BB, [
    "function owner() view returns (address)",
    "function usdt() view returns (address)",
    "function pendingBalance() view returns (uint256)",
    "function paused() view returns (bool)",
    "function swapAndBridge()",
    "function bridgeOnly()",
    "function withdrawAll(address to)",
    "function withdraw(address to, uint256 amount)",
    "function emergencyWithdraw(address token, address to, uint256 amount)",
    "event SwappedAndBridged(uint256 usdtIn, uint256 usdcOut, uint256 stargeFee, uint256 timestamp)",
  ], deployer);

  const balance = await usdt.balanceOf(BB);
  const bnb     = await ethers.provider.getBalance(BB);
  const owner   = await bb.owner();

  console.log("\n=== BatchBridgeV2 (0x1Baa) ===");
  console.log("USDT:", ethers.formatEther(balance));
  console.log("USDC:", ethers.formatEther(await usdc.balanceOf(BB)));
  console.log("BNB:", ethers.formatEther(bnb));
  console.log("Owner:", owner);
  console.log("Paused:", await bb.paused());

  if (balance == 0n) { console.log("\n❌ No USDT"); return; }

  // Ensure enough BNB for Stargate
  if (bnb < ethers.parseEther("0.03")) {
    console.log("\n⚠️  Low BNB, sending 0.05 BNB for Stargate fees...");
    await (await deployer.sendTransaction({ to: BB, value: ethers.parseEther("0.05") })).wait();
    console.log("✅ Sent 0.05 BNB");
  }

  // Try swapAndBridge first
  console.log("\n🚀 Calling swapAndBridge()...");
  console.log("   " + ethers.formatEther(balance) + " USDT → PancakeSwap → USDC → Stargate → ARB");
  try {
    const tx = await bb.swapAndBridge({ gasLimit: 1000000 });
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    console.log(r.status === 1 ? "✅ SUCCESS!" : "❌ REVERTED");
    console.log("Gas:", r.gasUsed.toString());
  } catch (e) {
    console.log("❌ swapAndBridge failed:", e.message?.slice(0, 300));

    // Try bridgeOnly (maybe USDC is already present)
    const usdcBal = await usdc.balanceOf(BB);
    if (usdcBal > 0n) {
      console.log("\nTrying bridgeOnly() with", ethers.formatEther(usdcBal), "USDC...");
      try {
        const tx2 = await bb.bridgeOnly({ gasLimit: 1000000 });
        console.log("TX:", tx2.hash);
        const r2 = await tx2.wait();
        console.log(r2.status === 1 ? "✅ bridgeOnly SUCCESS!" : "❌ REVERTED");
      } catch (e2) {
        console.log("❌ bridgeOnly also failed:", e2.message?.slice(0, 300));
      }
    }

    // If both fail, try manual: withdraw to deployer then we handle separately
    console.log("\n--- Fallback: withdraw USDT to deployer ---");
    console.log("withdrawAll → deployer, then bridge manually");
    try {
      const tx3 = await bb.withdrawAll(deployer.address);
      console.log("TX:", tx3.hash);
      await tx3.wait();
      console.log("✅ Withdrew to deployer");
      console.log("Deployer USDT:", ethers.formatEther(await usdt.balanceOf(deployer.address)));
    } catch (e3) {
      console.log("❌ withdrawAll failed:", e3.message?.slice(0, 200));
    }
  }

  // Final status
  console.log("\n=== Final Status ===");
  console.log("BB USDT:", ethers.formatEther(await usdt.balanceOf(BB)));
  console.log("BB USDC:", ethers.formatEther(await usdc.balanceOf(BB)));
  console.log("Deployer USDT:", ethers.formatEther(await usdt.balanceOf(deployer.address)));
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch(console.error);
