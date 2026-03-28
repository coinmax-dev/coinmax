const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  
  const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
  const usdc = await ethers.getContractAt("IERC20", USDC);
  
  const before = await usdc.balanceOf(NODE_POOL);
  console.log("Before flush:", ethers.formatEther(before), "USDC");
  
  // Call flush and check tx
  console.log("Calling flush()...");
  const tx = await pool.flush();
  const receipt = await tx.wait();
  console.log("Tx hash:", receipt.hash);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("Logs:", receipt.logs.length);
  
  for (const log of receipt.logs) {
    console.log("  Log:", log.address, log.topics[0]?.slice(0, 10));
  }
  
  const after = await usdc.balanceOf(NODE_POOL);
  console.log("\nAfter flush:", ethers.formatEther(after), "USDC");
  console.log("Difference:", ethers.formatEther(before - after), "USDC");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
