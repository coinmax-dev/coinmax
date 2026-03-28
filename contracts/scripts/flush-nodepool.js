const { ethers } = require("hardhat");

async function main() {
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";
  
  const usdc = await ethers.getContractAt("IERC20", USDC);
  
  // Check balances
  const poolBal = await usdc.balanceOf(NODE_POOL);
  const walletBal = await usdc.balanceOf(NODE_WALLET);
  
  console.log("NodePool USDC:", ethers.formatEther(poolBal));
  console.log("Node Wallet USDC:", ethers.formatEther(walletBal));
  
  if (poolBal > 0n) {
    console.log("\nFlushing NodePool → Node Wallet...");
    const pool = await ethers.getContractAt("CoinMaxSplitter", NODE_POOL);
    const tx = await pool.flush();
    await tx.wait();
    
    const newPoolBal = await usdc.balanceOf(NODE_POOL);
    const newWalletBal = await usdc.balanceOf(NODE_WALLET);
    console.log("After flush:");
    console.log("  NodePool:", ethers.formatEther(newPoolBal));
    console.log("  Node Wallet:", ethers.formatEther(newWalletBal), "✅");
  } else {
    console.log("\nNodePool is empty, nothing to flush.");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
