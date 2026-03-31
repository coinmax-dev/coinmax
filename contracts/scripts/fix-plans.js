const { ethers } = require("hardhat");
async function main() {
  const vault = await ethers.getContractAt("CoinMaxVault", "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93");
  for (let i = 4; i < 8; i++) {
    const [dur, rate] = await vault.getStakePlan(i);
    await (await vault.updatePlan(i, dur, rate, false)).wait();
    console.log("Plan[" + i + "] disabled ✅");
  }
  // Verify
  const count = Number(await vault.getPlansCount());
  for (let i = 0; i < count; i++) {
    const [dur, rate, active] = await vault.getStakePlan(i);
    console.log("[" + i + "]", Number(dur)/86400 + "d", Number(rate)/100 + "%", active ? "✅" : "❌");
  }
}
main().catch(console.error);
