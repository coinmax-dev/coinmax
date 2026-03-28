const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
  const BATCH_BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
  const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
  const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const PANCAKE = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

  // 1. Deploy new impl (already deployed: 0x99d0)
  const NEW_IMPL = "0x99d0FF53be985247C75C3125F6C3cb886B66c734";
  console.log("Using impl:", NEW_IMPL);

  // 2. Deploy new proxy
  const ERC1967 = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const iface = new ethers.Interface([
    "function initialize(bool,address,address,address,uint24,address,address,address)"
  ]);
  const initData = iface.encodeFunctionData("initialize", [
    true, BSC_USDT, BSC_USDC, PANCAKE, 100, BATCH_BRIDGE, deployer.address, deployer.address
  ]);
  const proxy = await ERC1967.deploy(NEW_IMPL, initData);
  await proxy.waitForDeployment();
  const gwAddr = await proxy.getAddress();
  console.log("New Gateway:", gwAddr);

  // 3. Set cUsd + vault
  const gw = await ethers.getContractAt("CoinMaxGateway", gwAddr);
  let tx = await gw.setCUsd(CUSD); await tx.wait();
  console.log("  setCUsd ✓");
  tx = await gw.setVault(VAULT); await tx.wait();
  console.log("  setVault ✓");

  // 4. Grant GATEWAY_ROLE on Vault
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  tx = await vault.grantRole(GW_ROLE, gwAddr); await tx.wait();
  console.log("  Vault GATEWAY_ROLE ✓");

  // 5. Grant MINTER on CUSD
  const cusd = await ethers.getContractAt("CUSD", CUSD);
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  tx = await cusd.grantRole(MINTER, gwAddr); await tx.wait();
  console.log("  CUSD MINTER ✓");

  console.log(`\n  NEW Gateway: ${gwAddr}`);
  console.log("  Update frontend contracts.ts!");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
