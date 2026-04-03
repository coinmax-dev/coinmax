const { ethers } = require("hardhat");
async function main() {
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
  
  console.log("Deploying NodeNFT (UUPS)...");
  const Impl = await ethers.getContractFactory("NodeNFT");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  
  const initData = Impl.interface.encodeFunctionData("initialize", []);
  const Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  const addr = await proxy.getAddress();
  
  const nft = await ethers.getContractAt("NodeNFT", addr);
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  await (await nft.grantRole(ENGINE_ROLE, ENGINE)).wait();
  
  console.log("NodeNFT:", addr);
  console.log("ENGINE_ROLE → Engine ✅");
  console.log("VITE_NODE_NFT_ADDRESS=" + addr);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
