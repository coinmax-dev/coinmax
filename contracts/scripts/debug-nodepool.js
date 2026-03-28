const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  
  const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
  
  console.log("NodePool owner:", await pool.owner());
  console.log("Deployer:", deployer.address);
  console.log("Match:", (await pool.owner()).toLowerCase() === deployer.address.toLowerCase() ? "✅" : "❌");
  
  console.log("Slot count:", (await pool.slotCount()).toString());
  console.log("Paused:", await pool.paused());
  
  // Try getSlot
  try {
    const [wallet, share] = await pool.getSlot(0);
    console.log("Slot 0:", wallet, share.toString());
  } catch (e) {
    console.log("getSlot failed:", e.message.slice(0, 80));
  }

  // Check: is the USDC token correct?
  console.log("Pool USDC token:", await pool.usdc());
  console.log("Expected USDC:", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
}

main().catch(console.error);
