const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  
  const GATEWAY = "0x38a692f51FF4Db415cf8620d131df518fb8F3b30";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  
  const gw = await ethers.getContractAt("CoinMaxGateway", GATEWAY);
  const usdt = await ethers.getContractAt("IERC20", USDT);
  
  // Check deployer USDT balance
  const bal = await usdt.balanceOf(deployer.address);
  console.log("USDT balance:", ethers.formatEther(bal));
  
  if (bal == 0n) {
    console.log("No USDT to test. Trying static call to simulate...");
  }
  
  // Try static call to see the revert reason
  try {
    const amount = ethers.parseEther("50"); // 50 USDT
    const minOut = ethers.parseEther("49.9");
    
    await gw.depositVault.staticCall(amount, 0, minOut, "0x", { value: 0 });
    console.log("Static call: SUCCESS (would work)");
  } catch (e) {
    console.log("Static call REVERTED:");
    console.log("  Message:", e.message?.slice(0, 200));
    
    // Try to decode
    if (e.data) {
      console.log("  Data:", e.data);
    }
    if (e.reason) {
      console.log("  Reason:", e.reason);
    }
    
    // Check each step individually
    console.log("\n--- Step-by-step check ---");
    
    // Can Gateway call dexRouter?
    console.log("Gateway.dexRouter:", await gw.dexRouter());
    console.log("Gateway.isVaultChain:", await gw.isVaultChain());
    console.log("Gateway.cooldownPeriod:", (await gw.cooldownPeriod()).toString());
    
    // Check slippage validation
    const maxSlip = await gw.maxSlippageBps();
    console.log("Gateway.maxSlippageBps:", maxSlip.toString());
    const floor = ethers.parseEther("50") * (10000n - maxSlip) / 10000n;
    console.log("Min out floor:", ethers.formatEther(floor));
    console.log("Provided minOut:", ethers.formatEther(ethers.parseEther("49.9")));
    console.log("Floor check passes:", ethers.parseEther("49.9") >= floor);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
