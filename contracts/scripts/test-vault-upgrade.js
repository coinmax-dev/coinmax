const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  
  // Check if upgradeToAndCall exists
  try {
    const iface = vault.interface;
    const fn = iface.getFunction("upgradeToAndCall");
    console.log("upgradeToAndCall exists:", !!fn);
  } catch {
    console.log("upgradeToAndCall: NOT FOUND");
  }
}

main().catch(console.error);
