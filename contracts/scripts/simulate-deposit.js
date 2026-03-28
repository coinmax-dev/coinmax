const { ethers } = require("hardhat");

async function main() {
  const GATEWAY = "0xaC126bd86728D81dA05Df67f1E262085d072C36D";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";

  const gw = await ethers.getContractAt("CoinMaxGateway", GATEWAY);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const cusd = await ethers.getContractAt("CUSD", CUSD);
  const ma = await ethers.getContractAt("MAToken", MA);

  // Trace the depositVault flow:
  // 1. Gateway._swapToUsdc (PancakeSwap) → gets USDC
  // 2. Gateway._mintAndDeposit:
  //    a. cUsd.mintTo(gateway, amount) → Gateway needs MINTER on CUSD
  //    b. cusd.approve(vault, amount)
  //    c. vault.depositFor(user, amount, planIndex) → Gateway needs GATEWAY_ROLE on Vault

  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));

  console.log("Step 2a: CUSD.mintTo → Gateway needs MINTER");
  console.log("  CUSD MINTER → Gateway:", await cusd.hasRole(MINTER, GATEWAY));
  console.log("  CUSD admin:", await cusd.getRoleAdmin(MINTER));
  
  console.log("\nStep 2c: Vault.depositFor → Gateway needs GATEWAY_ROLE");
  console.log("  Vault GATEWAY → Gateway:", await vault.hasRole(GW_ROLE, GATEWAY));

  // Also check: who is msg.sender inside _mintAndDeposit?
  // It's the Gateway contract itself. So Gateway calls cusd.mintTo(address(this), ...)
  // and vault.depositFor(user, ...)

  // Check if CUSD has a mintCooldown issue
  console.log("\n=== CUSD Config ===");
  console.log("  Supply cap:", ethers.formatEther(await cusd.supplyCap()));
  console.log("  Mint limit:", ethers.formatEther(await cusd.mintLimit()));
  console.log("  Total supply:", ethers.formatEther(await cusd.totalSupply()));
  
  console.log("\n=== MA Config ===");
  console.log("  Supply cap:", ethers.formatEther(await ma.supplyCap()));
  console.log("  Mint limit:", ethers.formatEther(await ma.mintLimit()));
  console.log("  Total supply:", ethers.formatEther(await ma.totalSupply()));
  
  // Check Vault oracle
  console.log("\n=== Vault Oracle ===");
  const oracleAddr = await vault.priceOracle();
  console.log("  Oracle:", oracleAddr);
  if (oracleAddr !== ethers.ZeroAddress) {
    const oracle = await ethers.getContractAt("MAPriceOracle", oracleAddr);
    console.log("  Price:", (await oracle.price()).toString());
    console.log("  Last update:", (await oracle.lastUpdateTime()).toString());
    const heartbeat = await oracle.heartbeat();
    const lastUpdate = await oracle.lastUpdateTime();
    const now = Math.floor(Date.now() / 1000);
    const stale = now > Number(lastUpdate) + Number(heartbeat);
    console.log("  Stale?:", stale ? "⚠️ YES — Oracle 价格过期!" : "✅ Fresh");
  }
  
  // Check Vault maPrice fallback
  console.log("  Vault.maPrice (fallback):", (await vault.maPrice()).toString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
