const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
  const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
  
  const ma = await ethers.getContractAt("MAToken", MA);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  
  // Can Vault call MA.mintTo?
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  console.log("MA MINTER → Vault:", await ma.hasRole(MINTER, VAULT));
  
  // Check Vault._getMAPrice
  try {
    const price = await vault.getCurrentMAPrice();
    console.log("Vault.getCurrentMAPrice:", price.toString(), `($${Number(price)/1e6})`);
  } catch (e) {
    console.log("Vault.getCurrentMAPrice FAILED:", e.message.slice(0, 100));
    console.log("THIS IS THE BUG — Vault can't get price!");
  }
  
  // Check Oracle directly
  const oracleAddr = await vault.priceOracle();
  console.log("\nOracle:", oracleAddr);
  
  const oracle = await ethers.getContractAt("MAPriceOracle", oracleAddr);
  try {
    const p = await oracle.getPrice();
    console.log("oracle.getPrice():", p.toString());
  } catch (e) {
    console.log("oracle.getPrice() FAILED:", e.message.slice(0, 100));
    console.log("❌ PRICE IS STALE — heartbeat expired!");
    
    const lastUpdate = await oracle.lastUpdateTime();
    const heartbeat = await oracle.heartbeat();
    const now = Math.floor(Date.now() / 1000);
    console.log("  Last update:", new Date(Number(lastUpdate) * 1000).toISOString());
    console.log("  Heartbeat:", Number(heartbeat)/3600, "hours");
    console.log("  Time since:", Math.floor((now - Number(lastUpdate))/3600), "hours ago");
  }
  
  // Check fallback maPrice
  const fallback = await vault.maPrice();
  console.log("\nVault.maPrice (fallback):", fallback.toString(), `($${Number(fallback)/1e6})`);
  if (fallback === 0n) {
    console.log("❌ FALLBACK PRICE IS ZERO — deposit will revert!");
  }
}

main().catch(console.error);
