/**
 * Step 1 (BSC):  Update Vault + swapAndBridge → ARB
 * Step 2 (ARB):  Wait for arrival + flushAll to 5 wallets
 *
 * Run:
 *   npx hardhat run scripts/bridge-continue.js --network bsc
 *   (wait 2-3 min for Stargate)
 *   npx hardhat run scripts/bridge-continue.js --network arbitrum
 */
const { ethers } = require("hardhat");

async function bsc() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const NEW_BB = "0x96dBfe3aAa877A4f9fB41d592f1D990368a4B2C1";
  const VAULT  = "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93";
  const USDT   = "0x55d398326f99059fF775485246999027B3197955";
  const USDC   = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  const bb    = await ethers.getContractAt("CoinMaxBatchBridgeV2", NEW_BB);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const usdt  = await ethers.getContractAt("IERC20", USDT);
  const usdc  = await ethers.getContractAt("IERC20", USDC);

  console.log("\nBB USDT:", ethers.formatEther(await usdt.balanceOf(NEW_BB)));
  console.log("BB BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BB)));
  console.log("Vault FD:", await vault.fundDistributor());

  // Update Vault fundDistributor
  const currentFd = await vault.fundDistributor();
  if (currentFd.toLowerCase() !== NEW_BB.toLowerCase()) {
    console.log("\n[1] Vault.setFundDistributor →", NEW_BB);
    await (await vault.setFundDistributor(NEW_BB)).wait();
    console.log("✅ Done:", await vault.fundDistributor());
  }

  // Ensure BNB
  const bbBnb = await ethers.provider.getBalance(NEW_BB);
  if (bbBnb < ethers.parseEther("0.02")) {
    console.log("\n[2] Sending BNB...");
    await (await deployer.sendTransaction({ to: NEW_BB, value: ethers.parseEther("0.02") - bbBnb })).wait();
    console.log("✅ BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BB)));
  }

  // bridgeInterval=0 for immediate
  await (await bb.setBridgeInterval(0)).wait();

  // swapAndBridge
  const balance = await usdt.balanceOf(NEW_BB);
  console.log("\n[3] 🚀 swapAndBridge:", ethers.formatEther(balance), "USDT → USDC → Stargate → ARB");

  const tx = await bb.swapAndBridge({ gasLimit: 1000000 });
  console.log("TX:", tx.hash);
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    console.log("✅ BRIDGE SUCCESS! Gas:", receipt.gasUsed.toString());
    for (const log of receipt.logs) {
      try {
        const parsed = bb.interface.parseLog(log);
        if (parsed?.name === "SwappedAndBridged") {
          console.log("  USDT in:", ethers.formatEther(parsed.args[0]));
          console.log("  USDC out:", ethers.formatEther(parsed.args[1]));
          console.log("  Stargate fee:", ethers.formatEther(parsed.args[2]), "BNB");
        }
      } catch {}
    }
  } else {
    console.log("❌ REVERTED");
  }

  // Restore interval
  try { await (await bb.setBridgeInterval(600)).wait(); } catch {}

  console.log("\n=== BSC Done ===");
  console.log("BB USDT:", ethers.formatEther(await usdt.balanceOf(NEW_BB)));
  console.log("BB USDC:", ethers.formatEther(await usdc.balanceOf(NEW_BB)));
  console.log("\n⏳ Now wait 2-3 min, then run: npx hardhat run scripts/bridge-continue.js --network arbitrum");
}

async function arb() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";
  const ARB_USDC    = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const ARB_USDC_E  = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
  const ARB_USDT    = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

  const router = await ethers.getContractAt("CoinMaxFundRouter", FUND_ROUTER);
  const usdc   = await ethers.getContractAt("IERC20", ARB_USDC);
  const usdce  = await ethers.getContractAt("IERC20", ARB_USDC_E);
  const usdt   = await ethers.getContractAt("IERC20", ARB_USDT);

  // Check all stablecoin balances on FundRouter
  const balUSDC  = await usdc.balanceOf(FUND_ROUTER);
  const balUSDCe = await usdce.balanceOf(FUND_ROUTER);
  const balUSDT  = await usdt.balanceOf(FUND_ROUTER);

  console.log("\n=== ARB FundRouter (0x7123) ===");
  console.log("USDC:", ethers.formatUnits(balUSDC, 6));
  console.log("USDC.e:", ethers.formatUnits(balUSDCe, 6));
  console.log("USDT:", ethers.formatUnits(balUSDT, 6));

  const totalBal = balUSDC + balUSDCe + balUSDT;
  if (totalBal == 0n) {
    console.log("\n⏳ No funds yet. Stargate still in transit? Try again in 1-2 min.");
    return;
  }

  // Read slot config
  const slotCount = await router.slotCount();
  console.log("\nSlots:", slotCount.toString());
  for (let i = 0; i < Number(slotCount); i++) {
    const [wallet, share] = await router.getSlot(i);
    console.log(`  ${i}: ${wallet} → ${Number(share)/100}%`);
  }

  // flushAll — distributes ALL USDC to 5 wallets by configured ratios
  console.log("\n[1] 🚀 flushAll() — distributing 100% to 5 wallets...");
  try {
    const tx = await router.flushAll();
    console.log("TX:", tx.hash);
    const receipt = await tx.wait();
    console.log(receipt.status === 1 ? "✅ FLUSH SUCCESS!" : "❌ REVERTED");
    console.log("Gas:", receipt.gasUsed.toString());
  } catch (e) {
    console.log("❌ flushAll failed:", e.message?.slice(0, 300));

    // Maybe deployer doesn't have OPERATOR_ROLE, check
    const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
    const hasOp = await router.hasRole(OPERATOR_ROLE, deployer.address);
    console.log("Deployer has OPERATOR_ROLE:", hasOp);

    if (!hasOp) {
      console.log("Granting OPERATOR_ROLE to deployer...");
      await (await router.grantRole(OPERATOR_ROLE, deployer.address)).wait();
      console.log("✅ Granted. Retrying flushAll...");
      const tx2 = await router.flushAll();
      await tx2.wait();
      console.log("✅ FLUSH SUCCESS on retry!");
    }
  }

  // Final: check wallet balances
  console.log("\n=== After Flush ===");
  console.log("FundRouter USDC:", ethers.formatUnits(await usdc.balanceOf(FUND_ROUTER), 6));
  console.log("\nWallet balances (USDC):");
  for (let i = 0; i < Number(slotCount); i++) {
    const [wallet, share] = await router.getSlot(i);
    const bal = await usdc.balanceOf(wallet);
    console.log(`  ${wallet} (${Number(share)/100}%) → $${ethers.formatUnits(bal, 6)}`);
  }
}

async function main() {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  if (chainId === 56n) {
    await bsc();
  } else if (chainId === 42161n) {
    await arb();
  } else {
    console.log("Run with --network bsc or --network arbitrum");
  }
}

main().catch(console.error);
