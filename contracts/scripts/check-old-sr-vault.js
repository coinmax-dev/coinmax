const { ethers } = require("hardhat");

async function main() {
  const OLD_SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";

  const iface = new ethers.Interface([
    "function vaultV2() view returns (address)",
    "function nodesV2() view returns (address)",
    "function owner() view returns (address)",
  ]);

  const read = async (fn) => {
    const data = iface.encodeFunctionData(fn);
    const result = await ethers.provider.call({ to: OLD_SR, data });
    return iface.decodeFunctionResult(fn, result)[0];
  };

  console.log("Old SwapRouter (0x5650):");
  console.log("  vaultV2:", await read("vaultV2"));
  console.log("  nodesV2:", await read("nodesV2"));
  console.log("  owner:", await read("owner"));
  
  console.log("\nCurrent Vault:", "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821");
  
  const v2addr = await read("vaultV2");
  console.log("\nSwapRouter.vaultV2 matches current Vault?", 
    v2addr.toLowerCase() === "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821".toLowerCase() ? "✅" : "❌ MISMATCH");
}

main().catch(console.error);
