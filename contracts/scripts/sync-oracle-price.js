const { ethers } = require("hardhat");
async function main() {
  const oracle = await ethers.getContractAt("MAPriceOracle", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD");
  let price = Number(await oracle.getPriceUnsafe());
  console.log("Current:", price / 1e6);

  const target = 900000; // $0.90
  while (price < target * 0.99) {
    const next = Math.min(Math.round(price * 1.10), target);
    console.log("  ->", next / 1e6);
    const tx = await oracle.updatePrice(next);
    await tx.wait();
    price = next;
  }
  console.log("Final:", Number(await oracle.getPriceUnsafe()) / 1e6);
}
main().catch(console.error);
