const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const [signer] = await ethers.getSigners();

  console.log("Signer:", signer.address);

  // Check current plans
  const planCount = await vault.getPlansCount();
  console.log("Current plan count:", planCount.toString());

  if (planCount > 0n) {
    console.log("Plans already exist! Listing:");
    for (let i = 0; i < Number(planCount); i++) {
      const [dur, rate, active] = await vault.getStakePlan(i);
      console.log(`  Plan[${i}]: ${Number(dur)/86400}d, ${Number(rate)/100}%/day, active=${active}`);
    }
    return;
  }

  // Add 4 plans matching VAULT_PLANS in data.ts
  // Plan 0: 5 days,  0.5%/day (dailyRate=50 bps)
  // Plan 1: 45 days, 0.7%/day (dailyRate=70 bps)
  // Plan 2: 90 days, 0.9%/day (dailyRate=90 bps)
  // Plan 3: 180 days, 1.2%/day (dailyRate=120 bps)

  const plans = [
    { duration: 5 * 86400,   dailyRate: 50,  label: "5天 0.5%/日" },
    { duration: 45 * 86400,  dailyRate: 70,  label: "45天 0.7%/日" },
    { duration: 90 * 86400,  dailyRate: 90,  label: "90天 0.9%/日" },
    { duration: 180 * 86400, dailyRate: 120, label: "180天 1.2%/日" },
  ];

  for (const plan of plans) {
    console.log(`Adding plan: ${plan.label} ...`);
    const tx = await vault.addPlan(plan.duration, plan.dailyRate);
    await tx.wait();
    console.log(`  ✅ TX: ${tx.hash}`);
  }

  // Verify
  const newCount = await vault.getPlansCount();
  console.log(`\nDone! ${newCount} plans configured.`);
  for (let i = 0; i < Number(newCount); i++) {
    const [dur, rate, active] = await vault.getStakePlan(i);
    console.log(`  Plan[${i}]: ${Number(dur)/86400}d, ${Number(rate)/100}%/day, active=${active}`);
  }
}

main().catch(console.error);
