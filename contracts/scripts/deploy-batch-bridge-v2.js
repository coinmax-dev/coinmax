const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap V2 Router
  const STARGATE_ROUTER = "0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8"; // Stargate V2 BSC
  const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
  const ARB_DST_EID = 30110; // Arbitrum endpoint ID on LayerZero

  console.log("Deploying BatchBridgeV2...");
  const Factory = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
  const bridge = await Factory.deploy(
    USDT, USDC, PANCAKE_ROUTER, STARGATE_ROUTER, ARB_FUND_ROUTER, ARB_DST_EID
  );
  await bridge.waitForDeployment();
  const addr = await bridge.getAddress();
  console.log("BatchBridgeV2:", addr);

  // Update Vault fundDistributor to point to new bridge
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);

  const oldFd = await vault.fundDistributor();
  console.log("Current fundDistributor:", oldFd);

  // Rescue USDT from old bridge
  if (oldFd !== addr) {
    try {
      const oldBridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", oldFd);
      const usdt = await ethers.getContractAt("IERC20", USDT);
      const oldBal = await usdt.balanceOf(oldFd);
      if (oldBal > 0n) {
        console.log("Rescuing", ethers.formatEther(oldBal), "USDT from old bridge...");
        const tx0 = await oldBridge.emergencyWithdraw(USDT, addr, oldBal);
        await tx0.wait();
        console.log("✅ Rescued");
      }
      // Rescue BNB
      const oldBnb = await ethers.provider.getBalance(oldFd);
      if (oldBnb > 0n) {
        console.log("Rescuing", ethers.formatEther(oldBnb), "BNB from old bridge...");
        const tx1 = await oldBridge.emergencyWithdrawNative(addr);
        await tx1.wait();
        console.log("✅ BNB rescued");
      }
    } catch(e) { console.log("Rescue skip:", e.message?.slice(0,80)); }
  }

  console.log("Updating Vault.fundDistributor →", addr);
  const tx = await vault.setFundDistributor(addr);
  await tx.wait();

  // Send BNB for Stargate fees
  console.log("Sending 0.008 BNB to bridge...");
  const tx2 = await deployer.sendTransaction({ to: addr, value: ethers.parseEther("0.008") });
  await tx2.wait();

  console.log("✅ Done");
  console.log("fundDistributor:", await vault.fundDistributor());

  console.log("\n=== Done ===");
  console.log("BatchBridgeV2:", addr);
  console.log("Old BatchBridge: 0x670dbfAA27C9a32023484B4BF7688171E70962f6 (can retire)");
  console.log("\nNext: send BNB to BatchBridgeV2 for Stargate gas fees");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
