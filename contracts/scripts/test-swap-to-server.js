const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
  const RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);

  const amount = ethers.parseEther("10"); // $10 USDT
  const minOut = amount * 995n / 1000n;

  console.log("Deployer USDT:", ethers.formatEther(await usdt.balanceOf(deployer.address)));
  console.log("Receiver USDC before:", ethers.formatEther(await usdc.balanceOf(RECEIVER)));

  // Approve
  console.log("\nApproving USDT → Router...");
  await (await usdt.approve(ROUTER, amount)).wait();

  // Swap USDT → USDC, recipient = Server
  console.log("Swapping $10 USDT → USDC → Server...");
  const router = new ethers.Contract(ROUTER, [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)"
  ], deployer);

  try {
    const tx = await router.exactInputSingle({
      tokenIn: USDT,
      tokenOut: USDC,
      fee: 100,
      recipient: RECEIVER,
      amountIn: amount,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    }, { gasLimit: 300000 });
    const receipt = await tx.wait();
    console.log("✅ TX:", tx.hash, "gas:", receipt.gasUsed.toString());
  } catch(e) {
    console.log("❌ Revert:", e.shortMessage || e.reason || e.data);
  }

  console.log("\nDeployer USDT:", ethers.formatEther(await usdt.balanceOf(deployer.address)));
  console.log("Receiver USDC:", ethers.formatEther(await usdc.balanceOf(RECEIVER)));
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
