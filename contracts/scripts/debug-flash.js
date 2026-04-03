const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);
  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);

  console.log("MA balance:", ethers.formatEther(await ma.balanceOf(deployer.address)));
  console.log("MA allowance→Flash:", ethers.formatEther(await ma.allowance(deployer.address, FLASH)));
  console.log("Flash MINTER_ROLE:", await ma.hasRole(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")), FLASH));

  try {
    await flash.requestSwap.staticCall(await ma.balanceOf(deployer.address), { gasLimit: 300000 });
    console.log("Static call OK");
  } catch(e) {
    console.log("Revert:", e.data || e.shortMessage);
    if (e.data) {
      const iface = new ethers.Interface([
        "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
        "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
      ]);
      try { console.log("Decoded:", iface.parseError(e.data)); } catch {}
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
