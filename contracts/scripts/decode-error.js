const { ethers } = require("hardhat");

async function main() {
  // Compute known error selectors
  const errors = [
    "AccessControlUnauthorizedAccount(address,bytes32)",
    "ERC20InsufficientAllowance(address,uint256,uint256)",
    "ERC20InsufficientBalance(address,uint256,uint256)",
    "InvalidInitialization()",
    "EnforcedPause()",
    "FailedCall()",
    "InsufficientBalance(address,uint256,uint256)",
  ];
  
  for (const e of errors) {
    const selector = ethers.id(e).slice(0, 10);
    console.log(`  ${selector} = ${e}`);
  }
  
  console.log("\n  Target: 0xfb8f41b2");
  
  // Check PancakeSwap specific errors
  const pcErrors = [
    "STF()",
    "TF()",
    "AS()",
    "LOK()",
    "InvalidAmountOut()",
    "T()",
  ];
  for (const e of pcErrors) {
    const selector = ethers.id(e).slice(0, 10);
    if (selector === "0xfb8f41b2") console.log(`  MATCH: ${e}`);
  }

  // Try common Uniswap/PancakeSwap errors  
  const uniErrors = [
    "InsufficientOutputAmount()",
    "InsufficientInputAmount()",
    "TransferFailed()",
    "InvalidPool()",
  ];
  for (const e of uniErrors) {
    const selector = ethers.id(e).slice(0, 10);
    if (selector === "0xfb8f41b2") console.log(`  MATCH: ${e}`);
    console.log(`  ${selector} = ${e}`);
  }
}

main().catch(console.error);
