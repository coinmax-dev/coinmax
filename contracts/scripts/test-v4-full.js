const { ethers } = require("hardhat");

/**
 * V4 Full Flow Test
 * Test 1: USDC → Vault depositPublic
 * Test 2: USDT → PancakeSwap → USDC → Vault
 * Test 3: Verify cUSD minted, shares issued, USDC forwarded
 * Test 4: settleYield (Engine mints cUSD interest + MA)
 * Test 5: FlashSwap requestSwap (burn MA)
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const CUSD = "0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B";
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  const ORACLE = "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2";
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const RELEASE = "0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const USDT_ADDR = "0x55d398326f99059fF775485246999027B3197955";
  const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
  const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const usdt = await ethers.getContractAt("IERC20", USDT_ADDR);
  const cusd = await ethers.getContractAt("src/v4/CUSD.sol:CUSD", CUSD);
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);
  const oracle = await ethers.getContractAt("src/v4/MAPriceOracle.sol:MAPriceOracle", ORACLE);

  const fmt = (v) => ethers.formatEther(v);
  const fmt6 = (v) => (Number(v) / 1e6).toFixed(6);

  console.log("\n════════════════════════════════════════");
  console.log("  TEST 1: USDC → Vault depositPublic");
  console.log("════════════════════════════════════════");
  
  const depositAmount = ethers.parseEther("10"); // $10 USDC
  
  console.log("\n[Before]");
  console.log("  Deployer USDC:", fmt(await usdc.balanceOf(deployer.address)));
  console.log("  Vault cUSD:", fmt(await cusd.balanceOf(VAULT)));
  console.log("  Vault totalAssets:", fmt(await vault.totalAssets()));
  console.log("  Deployer shares:", fmt(await vault.balanceOf(deployer.address)));
  console.log("  Receiver USDC:", fmt(await usdc.balanceOf(RECEIVER)));

  // Approve
  console.log("\n  Approving USDC...");
  await (await usdc.approve(VAULT, depositAmount)).wait();
  
  // Deposit
  console.log("  Depositing $10 USDC (90_DAYS plan)...");
  const tx1 = await vault.depositPublic(depositAmount, "90_DAYS", { gasLimit: 500000 });
  const receipt1 = await tx1.wait();
  console.log("  ✅ TX:", tx1.hash);
  console.log("  Gas used:", receipt1.gasUsed.toString());

  console.log("\n[After]");
  console.log("  Deployer USDC:", fmt(await usdc.balanceOf(deployer.address)));
  console.log("  Vault cUSD:", fmt(await cusd.balanceOf(VAULT)));
  console.log("  Vault totalAssets:", fmt(await vault.totalAssets()));
  console.log("  Deployer shares:", fmt(await vault.balanceOf(deployer.address)));
  console.log("  Receiver USDC:", fmt(await usdc.balanceOf(RECEIVER)));
  console.log("  cUSD totalMinted:", fmt(await cusd.totalMinted()));
  
  // Check user stakes
  const stakes = await vault.getUserStakes(deployer.address);
  console.log("  User stakes:", stakes.length);
  if (stakes.length > 0) {
    const s = stakes[0];
    console.log("    [0] cusd:", fmt(s.cusdAmount), "shares:", fmt(s.shares), "plan:", s.planType);
  }

  console.log("\n════════════════════════════════════════");
  console.log("  TEST 2: USDT → PancakeSwap → USDC → Vault");
  console.log("════════════════════════════════════════");

  const usdtBal = await usdt.balanceOf(deployer.address);
  console.log("\n  Deployer USDT:", fmt(usdtBal));
  
  if (usdtBal >= ethers.parseEther("20")) {
    const swapAmount = ethers.parseEther("20");
    
    // Step 1: Swap USDT → USDC via PancakeSwap
    console.log("  Approving USDT to PancakeSwap...");
    await (await usdt.approve(PANCAKE_ROUTER, swapAmount)).wait();
    
    const router = new ethers.Contract(PANCAKE_ROUTER, [
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
    ], deployer);
    
    console.log("  Swapping $20 USDT → USDC...");
    const swapTx = await router.exactInputSingle({
      tokenIn: USDT_ADDR,
      tokenOut: USDC,
      fee: 100, // 0.01%
      recipient: deployer.address,
      amountIn: swapAmount,
      amountOutMinimum: ethers.parseEther("19.9"), // 0.5% slippage
      sqrtPriceLimitX96: 0,
    }, { gasLimit: 300000 });
    await swapTx.wait();
    console.log("  ✅ Swap TX:", swapTx.hash);
    console.log("  Deployer USDC after swap:", fmt(await usdc.balanceOf(deployer.address)));

    // Step 2: Deposit swapped USDC to Vault
    const deposit2 = ethers.parseEther("19"); // slightly less due to swap fee
    const usdcNow = await usdc.balanceOf(deployer.address);
    const actualDeposit = usdcNow < deposit2 ? usdcNow : deposit2;
    
    console.log("  Approving USDC to Vault...");
    await (await usdc.approve(VAULT, actualDeposit)).wait();
    console.log("  Depositing", fmt(actualDeposit), "USDC (45_DAYS)...");
    await (await vault.depositPublic(actualDeposit, "45_DAYS", { gasLimit: 500000 })).wait();
    console.log("  ✅ Deposit done");
    console.log("  Deployer shares:", fmt(await vault.balanceOf(deployer.address)));
    console.log("  Vault totalAssets:", fmt(await vault.totalAssets()));
    console.log("  Receiver USDC:", fmt(await usdc.balanceOf(RECEIVER)));
  } else {
    console.log("  ⏭️ Skip - not enough USDT");
  }

  console.log("\n════════════════════════════════════════");
  console.log("  TEST 3: settleYield (simulate Engine)");
  console.log("════════════════════════════════════════");

  // Deployer has ENGINE_ROLE? No, ENGINE wallet does. But we can grant it temporarily
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const hasRole = await vault.hasRole(ENGINE_ROLE, deployer.address);
  if (!hasRole) {
    console.log("  Granting ENGINE_ROLE to Deployer (temp)...");
    await (await vault.grantRole(ENGINE_ROLE, deployer.address)).wait();
  }

  const maPrice = await oracle.getPrice();
  console.log("  MA Price: $" + fmt6(maPrice));

  // Settle: mint 0.9 cUSD interest + corresponding MA for deployer
  const yieldCusd = ethers.parseEther("0.9"); // simulate 1 day yield on $10 @ 0.9%
  const yieldMa = yieldCusd * BigInt(1e6) / maPrice; // MA amount at oracle price
  
  console.log("  Settling: " + fmt(yieldCusd) + " cUSD → " + fmt(yieldMa) + " MA");
  
  const tx3 = await vault.settleYield(
    [deployer.address],
    [yieldCusd],
    [yieldMa],
    { gasLimit: 500000 }
  );
  await tx3.wait();
  console.log("  ✅ settleYield TX:", tx3.hash);
  console.log("  Vault totalAssets:", fmt(await vault.totalAssets()));
  console.log("  cUSD totalMinted:", fmt(await cusd.totalMinted()));
  console.log("  MA totalMinted:", fmt(await ma.totalMinted()));
  console.log("  Release MA balance:", fmt(await ma.balanceOf(RELEASE)));

  console.log("\n════════════════════════════════════════");
  console.log("  TEST 4: Release → addReleased (simulate)");
  console.log("════════════════════════════════════════");

  const release = await ethers.getContractAt("ReleaseV4", RELEASE);
  const hasReleaseRole = await release.hasRole(ENGINE_ROLE, deployer.address);
  if (!hasReleaseRole) {
    console.log("  Granting ENGINE_ROLE on Release...");
    await (await release.grantRole(ENGINE_ROLE, deployer.address)).wait();
  }

  console.log("  Adding released MA for Deployer...");
  await (await release.addReleased(deployer.address, yieldMa, "vault_yield")).wait();
  
  const [released, locked, destroyed, claimed] = await release.getBalance(deployer.address);
  console.log("  ✅ Released:", fmt(released), "| Locked:", fmt(locked), "| Claimed:", fmt(claimed));

  // Claim
  console.log("  Claiming released MA...");
  const tx4 = await release.claim({ gasLimit: 200000 });
  await tx4.wait();
  console.log("  ✅ Claimed!");
  console.log("  Deployer MA balance:", fmt(await ma.balanceOf(deployer.address)));

  console.log("\n════════════════════════════════════════");
  console.log("  TEST 5: FlashSwap requestSwap (burn MA → get request)");
  console.log("════════════════════════════════════════");

  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);
  const maBalance = await ma.balanceOf(deployer.address);
  console.log("  Deployer MA:", fmt(maBalance));

  if (maBalance > 0n) {
    // Approve MA to FlashSwap
    console.log("  Approving MA to FlashSwap...");
    await (await ma.approve(FLASH, maBalance)).wait();

    // Quote
    const [qOut, qFee, qPrice] = await flash.quoteSwap(maBalance);
    console.log("  Quote:", fmt(maBalance), "MA → $" + fmt(qOut), "USDT");

    // Request swap
    console.log("  requestSwap...");
    const tx5 = await flash.requestSwap(maBalance, { gasLimit: 300000 });
    const receipt5 = await tx5.wait();
    console.log("  ✅ TX:", tx5.hash);
    console.log("  MA burned! Deployer MA:", fmt(await ma.balanceOf(deployer.address)));
    console.log("  MA totalBurned:", fmt(await ma.totalBurned()));
    console.log("  FlashSwap pendingCount:", (await flash.pendingCount()).toString());
    
    // Check the request
    const req = await flash.getRequest(0);
    console.log("  Request #0: user:", req.user, "usdtOut:", fmt(req.usdtOut), "fulfilled:", req.fulfilled);
  } else {
    console.log("  ⏭️ Skip - no MA to swap");
  }

  // Cleanup: revoke temp roles
  console.log("\n  Cleaning up temp roles...");
  await (await vault.revokeRole(ENGINE_ROLE, deployer.address)).wait();
  await (await release.revokeRole(ENGINE_ROLE, deployer.address)).wait();

  console.log("\n════════════════════════════════════════");
  console.log("  ALL TESTS COMPLETE");
  console.log("════════════════════════════════════════");
  console.log("  Vault totalAssets:", fmt(await vault.totalAssets()), "cUSD");
  console.log("  cUSD minted:", fmt(await cusd.totalMinted()));
  console.log("  MA minted:", fmt(await ma.totalMinted()));
  console.log("  MA burned:", fmt(await ma.totalBurned()));
  console.log("  MA circulating:", fmt(await ma.circulatingSupply()));
  console.log("  Oracle price:", "$" + fmt6(await oracle.getPrice()));
  console.log("  FlashSwap pending:", (await flash.pendingCount()).toString());
  console.log("  Deployer USDC:", fmt(await usdc.balanceOf(deployer.address)));
  console.log("  Receiver USDC:", fmt(await usdc.balanceOf(RECEIVER)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
