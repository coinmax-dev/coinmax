const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  
  // Check all possible Gateway addresses
  const gateways = [
    "0xaC126bd86728D81dA05Df67f1E262085d072C36D",  // latest (redeploy-all)
    "0x62ac5FabC1a3bFd26B423F42FFb0934D4D3721eb",  // old
  ];
  
  for (const gw of gateways) {
    const has = await vault.hasRole(GW_ROLE, gw);
    console.log(`  Vault GATEWAY_ROLE → ${gw}: ${has ? "✅ YES" : "❌ NO"}`);
  }
  
  // Check what cUsd the gateway points to
  const gw = await ethers.getContractAt("CoinMaxGateway", "0xaC126bd86728D81dA05Df67f1E262085d072C36D");
  console.log("\n  Gateway (0xaC12):");
  console.log("    cUsd:", await gw.cUsd());
  console.log("    vault:", await gw.vault());
  console.log("    isVaultChain:", await gw.isVaultChain());
}

main().catch(console.error);
