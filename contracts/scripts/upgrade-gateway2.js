const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const GATEWAY_PROXY = "0xaC126bd86728D81dA05Df67f1E262085d072C36D";
  const NEW_IMPL = "0x99d0FF53be985247C75C3125F6C3cb886B66c734";

  // Try with UUPSUpgradeable interface
  const iface = new ethers.Interface([
    "function upgradeToAndCall(address newImplementation, bytes data)",
    "function upgradeTo(address newImplementation)",
  ]);

  // Try upgradeToAndCall
  try {
    const data = iface.encodeFunctionData("upgradeToAndCall", [NEW_IMPL, "0x"]);
    const tx = await deployer.sendTransaction({ to: GATEWAY_PROXY, data });
    await tx.wait();
    console.log("upgradeToAndCall ✅");
  } catch (e1) {
    console.log("upgradeToAndCall failed:", e1.message.slice(0, 80));
    // Try upgradeTo
    try {
      const data = iface.encodeFunctionData("upgradeTo", [NEW_IMPL]);
      const tx = await deployer.sendTransaction({ to: GATEWAY_PROXY, data });
      await tx.wait();
      console.log("upgradeTo ✅");
    } catch (e2) {
      console.log("upgradeTo failed:", e2.message.slice(0, 80));
      console.log("\nGateway is NOT upgradeable. Need to redeploy.");
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
