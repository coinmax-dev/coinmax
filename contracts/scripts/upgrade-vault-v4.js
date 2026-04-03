const { ethers } = require("hardhat");
async function main() {
  const VAULT_PROXY = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  console.log("Deploying new VaultV4 impl...");
  const Impl = await ethers.getContractFactory("CoinMaxVaultV4");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("New impl:", implAddr);

  console.log("Upgrading proxy...");
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT_PROXY);
  await (await vault.upgradeToAndCall(implAddr, "0x")).wait();
  console.log("✅ Upgraded");

  // Verify fix: static call deposit
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const [deployer] = await ethers.getSigners();
  try {
    await vault.depositPublic.staticCall(ethers.parseEther("10"), "90_DAYS");
    console.log("✅ depositPublic static call OK");
  } catch(e) {
    console.log("❌ Still failing:", e.reason || e.shortMessage?.slice(0,100));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
