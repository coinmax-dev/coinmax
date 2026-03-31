const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";

  // 1. Deploy new impl with shares fix
  console.log("1. Deploy new Vault impl (shares 1:1 fix)...");
  const Impl = await ethers.getContractFactory("CoinMaxVault");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   New impl:", implAddr);

  // 2. Upgrade proxy
  console.log("2. Upgrading proxy...");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const tx = await vault.upgradeToAndCall(implAddr, "0x");
  await tx.wait();
  console.log("   ✅ Upgraded");

  // 3. Verify
  console.log("3. Verifying...");
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const implRaw = await ethers.provider.getStorage(VAULT, implSlot);
  const onChainImpl = "0x" + implRaw.slice(26);
  console.log("   On-chain impl:", onChainImpl);
  console.log("   Match:", onChainImpl.toLowerCase() === implAddr.toLowerCase() ? "✅" : "❌");

  // Check plans still exist
  const planCount = await vault.getPlansCount();
  console.log("   Plans count:", planCount.toString());

  // Check roles still work
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  console.log("   SwapRouter GATEWAY:", await vault.hasRole(GW_ROLE, "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3"));
  console.log("   Oracle price:", (await vault.getCurrentMAPrice()).toString());

  console.log("\nDone! Vault upgraded with 1:1 share fix ✅");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
