const { ethers } = require("hardhat");

async function main() {
  const USER = "0x3070063A913AF0b676BAcdeea2F73DA415614f4f";
  const NEW_GW = "0x2F6EBe9b9EF8B979e9aECDcD4D5aCb876A4DBB2a";
  
  // Exact same params as the failed tx
  const gw = await ethers.getContractAt("CoinMaxGateway", NEW_GW);
  
  try {
    // staticCall simulates without sending
    const result = await gw.depositVault.staticCall(
      ethers.parseEther("50"),  // 50 USDT
      0,                         // plan 0
      ethers.parseEther("49.75"), // minOut
      "0x",                      // bridgeOptions
      { from: USER }
    );
    console.log("Would succeed! Result:", result);
  } catch (e) {
    console.log("REVERT reason:", e.message);
    
    // Try to extract revert data
    if (e.data) {
      console.log("Revert data:", e.data.slice(0, 200));
      
      // Decode if Error(string)
      if (e.data.startsWith("0x08c379a0")) {
        try {
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + e.data.slice(10));
          console.log("REVERT STRING:", decoded[0]);
        } catch {}
      }
    }
    
    // Try each step separately
    console.log("\n--- Step-by-step simulation ---");
    
    // Step 1: Can user transfer USDT to Gateway?
    const usdt = await ethers.getContractAt("IERC20", "0x55d398326f99059fF775485246999027B3197955");
    try {
      await usdt.transferFrom.staticCall(USER, NEW_GW, ethers.parseEther("50"), { from: NEW_GW });
      console.log("Step 1 (transferFrom): ✅");
    } catch (e1) {
      console.log("Step 1 (transferFrom): ❌", e1.message.slice(0, 80));
    }
    
    // Step 2: What about cooldown?
    const lastTime = await gw.lastDepositTime(USER);
    const cooldown = await gw.cooldownPeriod();
    const now = Math.floor(Date.now() / 1000);
    const canDeposit = now >= Number(lastTime) + Number(cooldown);
    console.log("Step 2 (cooldown):", canDeposit ? "✅ OK" : `❌ Wait ${Number(lastTime) + Number(cooldown) - now}s`);
  }
}

main().catch(console.error);
