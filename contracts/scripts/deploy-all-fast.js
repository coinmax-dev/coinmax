const { ethers } = require("hardhat");

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const FACTORY = "0x0a1f56a8b60c8408b38cd2895b8efd19f41a5557";

// Already deployed
const MA = "0x97D6c5955278FFcA28C696f1F21d98E74e439639";
const CUSD = "0x2b9721B3cAa0Da3ce302f5DdBC2932bAF7345b37";
const ORACLE_PROXY = "0x94dDF4f45B2a4a672aeAEF2223B08b8DFEb5f0b0";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
  console.log("MA:", MA, "| cUSD:", CUSD, "| Oracle:", ORACLE_PROXY);

  const proxy = async (implName, initSig, initArgs) => {
    console.log(`  Deploying ${implName} impl...`);
    const Impl = await ethers.getContractFactory(implName);
    const impl = await Impl.deploy({ gasLimit: 5000000 });
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log(`  Impl: ${implAddr}`);

    const iface = new ethers.Interface([initSig]);
    const initData = iface.encodeFunctionData(iface.getFunction(initSig.match(/function (\w+)/)[1]), initArgs);
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const p = await Proxy.deploy(implAddr, initData, { gasLimit: 5000000 });
    await p.waitForDeployment();
    const proxyAddr = await p.getAddress();
    console.log(`  Proxy: ${proxyAddr}`);
    return proxyAddr;
  };

  // Vault (6 params: cUsd, maToken, admin, gateway, engine, maPrice)
  console.log("\n═══ Vault ═══");
  const vault = await proxy("CoinMaxVault",
    "function initialize(address,address,address,address,address,uint256)",
    [CUSD, MA, deployer.address, deployer.address, deployer.address, 1000000]
  );

  // Release
  console.log("\n═══ Release ═══");
  const release = await proxy("CoinMaxRelease",
    "function initialize(address,address)",
    [MA, deployer.address]
  );

  // FlashSwap
  console.log("\n═══ FlashSwap ═══");
  const flashSwap = await proxy("CoinMaxFlashSwap",
    "function initialize(address,address,address,address,address)",
    [MA, USDT, USDC, ORACLE_PROXY, deployer.address]
  );

  // BatchBridge
  console.log("\n═══ BatchBridge ═══");
  const BB = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
  const bb = await BB.deploy(USDT);
  await bb.waitForDeployment();
  const bbAddr = await bb.getAddress();
  console.log("  BatchBridge:", bbAddr);

  // Register in Factory
  console.log("\n═══ Factory Register ═══");
  const factory = await ethers.getContractAt("CoinMaxFactory", FACTORY);
  await (await factory.registerBatchBridge(bbAddr)).wait();
  console.log("  BatchBridge registered ✅");

  // Vault config
  console.log("\n═══ Vault Config ═══");
  const v = await ethers.getContractAt("CoinMaxVault", vault);
  for (const [days, rate] of [[5,50],[45,70],[90,90],[180,120]]) {
    await (await v.addPlan(days * 86400, rate)).wait();
    console.log(`  Plan: ${days}d ${rate/100}%`);
  }
  await (await v.setFundDistributor(bbAddr)).wait();
  console.log("  fundDistributor → BatchBridge ✅");

  // Roles
  console.log("\n═══ Roles ═══");
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ENGINE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const maC = await ethers.getContractAt("MAToken", MA);
  const cusdC = await ethers.getContractAt("CUSD", CUSD);

  // Vault → MA + cUSD MINTER
  await (await maC.grantRole(MINTER, vault)).wait();
  await (await cusdC.grantRole(MINTER, vault)).wait();
  console.log("  Vault MINTER ✅");

  // Server → MA MINTER + Release ADMIN + Vault ENGINE
  await (await maC.grantRole(MINTER, SERVER)).wait();
  const releaseC = await ethers.getContractAt("CoinMaxRelease", release);
  await (await releaseC.grantRole(ADMIN, SERVER)).wait();
  await (await v.grantRole(ENGINE, SERVER)).wait();
  console.log("  Server roles ✅");

  // Deployer → MA MINTER
  await (await maC.grantRole(MINTER, deployer.address)).wait();
  console.log("  Deployer MINTER ✅");

  // Summary
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         ALL CONTRACTS DEPLOYED           ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Factory:      ", FACTORY);
  console.log("MA Token:     ", MA);
  console.log("cUSD:         ", CUSD);
  console.log("Oracle:       ", ORACLE_PROXY);
  console.log("Vault:        ", vault);
  console.log("Release:      ", release);
  console.log("FlashSwap:    ", flashSwap);
  console.log("BatchBridge:  ", bbAddr);
  console.log("Server:       ", SERVER);
  console.log("Deployer:     ", deployer.address);
  console.log("BNB left:     ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
