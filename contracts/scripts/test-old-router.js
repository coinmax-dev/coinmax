const { ethers } = require("hardhat");

async function main() {
  // Simulate the old SwapRouter swap path
  const OLD_SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const NEW_GW = "0x2F6EBe9b9EF8B979e9aECDcD4D5aCb876A4DBB2a";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USER = "0x3070063A913AF0b676BAcdeea2F73DA415614f4f";

  const usdt = await ethers.getContractAt("IERC20", USDT);
  
  // Check user's allowances
  console.log("User USDT allowance → Old SwapRouter:", ethers.formatEther(await usdt.allowance(USER, OLD_SR)));
  console.log("User USDT allowance → New Gateway:", ethers.formatEther(await usdt.allowance(USER, NEW_GW)));
  console.log("User USDT balance:", ethers.formatEther(await usdt.balanceOf(USER)));
  
  // The key question: WHY does old SwapRouter work but new Gateway doesn't?
  // They use the exact same PancakeSwap call pattern.
  
  // Let me check if the new Gateway proxy is actually pointing to correct impl
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const gwImpl = await ethers.provider.getStorage(NEW_GW, implSlot);
  console.log("\nNew Gateway impl:", "0x" + gwImpl.slice(-40));
  
  // Check if Gateway is properly initialized
  const iface = new ethers.Interface([
    "function usdt() view returns (address)",
    "function usdc() view returns (address)",
    "function dexRouter() view returns (address)",
    "function poolFee() view returns (uint24)",
    "function maxSlippageBps() view returns (uint256)",
    "function isVaultChain() view returns (bool)",
    "function cUsd() view returns (address)",
    "function vault() view returns (address)",
    "function treasury() view returns (address)",
    "function paused() view returns (bool)",
  ]);
  
  for (const fn of ["usdt", "usdc", "dexRouter", "poolFee", "maxSlippageBps", "isVaultChain", "cUsd", "vault", "treasury", "paused"]) {
    try {
      const data = iface.encodeFunctionData(fn);
      const result = await ethers.provider.call({ to: NEW_GW, data });
      const decoded = iface.decodeFunctionResult(fn, result)[0];
      console.log(`  ${fn}: ${decoded}`);
    } catch (e) {
      console.log(`  ${fn}: ERROR - ${e.message.slice(0, 50)}`);
    }
  }
}

main().catch(console.error);
