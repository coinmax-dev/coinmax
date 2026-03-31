const { ethers } = require("hardhat");
async function main() {
  const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
  const RELEASE = "0x842b48a616fA107bcd18e3656edCe658D4279f92";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";

  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const ENGINE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));

  const ma = await ethers.getContractAt("AccessControl", MA);
  const release = await ethers.getContractAt("AccessControl", RELEASE);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);

  // MA Token: grant MINTER to Server Wallet
  if (!(await ma.hasRole(MINTER, SERVER))) {
    console.log("Granting MA MINTER to Server...");
    await (await ma.grantRole(MINTER, SERVER)).wait();
    console.log("✅");
  } else console.log("MA MINTER: already ✅");

  // Release: grant ADMIN to Server (needed for addAccumulated)
  if (!(await release.hasRole(ADMIN, SERVER))) {
    console.log("Granting Release ADMIN to Server...");
    await (await release.grantRole(ADMIN, SERVER)).wait();
    console.log("✅");
  } else console.log("Release ADMIN: already ✅");

  // Vault: grant ENGINE_ROLE to Server (if needed for interest processing)
  if (!(await vault.hasRole(ENGINE, SERVER))) {
    console.log("Granting Vault ENGINE to Server...");
    await (await vault.grantRole(ENGINE, SERVER)).wait();
    console.log("✅");
  } else console.log("Vault ENGINE: already ✅");

  // Verify
  console.log("\n=== Verify ===");
  console.log("Server→MA MINTER:", await ma.hasRole(MINTER, SERVER));
  console.log("Server→Release ADMIN:", await release.hasRole(ADMIN, SERVER));
  console.log("Server→Vault ENGINE:", await vault.hasRole(ENGINE, SERVER));
}
main().catch(console.error);
