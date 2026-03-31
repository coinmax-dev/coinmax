const { ethers } = require("hardhat");
async function main() {
  const v = await ethers.getContractAt("CoinMaxVault", "0x2E07f56219FB9f39DcAce289288DE07F2bA96B93");
  const [d, r] = await v.getStakePlan(7);
  await (await v.updatePlan(7, d, r, false)).wait();
  const [, , a] = await v.getStakePlan(7);
  console.log("Plan[7] active:", a);
}
main().catch(console.error);
