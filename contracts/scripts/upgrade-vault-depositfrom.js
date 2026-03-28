const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";

  console.log("1. Deploy new Vault impl...");
  const Impl = await ethers.getContractFactory("CoinMaxVault");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  console.log("   Impl:", await impl.getAddress());

  console.log("2. Upgrade Vault proxy...");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const tx = await vault.upgradeToAndCall(await impl.getAddress(), "0x");
  await tx.wait();
  console.log("   Upgraded ✅");

  // 3. Verify depositFrom exists
  try {
    const frag = vault.interface.getFunction("depositFrom");
    console.log("3. depositFrom exists:", !!frag, "✅");
  } catch {
    console.log("3. depositFrom: NOT FOUND ❌");
  }

  // 4. Verify old functions still work
  console.log("4. Verify:");
  console.log("   maToken:", await vault.maToken());
  console.log("   priceOracle:", await vault.priceOracle());
  console.log("   getCurrentMAPrice:", (await vault.getCurrentMAPrice()).toString());
  console.log("   plans:", (await vault.getPlansCount()).toString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
