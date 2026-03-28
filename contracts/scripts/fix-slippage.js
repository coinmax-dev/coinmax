const { ethers } = require("hardhat");

async function main() {
  const gw = await ethers.getContractAt("CoinMaxGateway", "0x38a692f51FF4Db415cf8620d131df518fb8F3b30");
  
  console.log("Before:", (await gw.maxSlippageBps()).toString(), "bps");
  
  const tx = await gw.setMaxSlippageBps(50); // 0.5%
  await tx.wait();
  
  console.log("After:", (await gw.maxSlippageBps()).toString(), "bps ✅");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
