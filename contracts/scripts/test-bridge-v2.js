const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const OLD_BRIDGE = "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db";
  const NEW_BRIDGE = "0xe45BBF56B16bF37dA3D4c7C7fB9Cb55eDb9fbedD";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // 1. Verify fundDistributor points to new bridge
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const fd = await vault.fundDistributor();
  console.log("Vault.fundDistributor:", fd);
  if (fd.toLowerCase() !== NEW_BRIDGE.toLowerCase()) {
    console.log("Updating fundDistributor...");
    const tx0 = await vault.setFundDistributor(NEW_BRIDGE);
    await tx0.wait();
    console.log("✅ Updated to", NEW_BRIDGE);
  }

  // 2. Rescue USDT from old bridge
  const oldBal = await usdt.balanceOf(OLD_BRIDGE);
  console.log("\nOld bridge USDT:", ethers.formatEther(oldBal));
  if (oldBal > 0n) {
    console.log("Rescuing USDT from old bridge...");
    const oldBridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", OLD_BRIDGE);
    const tx1 = await oldBridge.emergencyWithdraw(USDT, NEW_BRIDGE, oldBal);
    await tx1.wait();
    console.log("✅ Rescued to new bridge");
  }

  // 3. Send BNB to new bridge
  const newBnb = await ethers.provider.getBalance(NEW_BRIDGE);
  console.log("\nNew bridge BNB:", ethers.formatEther(newBnb));
  if (newBnb < ethers.parseEther("0.005")) {
    console.log("Sending 0.008 BNB...");
    const tx2 = await deployer.sendTransaction({ to: NEW_BRIDGE, value: ethers.parseEther("0.008") });
    await tx2.wait();
    console.log("✅ BNB sent");
  }

  // 4. Check status
  const newBridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", NEW_BRIDGE);
  const newUsdt = await usdt.balanceOf(NEW_BRIDGE);
  console.log("\n=== New Bridge Status ===");
  console.log("USDT:", ethers.formatEther(newUsdt));
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BRIDGE)));

  const [ready, bal] = await newBridge.canBridge();
  console.log("canBridge:", ready, "| USDT:", ethers.formatEther(bal));

  if (!ready) {
    console.log("Not ready — need more USDT or wait for interval");
    return;
  }

  // 5. Test swapAndBridge
  console.log("\nCalling swapAndBridge()...");
  try {
    const tx = await newBridge.swapAndBridge({ gasLimit: 800000 });
    console.log("TX:", tx.hash);
    const receipt = await tx.wait();
    console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");

    console.log("\nAfter:");
    console.log("USDT:", ethers.formatEther(await usdt.balanceOf(NEW_BRIDGE)));
    console.log("USDC:", ethers.formatEther(await (await ethers.getContractAt("IERC20", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d")).balanceOf(NEW_BRIDGE)));
    console.log("totalSwapped:", ethers.formatEther(await newBridge.totalSwapped()));
    console.log("totalBridged:", ethers.formatEther(await newBridge.totalBridged()));
  } catch (e) {
    console.log("❌ FAILED:", e.message?.slice(0, 300));

    // Try just the swap without bridge to isolate the issue
    console.log("\nTrying to debug — checking PancakeSwap V2 swap...");
    const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
    const pcs = new ethers.Contract(router, [
      "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
    ], deployer);
    try {
      const amounts = await pcs.getAmountsOut(newUsdt, [USDT, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"]);
      console.log("V2 quote:", ethers.formatEther(amounts[0]), "USDT →", ethers.formatEther(amounts[1]), "USDC");
    } catch (e2) {
      console.log("V2 quote failed:", e2.message?.slice(0, 100));
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
