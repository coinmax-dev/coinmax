/**
 * Migrate fundDistributor: 0x1Baa (broken BatchBridge) → 0x85e4 (Server Wallet Primary)
 *
 * Phase 1 (BSC):
 *   1. Withdraw all USDT from old 0x1Baa → Server Wallet Primary (0x85e4)
 *   2. Set Vault V3 fundDistributor → Server Wallet Primary
 *   After this, vault deposits go directly to Server Wallet Primary.
 *   Use thirdweb bridge to cross-chain to ARB manually.
 *
 * Phase 2 (ARB): Read FundRouter slot config (who gets what %)
 *
 * Run:
 *   npx hardhat run scripts/migrate-fund-distributor.js --network bsc
 *   npx hardhat run scripts/migrate-fund-distributor.js --network arbitrum
 */
const { ethers } = require("hardhat");

async function bscPhase() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const OLD_FD = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";
  const NEW_FD = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b"; // Server Wallet Primary
  const VAULT  = "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93";
  const USDT   = "0x55d398326f99059fF775485246999027B3197955";

  const usdt  = await ethers.getContractAt("IERC20", USDT);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);

  // Old bridge only has withdrawAll — use minimal ABI
  const oldBridge = new ethers.Contract(OLD_FD, [
    "function withdrawAll(address to) external",
  ], deployer);

  const oldBal    = await usdt.balanceOf(OLD_FD);
  const newBal    = await usdt.balanceOf(NEW_FD);
  const currentFd = await vault.fundDistributor();

  console.log("\n=== BSC Before ===");
  console.log("Old FD (0x1Baa) USDT:", ethers.formatEther(oldBal));
  console.log("New FD (0x85e4) USDT:", ethers.formatEther(newBal));
  console.log("Vault fundDistributor:", currentFd);

  // 1. Withdraw USDT from old BatchBridge → Server Wallet Primary
  if (oldBal > 0n) {
    console.log("\n[1] Withdrawing", ethers.formatEther(oldBal), "USDT from 0x1Baa → 0x85e4...");
    const tx1 = await oldBridge.withdrawAll(NEW_FD);
    await tx1.wait();
    console.log("✅ TX:", tx1.hash);
  } else {
    console.log("\n[1] Old bridge empty, skip");
  }

  // 2. Set Vault fundDistributor → Server Wallet Primary
  if (currentFd.toLowerCase() !== NEW_FD.toLowerCase()) {
    console.log("[2] Vault.setFundDistributor →", NEW_FD);
    const tx2 = await vault.setFundDistributor(NEW_FD);
    await tx2.wait();
    console.log("✅ TX:", tx2.hash);
  } else {
    console.log("[2] Already set, skip");
  }

  // Verify
  console.log("\n=== BSC After ===");
  console.log("Old FD (0x1Baa) USDT:", ethers.formatEther(await usdt.balanceOf(OLD_FD)));
  console.log("New FD (0x85e4) USDT:", ethers.formatEther(await usdt.balanceOf(NEW_FD)));
  console.log("Vault fundDistributor:", await vault.fundDistributor());
  console.log("\n✅ Done. Vault deposits now go directly to Server Wallet Primary (0x85e4).");
  console.log("   Use thirdweb bridge to cross-chain USDT → ARB when needed.");
}

async function arbPhase() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
  const ARB_USDT = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
  const ARB_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const ARB_USDC_E = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

  const router = await ethers.getContractAt("CoinMaxFundRouter", FUND_ROUTER);
  const usdt   = await ethers.getContractAt("IERC20", ARB_USDT);
  const usdc   = await ethers.getContractAt("IERC20", ARB_USDC);
  const usdce  = await ethers.getContractAt("IERC20", ARB_USDC_E);

  console.log("\n=== ARB FundRouter (0x7123) ===");
  console.log("USDT balance:", ethers.formatUnits(await usdt.balanceOf(FUND_ROUTER), 6));
  console.log("USDC balance:", ethers.formatUnits(await usdc.balanceOf(FUND_ROUTER), 6));
  console.log("USDC.e balance:", ethers.formatUnits(await usdce.balanceOf(FUND_ROUTER), 6));
  console.log("totalFlushed:", ethers.formatUnits(await router.totalFlushed(), 6));

  const slotCount = await router.slotCount();
  console.log("slotCount:", slotCount.toString());

  if (slotCount > 0n) {
    console.log("\n=== Distribution Slots ===");
    for (let i = 0; i < Number(slotCount); i++) {
      try {
        const [wallet, share] = await router.getSlot(i);
        const pct = (Number(share) / 100).toFixed(1);
        console.log(`  Slot ${i}: ${wallet} → ${pct}% (${share}/10000)`);
      } catch (e) {
        console.log(`  Slot ${i}: ❌ Cannot read (not admin?)`);
      }
    }
  } else {
    console.log("\n⚠️  No slots configured! FundRouter has no distribution targets.");
    console.log("   Need to call router.configure(wallets, shares) first.");
  }
}

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId === 56n) {
    await bscPhase();
  } else if (chainId === 42161n) {
    await arbPhase();
  } else {
    console.log("Run with --network bsc or --network arbitrum");
  }
}

main().catch(console.error);
