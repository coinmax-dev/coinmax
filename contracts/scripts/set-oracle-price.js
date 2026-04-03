const { ethers } = require("hardhat");

async function main() {
  const oracle = await ethers.getContractAt("src/v4/MAPriceOracle.sol:MAPriceOracle", "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2");

  console.log("Setting basePrice = $1.00...");
  await (await oracle.setBasePrice(1000000)).wait();

  console.log("Setting floorPrice = $0.90...");
  await (await oracle.setFloorPrice(900000)).wait();

  console.log("\nVerify:");
  console.log("basePrice:", Number(await oracle.basePrice()) / 1e6, "USD");
  console.log("floorPrice:", Number(await oracle.floorPrice()) / 1e6, "USD");
  console.log("currentPrice:", Number(await oracle.getPrice()) / 1e6, "USD");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
