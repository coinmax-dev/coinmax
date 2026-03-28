const { ethers } = require("hardhat");

async function main() {
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";
  
  const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
  
  // Reconfigure: 100% → node wallet (on BSC, then manually bridge to ARB)
  const tx = await pool.configure([NODE_WALLET], [10000], { gasLimit: 200000 });
  await tx.wait();
  
  const [wallet] = await pool.getSlot(0);
  console.log("NodePool → ", wallet);
  console.log("Match:", wallet.toLowerCase() === NODE_WALLET.toLowerCase() ? "✅" : "❌");
  console.log("\n节点资金链路: NodePool → 0xeb8A (BSC) → 手动桥到 ARB 0xeb8A");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
