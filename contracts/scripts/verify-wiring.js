const { ethers } = require("hardhat");

async function main() {
  const nodes = await ethers.getContractAt("CoinMaxNodesV2", "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2");
  const gw = await ethers.getContractAt("CoinMaxGateway", "0xaC126bd86728D81dA05Df67f1E262085d072C36D");
  const vault = await ethers.getContractAt("CoinMaxVault", "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821");

  console.log("NodesV2.fundDistributor:", await nodes.fundDistributor());
  
  try { console.log("Gateway.cUsd:", await gw.cUsd()); } catch { console.log("Gateway.cUsd: read failed"); }
  try { console.log("Gateway.vault:", await gw.vault()); } catch { console.log("Gateway.vault: read failed"); }
  
  console.log("Vault.maToken:", await vault.maToken());
  
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  console.log("Vault GATEWAY→Gateway:", await vault.hasRole(GW_ROLE, "0xaC126bd86728D81dA05Df67f1E262085d072C36D"));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
