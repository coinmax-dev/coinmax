const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const OLD_SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const NEW_VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  
  // SwapRouter uses setVaultV2
  const iface = new ethers.Interface([
    "function setVaultV2(address _vaultV2)",
    "function vaultV2() view returns (address)",
  ]);
  
  // Set new vault
  const data = iface.encodeFunctionData("setVaultV2", [NEW_VAULT]);
  const tx = await deployer.sendTransaction({ to: OLD_SR, data });
  await tx.wait();
  
  // Verify
  const readData = iface.encodeFunctionData("vaultV2");
  const result = await ethers.provider.call({ to: OLD_SR, data: readData });
  const vault = iface.decodeFunctionResult("vaultV2", result)[0];
  console.log("SwapRouter.vaultV2:", vault);
  console.log("Match:", vault.toLowerCase() === NEW_VAULT.toLowerCase() ? "✅" : "❌");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
