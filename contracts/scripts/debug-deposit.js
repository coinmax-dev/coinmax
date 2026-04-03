const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const CUSD = "0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B";
  
  const usdc = await ethers.getContractAt("IERC20", USDC);
  const cusd = await ethers.getContractAt("src/v4/CUSD.sol:CUSD", CUSD);
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);

  // Check state
  console.log("Allowance:", ethers.formatEther(await usdc.allowance(deployer.address, VAULT)));
  console.log("CUSD MINTER→Vault:", await cusd.hasRole(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")), VAULT));
  console.log("Vault paused:", await vault.paused());

  // Static call to get revert reason
  try {
    await vault.depositPublic.staticCall(ethers.parseEther("10"), "90_DAYS");
    console.log("Static call OK");
  } catch(e) {
    console.log("Revert reason:", e.reason || e.shortMessage || e.message?.slice(0, 300));
    if (e.data) console.log("Error data:", e.data);
  }
}
main().catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
