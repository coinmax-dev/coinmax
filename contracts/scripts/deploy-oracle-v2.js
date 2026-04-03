const { ethers } = require("hardhat");
async function main() {
  const [deployer] = await ethers.getSigners();
  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  const CUSD = "0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B";
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";

  console.log("Deploying Oracle V2 (UUPS)...");
  const Impl = await ethers.getContractFactory("src/v4/MAPriceOracle.sol:MAPriceOracle");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();

  const initData = Impl.interface.encodeFunctionData("initialize", [
    MA, CUSD,
    1000000,    // basePrice = $1.00
    10,         // dailyRateBps = 0.10%
    900000,     // floorPrice = $0.90
    1500000,    // ceilPrice = $1.50 (天花板)
    50,         // maxDailyIncreaseBps = 0.50% (每日最高涨0.5%)
  ]);

  const Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  const addr = await proxy.getAddress();

  // Grant FEEDER_ROLE to Engine + Deployer
  const oracle = await ethers.getContractAt("src/v4/MAPriceOracle.sol:MAPriceOracle", addr);
  const FEEDER = ethers.keccak256(ethers.toUtf8Bytes("FEEDER_ROLE"));
  await (await oracle.grantRole(FEEDER, ENGINE)).wait();
  await (await oracle.grantRole(FEEDER, deployer.address)).wait();

  // Update VaultV4 to use new Oracle
  // (VaultV4 doesn't reference Oracle anymore, but FlashSwap does)
  const FLASH = "0x0CfDAE2C6521803Da077099dd9F44136D3e7Fb8C";
  const flash = await ethers.getContractAt("FlashSwapV4", FLASH);
  await (await flash.setOracle(addr)).wait();

  const price = await oracle.getPrice();
  console.log("\n✅ Oracle V2:", addr);
  console.log("Price:", Number(price) / 1e6, "USD");
  console.log("Floor:", 0.90, "| Ceil:", 1.50, "| DailyCap: 0.50%");
  console.log("FlashSwap oracle updated ✅");
  console.log("\nVITE_ORACLE_V4_ADDRESS=" + addr);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
