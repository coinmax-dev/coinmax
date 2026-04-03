const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  
  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);

  const bal = await ma.balanceOf(deployer.address);
  console.log("MA:", ethers.formatEther(bal));

  console.log("requestSwap...");
  const tx = await flash.requestSwap(bal, { gasLimit: 500000 });
  const receipt = await tx.wait();
  console.log("✅ TX:", tx.hash, "gas:", receipt.gasUsed.toString());
  
  console.log("MA after:", ethers.formatEther(await ma.balanceOf(deployer.address)));
  console.log("MA burned:", ethers.formatEther(await ma.totalBurned()));
  console.log("Pending:", (await flash.pendingCount()).toString());
  
  const req = await flash.getRequest(0);
  console.log("Request #0: user:", req.user.slice(0,10), "usdtOut:", ethers.formatEther(req.usdtOut), "fulfilled:", req.fulfilled);
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
