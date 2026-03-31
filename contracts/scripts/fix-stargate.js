const { ethers } = require("hardhat");
async function main() {
  const BRIDGE = "0x7a987C68D63Df1C9A1a3a7395cd72CaaEd26acE6";
  const USDC_STARGATE_POOL = "0x962Bd449E630b0d928f308Ce63f1A21F02576057";

  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);
  console.log("Current Stargate:", await bridge.stargateRouter());

  const tx = await bridge.setStargateRouter(USDC_STARGATE_POOL);
  await tx.wait();
  console.log("✅ Updated to:", await bridge.stargateRouter());

  // Now test quoteSend
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const usdcBal = await usdc.balanceOf(BRIDGE);
  console.log("\nBridge USDC:", ethers.formatEther(usdcBal));

  const arbReceiver = await bridge.arbReceiver();
  const dstEid = await bridge.dstEid();

  const sg = new ethers.Contract(USDC_STARGATE_POOL, [
    "function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))",
  ], (await ethers.getSigners())[0]);

  const toBytes = ethers.zeroPadValue(arbReceiver, 32);
  try {
    const fee = await sg.quoteSend([Number(dstEid), toBytes, usdcBal, usdcBal * 9990n / 10000n, "0x", "0x", "0x"], false);
    console.log("✅ quoteSend: nativeFee =", ethers.formatEther(fee[0]), "BNB");
    console.log("Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));
    console.log("Enough BNB:", (await ethers.provider.getBalance(BRIDGE)) >= fee[0] ? "✅" : "❌ Need more BNB");
  } catch (e) {
    console.log("❌ quoteSend failed:", e.message?.slice(0, 200));
  }
}
main().catch(console.error);
