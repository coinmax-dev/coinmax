const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const ARB_FUND_ROUTER = "0x71237E535d5E00CDf18A609eA003525baEae3489";

  const usdc = await ethers.getContractAt("IERC20", USDC);
  const totalUsdc = await usdc.balanceOf(deployer.address);
  console.log("Deployer USDC:", ethers.formatEther(totalUsdc));
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  if (totalUsdc === 0n) { console.log("No USDC"); return; }

  // thirdweb Bridge quote: BSC USDC → ARB
  console.log("\n=== thirdweb Bridge Quote ===");
  const quoteUrl = `https://bridge.thirdweb.com/v1/quote?` +
    `fromChainId=56` +
    `&fromTokenAddress=${USDC}` +
    `&toChainId=42161` +
    `&toTokenAddress=0xaf88d065e77c8cC2239327C5EDb3A432268e5831` +
    `&fromAmount=${totalUsdc.toString()}` +
    `&fromAddress=${deployer.address}` +
    `&toAddress=${ARB_FUND_ROUTER}`;

  const res = await fetch(quoteUrl, {
    headers: { "x-client-id": "a0612a159cd5aeecde69cda291faff38" },
  });

  if (!res.ok) {
    const err = await res.text();
    console.log("Quote failed:", res.status, err.slice(0, 300));

    // Try USDT instead
    console.log("\nTrying BSC USDC → ARB USDT...");
    const res2 = await fetch(quoteUrl.replace(
      "toTokenAddress=0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "toTokenAddress=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
    ), { headers: { "x-client-id": "a0612a159cd5aeecde69cda291faff38" } });
    const q2 = await res2.json();
    console.log("USDT quote:", JSON.stringify(q2).slice(0, 500));
    return;
  }

  const quote = await res.json();
  console.log("Route:", quote?.intent?.bridge || "thirdweb");
  console.log("Steps:", quote?.steps?.length || 0);

  if (quote?.steps) {
    for (let i = 0; i < quote.steps.length; i++) {
      const step = quote.steps[i];
      const tx = step?.tx || step?.transaction;
      if (tx) {
        console.log(`\nStep ${i+1}: to=${tx.to?.slice(0,12)} value=${tx.value || "0"}`);
        console.log("  data:", (tx.data || "").slice(0, 20) + "...");

        // Execute step
        if (i === 0 && tx.to && tx.data) {
          // Check if it's an approve step
          if (tx.data.startsWith("0x095ea7b3")) {
            console.log("  → Approve TX, executing...");
            const appTx = await deployer.sendTransaction({
              to: tx.to,
              data: tx.data,
              value: tx.value || "0",
              gasLimit: 100000,
            });
            await appTx.wait();
            console.log("  ✅ Approved");
          } else {
            console.log("  → Bridge TX, executing...");
            const bridgeTx = await deployer.sendTransaction({
              to: tx.to,
              data: tx.data,
              value: tx.value || "0",
              gasLimit: 500000,
            });
            const receipt = await bridgeTx.wait();
            console.log("  Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ REVERTED");
            console.log("  TX:", bridgeTx.hash);
          }
        }
      }
    }

    // Execute remaining steps
    for (let i = 1; i < quote.steps.length; i++) {
      const tx = quote.steps[i]?.tx || quote.steps[i]?.transaction;
      if (tx?.to && tx?.data) {
        console.log(`\nExecuting step ${i+1}...`);
        const stepTx = await deployer.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value || "0",
          gasLimit: 500000,
        });
        const r = await stepTx.wait();
        console.log("Status:", r.status === 1 ? "✅" : "❌", "TX:", stepTx.hash);
      }
    }
  }

  console.log("\nDeployer USDC after:", ethers.formatEther(await usdc.balanceOf(deployer.address)));
}

main().catch(console.error);
