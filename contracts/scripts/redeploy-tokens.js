const { ethers } = require("hardhat");
async function main() {
  const [d] = await ethers.getSigners();
  console.log("Deployer:", d.address);

  const ma = await (await (await ethers.getContractFactory("MAToken")).deploy(d.address)).waitForDeployment();
  console.log("MA:", await ma.getAddress());

  const cusd = await (await (await ethers.getContractFactory("CUSD")).deploy(d.address)).waitForDeployment();
  console.log("cUSD:", await cusd.getAddress());
}
main().catch(console.error);
