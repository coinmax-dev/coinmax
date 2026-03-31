const { ethers } = require("hardhat");
async function main() {
  const BRIDGE = "0x7a987C68D63Df1C9A1a3a7395cd72CaaEd26acE6";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const STARGATE = "0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8";
  const [d] = await ethers.getSigners();

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const usdcBal = await usdc.balanceOf(BRIDGE);
  console.log("Bridge USDC:", ethers.formatEther(usdcBal));
  console.log("Bridge BNB:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));

  // Check Stargate router exists
  const code = await ethers.provider.getCode(STARGATE);
  console.log("Stargate code:", code.length > 2 ? "EXISTS (" + code.length + " bytes)" : "NO CODE ❌");

  // Try quoteSend
  const bridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", BRIDGE);
  const arbReceiver = await bridge.arbReceiver();
  const dstEid = await bridge.dstEid();
  console.log("arbReceiver:", arbReceiver);
  console.log("dstEid:", dstEid.toString());

  if (usdcBal > 0n) {
    console.log("\nTrying Stargate quoteSend...");
    const sg = new ethers.Contract(STARGATE, [
      "function quoteSend((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),bool) view returns ((uint256,uint256))",
    ], d);

    const toBytes = ethers.zeroPadValue(arbReceiver, 32);
    const sendParam = [
      Number(dstEid),    // dstEid
      toBytes,           // to
      usdcBal,           // amountLD
      usdcBal * 9990n / 10000n, // minAmountLD
      "0x",              // extraOptions
      "0x",              // composeMsg
      "0x",              // oftCmd
    ];

    try {
      const fee = await sg.quoteSend(sendParam, false);
      console.log("✅ quoteSend: nativeFee =", ethers.formatEther(fee[0]), "BNB");
      console.log("Bridge has enough BNB:", await ethers.provider.getBalance(BRIDGE) >= fee[0] ? "✅" : "❌");
    } catch (e) {
      console.log("❌ quoteSend failed:", e.message?.slice(0, 200));
    }
  }
}
main().catch(console.error);
