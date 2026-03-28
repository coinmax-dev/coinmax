const { ethers } = require("hardhat");

const GATEWAY = "0xaC126bd86728D81dA05Df67f1E262085d072C36D";
const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
const NODES_V2 = "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";
const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address, "\n");
  let tx;

  // 1. NodesV2.fundDistributor → NodePool
  console.log("1. NodesV2.fundDistributor → NodePool");
  const nodes = await ethers.getContractAt("CoinMaxNodesV2", NODES_V2);
  tx = await nodes.setFundDistributor(NODE_POOL);
  await tx.wait();
  console.log("   ✓");

  // 2. Gateway.setCUsd → CUSD
  console.log("2. Gateway.setCUsd → CUSD");
  const gw = await ethers.getContractAt("CoinMaxGateway", GATEWAY);
  tx = await gw.setCUsd(CUSD);
  await tx.wait();
  console.log("   ✓");

  // 3. Vault.setMAToken → MA
  console.log("3. Vault.setMAToken → MA");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  tx = await vault.setMAToken(MA);
  await tx.wait();
  console.log("   ✓");

  // 4. Vault grant GATEWAY_ROLE → Gateway
  console.log("4. Vault GATEWAY_ROLE → Gateway");
  const GATEWAY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  tx = await vault.grantRole(GATEWAY_ROLE, GATEWAY);
  await tx.wait();
  console.log("   ✓");

  console.log("\nAll fixed!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
