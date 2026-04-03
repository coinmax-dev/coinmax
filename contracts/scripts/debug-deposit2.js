const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);
  
  try {
    await vault.depositPublic.staticCall(ethers.parseEther("10"), "90_DAYS", { gasLimit: 1000000 });
    console.log("OK");
  } catch(e) {
    console.log("Error:", e.shortMessage);
    if (e.data) {
      console.log("Data:", e.data);
      // Try decode
      const iface = new ethers.Interface([
        "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
        "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
        "error ERC4626ExceededMaxDeposit(address receiver, uint256 assets, uint256 max)",
        "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
      ]);
      try {
        const decoded = iface.parseError(e.data);
        console.log("Decoded:", decoded.name, decoded.args.map(a => typeof a === "bigint" ? ethers.formatEther(a) : a.toString()));
      } catch { console.log("Could not decode"); }
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message?.slice(0,200)); process.exit(1); });
