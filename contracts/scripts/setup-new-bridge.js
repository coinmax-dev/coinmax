const { ethers } = require("hardhat");
async function main() {
  const OLD = "0x7a987C68D63Df1C9A1a3a7395cd72CaaEd26acE6";
  const NEW = "0x0c67E7CE7965e3cCCFb1F9ee6370D61376D3ECe3";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const USDC_STARGATE = "0x962Bd449E630b0d928f308Ce63f1A21F02576057";
  const [d] = await ethers.getSigners();

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const oldBridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", OLD);
  const newBridge = await ethers.getContractAt("CoinMaxBatchBridgeV2", NEW);
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);

  // 1. Rescue USDC from old
  const oldBal = await usdc.balanceOf(OLD);
  console.log("Old USDC:", ethers.formatEther(oldBal));
  if (oldBal > 0n) {
    await (await oldBridge.emergencyWithdraw(USDC, NEW, oldBal)).wait();
    console.log("✅ Rescued USDC");
  }

  // 2. Rescue BNB from old
  const oldBnb = await ethers.provider.getBalance(OLD);
  if (oldBnb > 0n) {
    await (await oldBridge.emergencyWithdrawNative(d.address)).wait();
    console.log("✅ Rescued BNB to deployer");
  }

  // 3. Update vault fundDistributor
  await (await vault.setFundDistributor(NEW)).wait();
  console.log("✅ Vault fd →", await vault.fundDistributor());

  // 4. Update Stargate to USDC pool
  await (await newBridge.setStargateRouter(USDC_STARGATE)).wait();
  console.log("✅ Stargate →", await newBridge.stargateRouter());

  // 5. Send BNB
  await (await d.sendTransaction({ to: NEW, value: ethers.parseEther("0.005") })).wait();

  console.log("\n=== New Bridge ===");
  console.log("Address:", NEW);
  console.log("USDC:", ethers.formatEther(await usdc.balanceOf(NEW)));
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(NEW)));

  // 6. Test bridgeOnly
  console.log("\nCalling bridgeOnly()...");
  try {
    const tx = await newBridge.bridgeOnly({ gasLimit: 500000 });
    console.log("TX:", tx.hash);
    const r = await tx.wait();
    console.log(r.status === 1 ? "✅ BRIDGE SUCCESS!" : "❌ REVERTED");
    console.log("USDC after:", ethers.formatEther(await usdc.balanceOf(NEW)));
  } catch (e) {
    console.log("❌", e.message?.slice(0, 200));
  }
}
main().catch(console.error);
