const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const BATCH_BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
  
  // Direct call with explicit gas
  const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
  
  // Check owner
  const owner = await pool.owner();
  console.log("Owner:", owner);
  console.log("Deployer:", deployer.address);
  console.log("Is owner:", owner.toLowerCase() === deployer.address.toLowerCase());
  
  // Try configure with explicit tx
  try {
    const tx = await pool.configure([BATCH_BRIDGE], [10000], { gasLimit: 200000 });
    const receipt = await tx.wait();
    console.log("Tx status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
    console.log("Tx hash:", receipt.hash);
  } catch (e) {
    console.log("Configure FAILED:", e.message.slice(0, 150));
  }
  
  // Check result
  try {
    const [wallet, share] = await pool.getSlot(0);
    console.log("Slot 0:", wallet, share.toString());
  } catch (e) {
    console.log("getSlot failed:", e.message.slice(0, 80));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
