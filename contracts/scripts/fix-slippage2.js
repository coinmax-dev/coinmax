const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const gw = await ethers.getContractAt("CoinMaxGateway", "0x38a692f51FF4Db415cf8620d131df518fb8F3b30");
  
  // Check admin
  const ADMIN = ethers.ZeroHash;
  const hasAdmin = await gw.hasRole(ADMIN, deployer.address);
  console.log("Deployer has ADMIN:", hasAdmin);
  
  if (!hasAdmin) {
    console.log("ERROR: deployer is not admin on new Gateway!");
    return;
  }
  
  const before = await gw.maxSlippageBps();
  console.log("Before:", before.toString());
  
  const tx = await gw.setMaxSlippageBps(50);
  const receipt = await tx.wait();
  console.log("Tx hash:", receipt.hash);
  
  const after = await gw.maxSlippageBps();
  console.log("After:", after.toString());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
