const { ethers } = require("hardhat");
async function main() {
  const oracle = await ethers.getContractAt("MAPriceOracle", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD");
  console.log("Current (unsafe):", Number(await oracle.getPriceUnsafe()) / 1e6);
  const tx = await oracle.updatePrice(600000);
  await tx.wait();
  console.log("✅ Updated to $0.60");
}
main().catch(console.error);
