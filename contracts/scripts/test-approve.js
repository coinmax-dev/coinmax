const { ethers } = require("hardhat");

async function main() {
  const GATEWAY = "0x38a692f51FF4Db415cf8620d131df518fb8F3b30";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const PANCAKE = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

  // Check current allowance from Gateway to PancakeSwap Router
  const usdt = await ethers.getContractAt("IERC20", USDT);
  const allowance = await usdt.allowance(GATEWAY, PANCAKE);
  console.log("Gateway → PancakeRouter USDT allowance:", ethers.formatEther(allowance));

  // Check: is the issue that Gateway can't approve?
  // forceApprove does: if allowance > 0, set to 0 first, then set to amount
  // BSC USDT uses standard ERC20, so this should work
  
  // The REAL issue might be the FRONTEND:
  // Frontend sends depositVault with msg.value = 0
  // But depositVault is "payable" — it checks bridgeOptions
  // The function signature includes "bytes bridgeOptions"
  // If bridgeOptions is empty "0x", it should be fine
  
  // Let me check: does the error come from the APPROVE step or the DEPOSIT step?
  console.log("\n=== Checking if error is from approve or deposit ===");
  console.log("If user's wallet shows TWO transactions:");
  console.log("  1. Approve (succeeds) → then 2. Deposit (fails with 0xfb8f41b2)");
  console.log("  = ERC20InsufficientAllowance inside Gateway swap");
  console.log("");
  console.log("If user's wallet shows ONE failed transaction:");
  console.log("  = Approve itself failed, or deposit simulation failed before sending");
  
  // The most common cause: USDT on BSC already has allowance > 0 for the old Gateway
  // and user is trying again. But we already use forceApprove which sets to 0 first.
  
  // Actually wait — the user APPROVES USDT to the Gateway.
  // Then Gateway calls depositVault, which does:
  //   usdt.safeTransferFrom(msg.sender, address(this), usdtAmount)
  // This needs the user's approve to Gateway. The approve IS for the new Gateway (0x38a6).
  // So safeTransferFrom should work.
  
  // Then Gateway does:
  //   usdt.forceApprove(address(dexRouter), amountIn)
  // This is Gateway approving its OWN USDT to PancakeSwap. No user approval needed.
  
  // So WHERE does ERC20InsufficientAllowance come from?
  // It must be from step 1: usdt.safeTransferFrom(user → gateway)
  // Which means the user's approve didn't actually go through, or went to wrong address.
  
  console.log("\n=== Most likely cause ===");
  console.log("The user's APPROVE transaction went to the old Gateway (0xaC12)");
  console.log("But the DEPOSIT transaction goes to new Gateway (0x38a6)");
  console.log("The new Gateway doesn't have allowance → ERC20InsufficientAllowance");
  console.log("");
  console.log("Check: does the frontend approve USDT to GATEWAY_ADDRESS?");
  
  // Read what address the frontend uses
  const fs = require("fs");
  const contractsTs = fs.readFileSync("/Users/macbookpro/WebstormProjects/coinmax-dev/src/lib/contracts.ts", "utf8");
  const match = contractsTs.match(/GATEWAY_ADDRESS.*"(0x[a-fA-F0-9]+)"/);
  console.log("\nFrontend GATEWAY_ADDRESS:", match ? match[1] : "NOT FOUND");
  
  // Check vault-deposit-dialog
  const vaultDialog = fs.readFileSync("/Users/macbookpro/WebstormProjects/coinmax-dev/src/components/vault/vault-deposit-dialog.tsx", "utf8");
  const spenderMatch = vaultDialog.match(/spender:\s*(\w+)/);
  console.log("Approve spender:", spenderMatch ? spenderMatch[1] : "NOT FOUND");
}

main().catch(console.error);
