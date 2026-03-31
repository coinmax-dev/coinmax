const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const OLD_BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
  const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";

  const usdc = await ethers.getContractAt("IERC20", USDC);

  // 1. Rescue USDC from old Bridge V1
  const oldBal = await usdc.balanceOf(OLD_BRIDGE);
  console.log("Old Bridge V1 USDC:", ethers.formatEther(oldBal));

  if (oldBal > 0n) {
    console.log("Rescuing from old bridge...");
    // Old bridge is CoinMaxBatchBridge (V1) with emergencyWithdraw
    const oldBridge = new ethers.Contract(OLD_BRIDGE, [
      "function emergencyWithdraw(address token, address to, uint256 amount) external",
    ], deployer);
    const tx = await oldBridge.emergencyWithdraw(USDC, deployer.address, oldBal);
    await tx.wait();
    console.log("✅ Rescued");
  }

  // 2. Total USDC in deployer
  const totalUsdc = await usdc.balanceOf(deployer.address);
  console.log("\nDeployer total USDC:", ethers.formatEther(totalUsdc));
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // 3. Get thirdweb Bridge quote
  console.log("\nGetting thirdweb Bridge quote...");
  console.log("BSC USDC → ARB USDC");
  console.log("Amount:", ethers.formatEther(totalUsdc));
  console.log("To:", ARB_FUND_ROUTER);

  const quoteUrl = `https://bridge.thirdweb.com/v1/quote?` +
    `fromChainId=56` +
    `&fromTokenAddress=${USDC}` +
    `&toChainId=42161` +
    `&toTokenAddress=0xaf88d065e77c8cC2239327C5EDb3A432268e5831` + // ARB native USDC
    `&fromAmount=${totalUsdc.toString()}` +
    `&fromAddress=${deployer.address}` +
    `&toAddress=${ARB_FUND_ROUTER}`;

  const res = await fetch(quoteUrl, {
    headers: { "x-client-id": "a0612a159cd5aeecde69cda291faff38" },
  });
  const quote = await res.json();

  if (!res.ok) {
    console.log("Quote failed:", JSON.stringify(quote).slice(0, 300));
    return;
  }

  console.log("\n=== Bridge Quote ===");
  console.log("Route:", quote?.intent?.bridge || quote?.route || "unknown");
  console.log("Estimated output:", quote?.intent?.buyAmount || "?");
  console.log("Steps:", quote?.steps?.length || 0);

  if (quote?.steps) {
    for (let i = 0; i < quote.steps.length; i++) {
      const step = quote.steps[i];
      console.log(`\nStep ${i + 1}:`, JSON.stringify(step).slice(0, 200));
    }
  }

  console.log("\n✅ Quote ready. To execute, approve USDC to bridge contract and send the TX.");
  console.log("Full quote:", JSON.stringify(quote).slice(0, 500));
}

main().catch(console.error);
