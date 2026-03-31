const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const BRIDGE = "0xe45BBF56B16bF37dA3D4c7C7fB9Cb55eDb9fbedD";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  const usdc = await ethers.getContractAt("IERC20", USDC);

  console.log("Bridge USDT:", ethers.formatEther(await usdt.balanceOf(BRIDGE)));
  console.log("Bridge USDC:", ethers.formatEther(await usdc.balanceOf(BRIDGE)));
  console.log("Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));

  // Try static call first
  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);
  console.log("\nTesting swapAndBridge static call...");
  try {
    await bridge.swapAndBridge.staticCall({ gasLimit: 800000 });
    console.log("Static call: ✅ PASS");
  } catch (e) {
    console.log("Static call: ❌", e.message?.slice(0, 200));

    // Try to decode
    if (e.data) {
      console.log("Error data:", e.data?.slice(0, 40));
    }
  }

  // Test V2 swap directly from deployer to isolate
  console.log("\nDirect V2 swap test (1 USDT from deployer)...");
  const deployerUsdt = await usdt.balanceOf(deployer.address);
  console.log("Deployer USDT:", ethers.formatEther(deployerUsdt));

  if (deployerUsdt >= ethers.parseEther("1")) {
    const router = new ethers.Contract(V2_ROUTER, [
      "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
    ], deployer);

    // Approve
    const appTx = await usdt.approve(V2_ROUTER, ethers.parseEther("1"));
    await appTx.wait();

    try {
      const tx = await router.swapExactTokensForTokens(
        ethers.parseEther("1"),
        ethers.parseEther("0.99"),
        [USDT, USDC],
        deployer.address,
        Math.floor(Date.now()/1000) + 300,
        { gasLimit: 300000 }
      );
      const r = await tx.wait();
      console.log("V2 swap:", r.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");
      console.log("Deployer USDC after:", ethers.formatEther(await usdc.balanceOf(deployer.address)));
    } catch (e) {
      console.log("V2 swap failed:", e.message?.slice(0, 200));
    }
  } else {
    console.log("No USDT to test direct swap");
  }
}
main().catch(console.error);
