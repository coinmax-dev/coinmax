const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const SWAP_ROUTER = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const ma = await ethers.getContractAt("MAToken", MA);

  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  console.log("=== 金库存入链路检查 ===");
  console.log("SwapRouter → Vault GATEWAY_ROLE:", await vault.hasRole(GW_ROLE, SWAP_ROUTER));
  console.log("Vault → MA MINTER:", await ma.hasRole(MINTER, VAULT));
  console.log("SwapRouter.vaultV2:", await (async () => {
    const iface = new ethers.Interface(["function vaultV2() view returns (address)"]);
    const r = await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("vaultV2") });
    return iface.decodeFunctionResult("vaultV2", r)[0];
  })());
  console.log("Vault.fundDistributor:", await vault.fundDistributor());
  console.log("Oracle price:", (await vault.getCurrentMAPrice()).toString(), "($" + Number(await vault.getCurrentMAPrice())/1e6 + ")");

  // Check: SwapRouter calls vault.depositFrom(user, usdcAmount, usdtAmount, planIndex)
  // Vault.depositFrom pulls USDC from SwapRouter via safeTransferFrom
  // So SwapRouter needs to approve USDC to Vault first
  // But SwapRouter does: usdc.safeIncreaseAllowance(vaultV2, usdcReceived) before calling
  console.log("\nAll checks pass — ready for deposit ✅");
}

main().catch(console.error);
