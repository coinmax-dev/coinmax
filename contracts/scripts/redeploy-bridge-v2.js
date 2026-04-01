/**
 * Redeploy BatchBridgeV2 with correct PancakeSwap V3 + Stargate USDC config
 *
 * Problem: Old deploy used PancakeSwap V2 Router (no exactInputSingle)
 * Fix: Deploy fresh with V3 SmartRouter + Stargate USDC pool
 *
 * Run: npx hardhat run scripts/redeploy-bridge-v2.js --network bsc
 */
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // ── Addresses ──────────────────────────────────────────
  const USDT             = "0x55d398326f99059fF775485246999027B3197955";
  const USDC             = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const PANCAKE_V3       = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4"; // PancakeSwap V3 SmartRouter
  const STARGATE_USDC    = "0x962Bd449E630b0d928f308Ce63f1A21F02576057"; // Stargate V2 USDC pool (BSC)
  const ARB_FUND_ROUTER  = "0x71237E535d5E00CDf18A609eA003525baEae3489";
  const ARB_DST_EID      = 30110;  // LayerZero Arbitrum endpoint
  const POOL_FEE         = 100;    // PancakeSwap V3 USDT/USDC 0.01% pool
  const VAULT            = "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93";
  const OLD_BB           = "0x1Baa40837a253DA171a458A979f87b9A29CE0Efa";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);

  // ── 1. Deploy new BatchBridgeV2 ─────────────────────────
  console.log("\n[1] Deploying CoinMaxBatchBridgeV2...");
  console.log("    PancakeSwap V3:", PANCAKE_V3);
  console.log("    Stargate USDC:", STARGATE_USDC);
  console.log("    ARB receiver:", ARB_FUND_ROUTER);
  console.log("    dstEid:", ARB_DST_EID);
  console.log("    poolFee:", POOL_FEE);

  const Factory = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
  const bb = await Factory.deploy(
    USDT, USDC, PANCAKE_V3, STARGATE_USDC, ARB_FUND_ROUTER, ARB_DST_EID, POOL_FEE
  );
  await bb.waitForDeployment();
  const NEW_BB = await bb.getAddress();
  console.log("✅ Deployed:", NEW_BB);

  // ── 2. Verify config ───────────────────────────────────
  console.log("\n[2] Verifying new contract config...");
  console.log("    owner:", await bb.owner());
  console.log("    usdt:", await bb.usdt());
  console.log("    usdc:", await bb.usdc());
  console.log("    pancakeRouter:", await bb.pancakeRouter());
  console.log("    stargateRouter:", await bb.stargateRouter());
  console.log("    arbReceiver:", await bb.arbReceiver());
  console.log("    dstEid:", (await bb.dstEid()).toString());
  console.log("    poolFee:", (await bb.poolFee()).toString());
  console.log("    minBridgeAmount:", ethers.formatEther(await bb.minBridgeAmount()));

  // ── 3. Rescue USDT from old BatchBridge ─────────────────
  const oldBb = new ethers.Contract(OLD_BB, [
    "function withdrawAll(address to)",
    "function emergencyWithdraw(address token, address to, uint256 amount)",
    "function emergencyWithdrawNative(address payable to)",
    "function owner() view returns (address)",
  ], deployer);

  const oldUsdt = await usdt.balanceOf(OLD_BB);
  const oldUsdc = await usdc.balanceOf(OLD_BB);
  const oldBnb  = await ethers.provider.getBalance(OLD_BB);

  console.log("\n[3] Rescuing from old bridge (0x1Baa)...");
  console.log("    USDT:", ethers.formatEther(oldUsdt));
  console.log("    USDC:", ethers.formatEther(oldUsdc));
  console.log("    BNB:", ethers.formatEther(oldBnb));

  if (oldUsdt > 0n) {
    // withdrawAll sends USDT only
    await (await oldBb.withdrawAll(NEW_BB)).wait();
    console.log("    ✅ USDT rescued to new bridge");
  }
  if (oldUsdc > 0n) {
    await (await oldBb.emergencyWithdraw(USDC, NEW_BB, oldUsdc)).wait();
    console.log("    ✅ USDC rescued to new bridge");
  }
  if (oldBnb > 0n) {
    await (await oldBb.emergencyWithdrawNative(NEW_BB)).wait();
    console.log("    ✅ BNB rescued to new bridge");
  }

  // ── 4. Update Vault.fundDistributor ─────────────────────
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  console.log("\n[4] Vault.fundDistributor:", await vault.fundDistributor());
  console.log("    Updating to:", NEW_BB);
  await (await vault.setFundDistributor(NEW_BB)).wait();
  console.log("    ✅ Updated:", await vault.fundDistributor());

  // ── 5. Ensure BNB for Stargate fees ─────────────────────
  const newBnb = await ethers.provider.getBalance(NEW_BB);
  console.log("\n[5] Bridge BNB:", ethers.formatEther(newBnb));
  if (newBnb < ethers.parseEther("0.03")) {
    const topup = ethers.parseEther("0.05") - newBnb;
    console.log("    Sending", ethers.formatEther(topup), "BNB...");
    await (await deployer.sendTransaction({ to: NEW_BB, value: topup })).wait();
    console.log("    ✅ BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BB)));
  }

  // ── 6. Final status ─────────────────────────────────────
  console.log("\n=== NEW BatchBridgeV2 ===");
  console.log("Address:", NEW_BB);
  console.log("USDT:", ethers.formatEther(await usdt.balanceOf(NEW_BB)));
  console.log("USDC:", ethers.formatEther(await usdc.balanceOf(NEW_BB)));
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW_BB)));
  console.log("Vault.fundDistributor:", await vault.fundDistributor());

  // ── 7. Try swapAndBridge ────────────────────────────────
  const bridgeBalance = await usdt.balanceOf(NEW_BB);
  if (bridgeBalance >= ethers.parseEther("50")) {
    console.log("\n[7] 🚀 Executing swapAndBridge()...");
    console.log("    " + ethers.formatEther(bridgeBalance) + " USDT → USDC → Stargate → ARB");
    try {
      // Set bridgeInterval to 0 so we can bridge immediately
      await (await bb.setBridgeInterval(0)).wait();

      const tx = await bb.swapAndBridge({ gasLimit: 1000000 });
      console.log("    TX:", tx.hash);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log("    ✅ BRIDGE SUCCESS!");
        console.log("    Gas:", receipt.gasUsed.toString());
        for (const log of receipt.logs) {
          try {
            const parsed = bb.interface.parseLog(log);
            if (parsed?.name === "SwappedAndBridged") {
              console.log("    USDT in:", ethers.formatEther(parsed.args[0]));
              console.log("    USDC out:", ethers.formatEther(parsed.args[1]));
              console.log("    Stargate fee:", ethers.formatEther(parsed.args[2]), "BNB");
            }
          } catch {}
        }
        console.log("\n    ⏳ USDC arriving on ARB FundRouter in ~1-3 min");
      } else {
        console.log("    ❌ REVERTED");
      }
    } catch (e) {
      console.log("    ❌ swapAndBridge error:", e.message?.slice(0, 400));
      console.log("\n    Funds safe in new bridge. Debug Stargate/PancakeSwap config.");
    }
  }

  // Restore bridge interval
  try { await (await bb.setBridgeInterval(600)).wait(); } catch {}

  console.log("\n=== DONE ===");
  console.log("Old bridge (0x1Baa): RETIRED");
  console.log("New bridge:", NEW_BB);
  console.log("Update batch-bridge edge function with new address!");
}

main().catch(console.error);
