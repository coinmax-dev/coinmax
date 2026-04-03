const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";

  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));

  // Check state
  console.log("Vault paused:", await vault.paused());
  console.log("Engine has ENGINE_ROLE:", await vault.hasRole(ENGINE_ROLE, ENGINE));
  console.log("Deployer has ENGINE_ROLE:", await vault.hasRole(ENGINE_ROLE, deployer.address));

  // Check what functions exist
  try {
    await vault.createPosition.staticCall(deployer.address, ethers.parseEther("10"), "90_DAYS", false);
    console.log("createPosition static call: OK");
  } catch(e) {
    console.log("createPosition revert:", e.data || e.shortMessage || e.reason);
    if (e.data) {
      const iface = new ethers.Interface([
        "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
        "error EnforcedPause()",
        "error Error(string)",
      ]);
      try { const d = iface.parseError(e.data); console.log("Decoded:", d.name, d.args?.map(a => a.toString())); } catch {}
    }
  }

  // Grant ENGINE_ROLE to deployer for testing
  const hasRole = await vault.hasRole(ENGINE_ROLE, deployer.address);
  if (!hasRole) {
    console.log("\nGranting ENGINE_ROLE to deployer...");
    await (await vault.grantRole(ENGINE_ROLE, deployer.address)).wait();
  }

  // Try again
  try {
    await vault.createPosition.staticCall(deployer.address, ethers.parseEther("10"), "90_DAYS", false);
    console.log("createPosition with ENGINE_ROLE: OK");

    // Actually execute
    console.log("Executing createPosition...");
    const tx = await vault.createPosition(deployer.address, ethers.parseEther("10"), "90_DAYS", false, { gasLimit: 500000 });
    const receipt = await tx.wait();
    console.log("✅ TX:", tx.hash, "gas:", receipt.gasUsed.toString());
  } catch(e) {
    console.log("Still failing:", e.data || e.shortMessage || e.reason);
  }

  // Cleanup
  await (await vault.revokeRole(ENGINE_ROLE, deployer.address)).wait();
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,300)); process.exit(1); });
