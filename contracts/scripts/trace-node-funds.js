const { ethers } = require("hardhat");

async function main() {
  const NODES_V2 = "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";
  const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
  const SWAP_ROUTER = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const nodes = await ethers.getContractAt("CoinMaxNodesV2", NODES_V2);
  
  console.log("=== Where is the money? ===");
  console.log("NodesV2 fundDistributor:", await nodes.fundDistributor());
  console.log("");
  
  // Check balances of all relevant addresses
  const addrs = [
    ["NodesV2", NODES_V2],
    ["SwapRouter", SWAP_ROUTER],
    ["NodePool", NODE_POOL],
    ["Node Wallet", "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9"],
    ["Old FundManager", "0xbab0f5ab980870789f88807f2987ca569b875616"],
    ["Deployer", "0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1"],
    ["BatchBridge", "0x670dbfAA27C9a32023484B4BF7688171E70962f6"],
  ];
  
  for (const [name, addr] of addrs) {
    const bal = await usdc.balanceOf(addr);
    if (bal > 0n) {
      console.log(`  ${name} (${addr}): $${ethers.formatEther(bal)} USDC ← HAS MONEY`);
    } else {
      console.log(`  ${name}: $0`);
    }
  }
}

main().catch(console.error);
