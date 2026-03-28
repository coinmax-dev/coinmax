const { ethers } = require("hardhat");

async function main() {
  // Old SwapRouter has the pool address
  const SWAP_ROUTER = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  
  const iface = new ethers.Interface([
    "function pancakePool() view returns (address)",
    "function pancakeRouter() view returns (address)",
    "function poolFee() view returns (uint24)",
    "function isToken0Usdt() view returns (bool)",
  ]);
  
  const read = async (sig) => {
    const data = iface.encodeFunctionData(sig);
    const result = await ethers.provider.call({ to: SWAP_ROUTER, data });
    return iface.decodeFunctionResult(sig, result)[0];
  };
  
  const pool = await read("pancakePool");
  const router = await read("pancakeRouter");
  const fee = await read("poolFee");
  const isT0Usdt = await read("isToken0Usdt");
  
  console.log("=== PancakeSwap V3 Pool ===");
  console.log("  Pool:", pool);
  console.log("  Router:", router);
  console.log("  Fee:", fee.toString(), "(" + (Number(fee)/10000*100) + "%)");
  console.log("  isToken0Usdt:", isT0Usdt);
  console.log("  BscScan:", `https://bscscan.com/address/${pool}`);

  // Check who deployed the pool / owns the LP position
  // The LP position is an NFT in PancakeSwap V3 NonfungiblePositionManager
  const NFT_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";
  console.log("\n=== LP Position Manager ===");
  console.log("  NFT Manager:", NFT_MANAGER);
  console.log("  Check LP positions: https://bscscan.com/address/" + NFT_MANAGER + "#readContract");
  
  // The deployer wallet likely holds the LP NFT
  console.log("\n  Your LP NFT is in the wallet that called addLiquidity.");
  console.log("  Check deployer (0x1B6B) or the wallet used to create the pool.");
}

main().catch(console.error);
