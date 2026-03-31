const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const BRIDGE = "0x5BDc4220Ea06CfaD6B42fD1c69ce4D2BAA46C0Db";

  console.log("Deployer:", deployer.address);
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  console.log("Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));

  // Step 1: Send BNB to bridge for Stargate fee (~0.005 BNB should be enough)
  const bnbNeeded = ethers.parseEther("0.01");
  const bridgeBnb = await ethers.provider.getBalance(BRIDGE);

  if (bridgeBnb < bnbNeeded) {
    console.log("\nSending 0.01 BNB to BatchBridgeV2...");
    const tx = await deployer.sendTransaction({ to: BRIDGE, value: bnbNeeded });
    await tx.wait();
    console.log("✅ Sent. Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));
  }

  // Step 2: Call swapAndBridge
  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);

  const [ready, usdtBal] = await bridge.canBridge();
  console.log("\ncanBridge:", ready, "| USDT:", ethers.formatEther(usdtBal));

  if (!ready) {
    console.log("Not ready to bridge yet");
    return;
  }

  console.log("Calling swapAndBridge()...");
  try {
    const tx = await bridge.swapAndBridge({ gasLimit: 1000000 });
    console.log("TX:", tx.hash);
    const receipt = await tx.wait();
    console.log("Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");
    console.log("Gas used:", receipt.gasUsed.toString());

    // Check results
    console.log("\nAfter bridge:");
    console.log("Bridge USDT:", ethers.formatEther(await new ethers.Contract(
      "0x55d398326f99059fF775485246999027B3197955",
      ["function balanceOf(address) view returns (uint256)"],
      deployer
    ).balanceOf(BRIDGE)));
    console.log("Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));
    console.log("totalBridged:", ethers.formatEther(await bridge.totalBridged()));
    console.log("bridgeCount:", (await bridge.bridgeCount()).toString());
  } catch (e) {
    console.log("❌ FAILED:", e.message?.slice(0, 200));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
