const { ethers } = require("hardhat");

async function main() {
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
  const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";

  // These are thirdweb server wallets, need to use Engine API
  // But 0x0831 and 0x927e might have their BNB accessible via Engine
  
  // Actually, let's transfer from Deployer directly
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // Send 0.005 BNB to each
  console.log("\nSending 0.005 BNB → Engine...");
  const tx1 = await deployer.sendTransaction({ to: ENGINE, value: ethers.parseEther("0.005") });
  await tx1.wait();
  console.log("✅ TX:", tx1.hash);

  console.log("Sending 0.005 BNB → Receiver...");
  const tx2 = await deployer.sendTransaction({ to: RECEIVER, value: ethers.parseEther("0.005") });
  await tx2.wait();
  console.log("✅ TX:", tx2.hash);

  console.log("\nBalances:");
  console.log("Engine:", ethers.formatEther(await ethers.provider.getBalance(ENGINE)), "BNB");
  console.log("Receiver:", ethers.formatEther(await ethers.provider.getBalance(RECEIVER)), "BNB");
  console.log("Deployer:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
