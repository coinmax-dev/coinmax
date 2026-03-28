const { ethers } = require("hardhat");

async function main() {
  const NEW_GW = "0x2F6EBe9b9EF8B979e9aECDcD4D5aCb876A4DBB2a";
  const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  
  const cusd = await ethers.getContractAt("CUSD", CUSD);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  
  console.log("CUSD MINTER → new Gateway:", await cusd.hasRole(MINTER, NEW_GW));
  console.log("Vault GATEWAY → new Gateway:", await vault.hasRole(GW_ROLE, NEW_GW));
  
  // Also try to simulate cUsd.mintTo from Gateway
  try {
    await cusd.mintTo.staticCall(NEW_GW, ethers.parseEther("50"), { from: NEW_GW });
    console.log("cUSD.mintTo simulation: ✅");
  } catch (e) {
    console.log("cUSD.mintTo simulation: ❌", e.message.slice(0, 100));
  }
}

main().catch(console.error);
