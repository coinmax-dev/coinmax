/**
 * Deploy BatchBridgeV2 with keeper support
 * - Rescue USDT from old bridge (0x96dB)
 * - Update Vault.fundDistributor
 * - Set Server Wallet (0x85e4) as keeper for automated bridging
 * - Send BNB for Stargate fees
 *
 * Run: npx hardhat run scripts/deploy-bridge-v3.js --network bsc
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const USDT            = "0x55d398326f99059fF775485246999027B3197955";
  const USDC            = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const PANCAKE_V3      = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
  const STARGATE_USDC   = "0x962Bd449E630b0d928f308Ce63f1A21F02576057";
  const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
  const ARB_DST_EID     = 30110;
  const POOL_FEE        = 100;
  const VAULT           = "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93";
  const OLD_BB          = "0x96dBfe3aAa877A4f9fB41d592f1D990368a4B2C1";
  const SERVER_WALLET   = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";

  const usdt = await ethers.getContractAt("IERC20", USDT);

  // 1. Deploy
  console.log("\n[1] Deploying CoinMaxBatchBridgeV2 (with keeper)...");
  const Factory = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
  const bb = await Factory.deploy(USDT, USDC, PANCAKE_V3, STARGATE_USDC, ARB_FUND_ROUTER, ARB_DST_EID, POOL_FEE);
  await bb.waitForDeployment();
  const NEW_BB = await bb.getAddress();
  console.log("✅ Deployed:", NEW_BB);

  // 2. Set Server Wallet as keeper
  console.log("\n[2] Setting keeper:", SERVER_WALLET);
  await (await bb.setKeeper(SERVER_WALLET, true)).wait();
  console.log("✅ keeper set");

  // 3. Set bridgeInterval to 0 (edge function manages timing)
  await (await bb.setBridgeInterval(0)).wait();
  console.log("✅ bridgeInterval=0");

  // 4. Rescue USDT from old bridge
  const oldBal = await usdt.balanceOf(OLD_BB);
  console.log("\n[3] Old bridge (0x96dB) USDT:", ethers.formatEther(oldBal));
  if (oldBal > 0n) {
    const oldBb = await ethers.getContractAt("CoinMaxBatchBridgeV2", OLD_BB);
    await (await oldBb.withdrawAll(NEW_BB)).wait();
    console.log("✅ Rescued to new bridge");
  }

  // 5. Update Vault fundDistributor
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  console.log("\n[4] Vault.fundDistributor:", await vault.fundDistributor());
  await (await vault.setFundDistributor(NEW_BB)).wait();
  console.log("✅ Updated:", await vault.fundDistributor());

  // 6. Send BNB
  const bbBnb = await ethers.provider.getBalance(NEW_BB);
  if (bbBnb < ethers.parseEther("0.02")) {
    console.log("\n[5] Sending 0.02 BNB...");
    await (await deployer.sendTransaction({ to: NEW_BB, value: ethers.parseEther("0.02") })).wait();
  }

  // Summary
  console.log("\n=== DONE ===");
  console.log("New BatchBridgeV2:", NEW_BB);
  console.log("  USDT:", ethers.formatEther(await usdt.balanceOf(NEW_BB)));
  console.log("  BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BB)));
  console.log("  keeper:", SERVER_WALLET);
  console.log("  owner:", await bb.owner());
  console.log("Vault.fundDistributor:", await vault.fundDistributor());
  console.log("\n⚠️  Update BATCH_BRIDGE address in edge function to:", NEW_BB);
}

main().catch(console.error);
