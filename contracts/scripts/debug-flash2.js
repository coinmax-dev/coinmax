const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  
  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);

  const bal = await ma.balanceOf(deployer.address);
  console.log("MA balance:", ethers.formatEther(bal));
  console.log("MA allowance→Flash:", ethers.formatEther(await ma.allowance(deployer.address, FLASH)));
  console.log("minSwapAmount:", ethers.formatEther(await flash.minSwapAmount()));

  try {
    const result = await flash.requestSwap.staticCall(bal, { gasLimit: 500000 });
    console.log("Static call OK, requestId:", result.toString());
  } catch(e) {
    console.log("Revert data:", e.data);
    if (e.data && e.data.length > 10) {
      // Try all known error types
      const errors = [
        "error ERC20InsufficientAllowance(address,uint256,uint256)",
        "error ERC20InsufficientBalance(address,uint256,uint256)",
        "error AccessControlUnauthorizedAccount(address,bytes32)",
        "error ReentrancyGuardReentrantCall()",
        "error EnforcedPause()",
        "error Error(string)",
      ];
      const iface = new ethers.Interface(errors);
      try {
        const decoded = iface.parseError(e.data);
        console.log("Decoded:", decoded.name, decoded.args?.map(a => typeof a === "bigint" ? a.toString() : a));
      } catch {
        console.log("Selector:", e.data.slice(0,10));
      }
    } else {
      console.log("No data, might be gas/reentrancy issue");
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
