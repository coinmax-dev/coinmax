const { ethers } = require("hardhat");
async function main() {
  const vault = await ethers.getContractAt("CoinMaxVault", "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821");
  const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
  const ENGINE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const [d] = await ethers.getSigners();
  console.log("Deployer ADMIN:", await vault.hasRole(ADMIN, d.address));
  const tx = await vault.grantRole(ENGINE, SERVER);
  await tx.wait();
  console.log("ENGINE granted:", await vault.hasRole(ENGINE, SERVER));
}
main().catch(console.error);
