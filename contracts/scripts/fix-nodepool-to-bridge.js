const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const BATCH_BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
  
  const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
  
  console.log("Before:");
  const [oldWallet, oldShare] = await pool.getSlot(0);
  console.log("  Slot 0:", oldWallet, oldShare.toString());
  
  // Reconfigure: 100% → BatchBridge
  const tx = await pool.configure([BATCH_BRIDGE], [10000]);
  await tx.wait();
  
  console.log("\nAfter:");
  const [newWallet, newShare] = await pool.getSlot(0);
  console.log("  Slot 0:", newWallet, newShare.toString());
  console.log("  Match BatchBridge:", newWallet.toLowerCase() === BATCH_BRIDGE.toLowerCase() ? "✅" : "❌");
  
  console.log(`
链路更新:
  节点 USDC → NodePool → BatchBridge → 每4h Stargate → ARB FundRouter → 5钱包
  (和金库资金合并，用户完全看不到分配)
  `);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
