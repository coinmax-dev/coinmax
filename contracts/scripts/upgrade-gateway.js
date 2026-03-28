const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address, "\n");

  const GATEWAY_PROXY = "0xaC126bd86728D81dA05Df67f1E262085d072C36D";

  // 1. Deploy new implementation
  console.log("1. Deploy new Gateway implementation...");
  const NewImpl = await ethers.getContractFactory("CoinMaxGateway");
  const newImpl = await NewImpl.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("   New impl:", newImplAddr);

  // 2. Upgrade proxy
  console.log("2. Upgrade proxy...");
  const gateway = await ethers.getContractAt("CoinMaxGateway", GATEWAY_PROXY);
  const tx = await gateway.upgradeToAndCall(newImplAddr, "0x");
  await tx.wait();
  console.log("   Upgraded ✅");

  // 3. Verify
  console.log("3. Verify...");
  console.log("   cUsd:", await gateway.cUsd());
  console.log("   vault:", await gateway.vault());
  console.log("   dexRouter:", await gateway.dexRouter());
  console.log("   Done!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
