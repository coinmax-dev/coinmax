const { ethers } = require("hardhat");
async function main() {
  const BRIDGE = "0xe45BBF56B16bF37dA3D4c7C7fB9Cb55eDb9fbedD";
  const [d] = await ethers.getSigners();
  console.log("Deployer BNB:", ethers.formatEther(await ethers.provider.getBalance(d.address)));
  console.log("Bridge BNB before:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));

  console.log("Sending 0.005 BNB...");
  const tx = await d.sendTransaction({ to: BRIDGE, value: ethers.parseEther("0.005") });
  const r = await tx.wait();
  console.log("TX:", tx.hash, "status:", r.status);
  console.log("Bridge BNB after:", ethers.formatEther(await ethers.provider.getBalance(BRIDGE)));
}
main().catch(console.error);
