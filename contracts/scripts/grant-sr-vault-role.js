const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const OLD_SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  
  // Check
  const has = await vault.hasRole(GW_ROLE, OLD_SR);
  console.log("Vault GATEWAY_ROLE → SwapRouter:", has);
  
  if (!has) {
    console.log("Granting...");
    const tx = await vault.grantRole(GW_ROLE, OLD_SR);
    await tx.wait();
    console.log("Granted ✅");
  }
  
  // Also check: SwapRouter calls vault.depositFrom which expects the old interface
  // Old VaultV2 had: depositFrom(address depositor, uint256 usdcAmount, uint256 originalUsdtAmount, uint256 planIndex)
  // New Vault has: depositFor(address user, uint256 cUsdAmount, uint256 planIndex)
  // THESE ARE DIFFERENT!
  
  console.log("\n⚠️  WARNING: SwapRouter calls vaultV2.depositFrom(depositor, usdcAmount, originalUsdtAmount, planIndex)");
  console.log("   But new Vault has depositFor(user, cUsdAmount, planIndex) — 3 params not 4!");
  console.log("   SwapRouter will FAIL calling the new Vault!");
}

main().catch(console.error);
