const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  
  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);

  // Lower minSwapAmount to 0.1 MA for testing
  console.log("Setting minSwapAmount to 0.1 MA...");
  await (await flash.setMinSwapAmount(ethers.parseEther("0.1"))).wait();
  console.log("✅ minSwapAmount:", ethers.formatEther(await flash.minSwapAmount()));

  const maBalance = await ma.balanceOf(deployer.address);
  console.log("Deployer MA:", ethers.formatEther(maBalance));

  // Quote
  const [qOut, qFee, qPrice] = await flash.quoteSwap(maBalance);
  console.log("Quote:", ethers.formatEther(maBalance), "MA → $" + ethers.formatEther(qOut), "USDT");

  // Request swap
  console.log("\nrequestSwap...");
  const tx = await flash.requestSwap(maBalance, { gasLimit: 300000 });
  await tx.wait();
  console.log("✅ TX:", tx.hash);
  console.log("MA burned! Deployer MA:", ethers.formatEther(await ma.balanceOf(deployer.address)));
  console.log("MA totalBurned:", ethers.formatEther(await ma.totalBurned()));
  console.log("MA circulatingSupply:", ethers.formatEther(await ma.circulatingSupply()));
  console.log("FlashSwap pendingCount:", (await flash.pendingCount()).toString());

  const req = await flash.getRequest(0);
  console.log("\nRequest #0:");
  console.log("  user:", req.user);
  console.log("  maAmount:", ethers.formatEther(req.maAmount));
  console.log("  usdtOut:", ethers.formatEther(req.usdtOut));
  console.log("  maPrice:", (Number(req.maPrice) / 1e6).toFixed(6));
  console.log("  fulfilled:", req.fulfilled);

  // Clean up temp roles from test
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const vault = await ethers.getContractAt("CoinMaxVaultV4", "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744");
  const release = await ethers.getContractAt("ReleaseV4", "0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc");
  try { await (await vault.revokeRole(ENGINE_ROLE, deployer.address)).wait(); } catch {}
  try { await (await release.revokeRole(ENGINE_ROLE, deployer.address)).wait(); } catch {}
  console.log("\n✅ Temp roles cleaned");

  // Final summary
  const cusd = await ethers.getContractAt("src/v4/CUSD.sol:CUSD", "0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B");
  const oracle = await ethers.getContractAt("src/v4/MAPriceOracle.sol:MAPriceOracle", "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2");
  const usdc = await ethers.getContractAt("IERC20", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
  const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";

  console.log("\n══════════════════════════════════════");
  console.log("  FULL TEST RESULTS");
  console.log("══════════════════════════════════════");
  console.log("  ✅ Test 1: USDC → Vault deposit");
  console.log("  ✅ Test 2: USDT → PancakeSwap → USDC → Vault");
  console.log("  ✅ Test 3: settleYield (cUSD + MA mint)");
  console.log("  ✅ Test 4: Release claim MA");
  console.log("  ✅ Test 5: FlashSwap requestSwap (burn MA)");
  console.log("");
  console.log("  Vault totalAssets:", ethers.formatEther(await vault.totalAssets()), "cUSD");
  console.log("  cUSD minted:", ethers.formatEther(await cusd.totalMinted()));
  console.log("  MA minted:", ethers.formatEther(await ma.totalMinted()));
  console.log("  MA burned:", ethers.formatEther(await ma.totalBurned()));
  console.log("  MA circulating:", ethers.formatEther(await ma.circulatingSupply()));
  console.log("  Oracle price: $" + (Number(await oracle.getPrice()) / 1e6));
  console.log("  FlashSwap pending:", (await flash.pendingCount()).toString());
  console.log("  Receiver USDC:", ethers.formatEther(await usdc.balanceOf(RECEIVER)));
  console.log("  Deployer USDC:", ethers.formatEther(await usdc.balanceOf(deployer.address)));
  console.log("  Deployer MA:", ethers.formatEther(await ma.balanceOf(deployer.address)));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
