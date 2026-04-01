/**
 * Fix Fund Flow — One script to fix everything
 *
 * Problem: OLD Vault(0xE0A8) fundDistributor → 0x1Baa (broken BB)
 *          Scattered USDT: 0x1Baa(5100) + deployer(9001) + 0x85e4(8600)
 *
 * Fix:
 *   1. OLD Vault.setFundDistributor → Server Wallet(0x85e4)
 *      (all future deposits go directly to SW)
 *   2. Rescue 5100 USDT from 0x1Baa → Server Wallet
 *   3. Send deployer's 9001 USDT → Server Wallet
 *   4. Verify everything
 *
 * After this: Server Wallet holds ALL USDT, edge function bridges to ARB.
 *
 * Run: npx hardhat run scripts/fix-fund-flow.js --network bsc
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const OLD_VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const OLD_BB    = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";
  const SW        = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
  const USDT      = "0x55d398326f99059fF775485246999027B3197955";

  const vault = await ethers.getContractAt("CoinMaxVault", OLD_VAULT);
  const usdt  = await ethers.getContractAt("IERC20", USDT);
  const oldBb = new ethers.Contract(OLD_BB, [
    "function withdrawAll(address to) external",
    "function owner() view returns (address)",
  ], deployer);

  // ── Before ──
  const bbBal  = await usdt.balanceOf(OLD_BB);
  const depBal = await usdt.balanceOf(deployer.address);
  const swBal  = await usdt.balanceOf(SW);
  const fd     = await vault.fundDistributor();

  console.log("\n====== BEFORE ======");
  console.log("OLD Vault.fundDistributor:", fd);
  console.log("0x1Baa USDT:", ethers.formatEther(bbBal));
  console.log("Deployer USDT:", ethers.formatEther(depBal));
  console.log("Server Wallet USDT:", ethers.formatEther(swBal));
  const total = bbBal + depBal + swBal;
  console.log("Total scattered:", ethers.formatEther(total));

  // ── Step 1: Fix Vault fundDistributor → Server Wallet ──
  if (fd.toLowerCase() !== SW.toLowerCase()) {
    console.log("\n[1] Vault.setFundDistributor → Server Wallet (0x85e4)...");
    const tx1 = await vault.setFundDistributor(SW);
    await tx1.wait();
    console.log("✅ TX:", tx1.hash);
    console.log("   New FD:", await vault.fundDistributor());
  } else {
    console.log("\n[1] Already pointing to Server Wallet ✅");
  }

  // ── Step 2: Rescue USDT from 0x1Baa → Server Wallet ──
  if (bbBal > 0n) {
    console.log("\n[2] Rescuing", ethers.formatEther(bbBal), "USDT from 0x1Baa → Server Wallet...");
    const tx2 = await oldBb.withdrawAll(SW);
    await tx2.wait();
    console.log("✅ TX:", tx2.hash);
  } else {
    console.log("\n[2] 0x1Baa empty ✅");
  }

  // ── Step 3: Send deployer USDT → Server Wallet ──
  const depBalNow = await usdt.balanceOf(deployer.address);
  if (depBalNow > 0n) {
    console.log("\n[3] Sending", ethers.formatEther(depBalNow), "USDT from deployer → Server Wallet...");
    const tx3 = await usdt.transfer(SW, depBalNow);
    await tx3.wait();
    console.log("✅ TX:", tx3.hash);
  } else {
    console.log("\n[3] Deployer has no USDT ✅");
  }

  // ── Verify ──
  console.log("\n====== AFTER ======");
  console.log("OLD Vault.fundDistributor:", await vault.fundDistributor());
  console.log("0x1Baa USDT:", ethers.formatEther(await usdt.balanceOf(OLD_BB)));
  console.log("Deployer USDT:", ethers.formatEther(await usdt.balanceOf(deployer.address)));
  console.log("Server Wallet USDT:", ethers.formatEther(await usdt.balanceOf(SW)));
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  console.log("\n====== DONE ======");
  console.log("✅ Vault deposits now go: User → OLD Vault(0xE0A8) → Server Wallet(0x85e4)");
  console.log("✅ All scattered USDT consolidated in Server Wallet");
  console.log("✅ Edge function vault-bridge-flush will auto-bridge to ARB");
}

main().catch(console.error);
