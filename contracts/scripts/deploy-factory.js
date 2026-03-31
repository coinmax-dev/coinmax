const { ethers } = require("hardhat");

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const FLASH_SALT = ethers.keccak256(ethers.toUtf8Bytes("CoinMaxFlashSwap_v3"));

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // 1. Deploy Factory
  console.log("\n═══ 1. Factory ═══");
  const Factory = await ethers.getContractFactory("CoinMaxFactory");
  const factory = await Factory.deploy(SERVER);
  await factory.waitForDeployment();
  const fAddr = await factory.getAddress();
  console.log("Factory:", fAddr);

  // 2. Deploy MA Token + cUSD directly (not proxy, constructor pattern)
  console.log("\n═══ 2. MA Token + cUSD ═══");
  const MA = await (await (await ethers.getContractFactory("MAToken")).deploy(fAddr)).waitForDeployment();
  const maAddr = await MA.getAddress();
  console.log("  MA Token:", maAddr);

  const CUSD = await (await (await ethers.getContractFactory("CUSD")).deploy(fAddr)).waitForDeployment();
  const cusdAddr = await CUSD.getAddress();
  console.log("  cUSD:", cusdAddr);

  // Register in Factory (use low-level since Factory expects proxy pattern)
  // We'll set them directly via a custom approach
  // For now, skip Factory.deployMAToken and set addresses manually

  // 3. Deploy implementations (for UUPS proxies)
  console.log("\n═══ 3. Implementations ═══");
  const impls = {};
  for (const name of ["MAPriceOracle", "CoinMaxVault", "CoinMaxRelease", "CoinMaxInterestEngine", "CoinMaxFlashSwap"]) {
    const C = await ethers.getContractFactory(name);
    const c = await C.deploy();
    await c.waitForDeployment();
    impls[name] = await c.getAddress();
    console.log(`  ${name}: ${impls[name]}`);
  }

  // 4. Deploy proxies manually (Factory's initialize signatures don't match exactly)
  console.log("\n═══ 4. Deploy Proxies ═══");

  // Oracle
  console.log("  Oracle...");
  const oracleProxy = await (await (await ethers.getContractFactory("ERC1967Proxy")).deploy(
    impls.MAPriceOracle,
    new ethers.Interface(["function initialize(uint256,address,address)"]).encodeFunctionData("initialize", [1000000, deployer.address, deployer.address])
  )).waitForDeployment();
  const oracleAddr = await oracleProxy.getAddress();
  console.log("  Oracle:", oracleAddr);

  // Vault
  console.log("  Vault...");
  const vaultProxy = await (await (await ethers.getContractFactory("ERC1967Proxy")).deploy(
    impls.CoinMaxVault,
    new ethers.Interface(["function initialize(address,address,address,address)"]).encodeFunctionData("initialize", [cusdAddr, maAddr, oracleAddr, deployer.address])
  )).waitForDeployment();
  const vaultAddr = await vaultProxy.getAddress();
  console.log("  Vault:", vaultAddr);

  // Release
  console.log("  Release...");
  const releaseProxy = await (await (await ethers.getContractFactory("ERC1967Proxy")).deploy(
    impls.CoinMaxRelease,
    new ethers.Interface(["function initialize(address,address)"]).encodeFunctionData("initialize", [maAddr, deployer.address])
  )).waitForDeployment();
  const releaseAddr = await releaseProxy.getAddress();
  console.log("  Release:", releaseAddr);

  // FlashSwap (CREATE2)
  console.log("  FlashSwap (CREATE2)...");
  const fsInit = new ethers.Interface(["function initialize(address,address,address,address,address)"]).encodeFunctionData("initialize", [maAddr, USDT, USDC, oracleAddr, deployer.address]);
  const fsCode = ethers.solidityPacked(["bytes","bytes"], [
    (await ethers.getContractFactory("ERC1967Proxy")).bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(["address","bytes"], [impls.CoinMaxFlashSwap, fsInit])
  ]);
  const fsPredicted = ethers.getCreate2Address("0x4e59b44847b379578588920cA78FbF26c0B4956C", FLASH_SALT, ethers.keccak256(fsCode));
  const fsTx = await deployer.sendTransaction({ to: "0x4e59b44847b379578588920cA78FbF26c0B4956C", data: ethers.solidityPacked(["bytes32","bytes"], [FLASH_SALT, fsCode]), gasLimit: 3000000 });
  await fsTx.wait();
  const fsAddr = fsPredicted;
  const fsHasCode = (await ethers.provider.getCode(fsAddr)).length > 2;
  console.log("  FlashSwap:", fsAddr, fsHasCode ? "✅" : "❌ no code");

  // 4. Deploy BatchBridge separately (not proxy)
  console.log("\n═══ 4. BatchBridge ═══");
  try {
    const BB = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
    const bb = await BB.deploy(USDT);
    await bb.waitForDeployment();
    const bbAddr = await bb.getAddress();
    console.log("  BatchBridge:", bbAddr);
    await (await factory.registerBatchBridge(bbAddr)).wait();
    console.log("  Registered in Factory ✅");
  } catch (e) {
    console.log("  BatchBridge:", e.message?.slice(0, 50));
  }

  // 5. Setup roles
  console.log("\n═══ 5. Setup Roles ═══");
  await (await factory.setupRoles()).wait();
  console.log("  ✅ All roles configured");

  // 6. Vault plans
  console.log("\n═══ 6. Vault Plans ═══");
  const vaultAddr = await factory.vault();
  if (vaultAddr !== ethers.ZeroAddress) {
    const vault = await ethers.getContractAt("CoinMaxVault", vaultAddr);
    const plans = [
      [5 * 86400, 50],    // 5d 0.5%
      [45 * 86400, 70],   // 45d 0.7%
      [90 * 86400, 90],   // 90d 0.9%
      [180 * 86400, 120], // 180d 1.2%
    ];
    for (const [dur, rate] of plans) {
      await (await vault.addPlan(dur, rate)).wait();
      console.log(`  Plan: ${dur/86400}d ${rate/100}%`);
    }

    // Set fundDistributor → BatchBridge
    const bbAddr = await factory.batchBridge();
    if (bbAddr !== ethers.ZeroAddress) {
      await (await vault.setFundDistributor(bbAddr)).wait();
      console.log("  Vault.fundDistributor → BatchBridge ✅");
    }
  }

  // 7. Summary
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║      DEPLOYMENT COMPLETE             ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("Factory:     ", fAddr);
  console.log("MA Token:    ", await factory.maToken());
  console.log("cUSD:        ", await factory.cusd());
  console.log("Oracle:      ", await factory.oracle());
  console.log("Vault:       ", await factory.vault());
  console.log("Release:     ", await factory.release());
  console.log("Engine:      ", await factory.engine());
  console.log("FlashSwap:   ", await factory.flashSwap());
  console.log("BatchBridge: ", await factory.batchBridge());
  console.log("Server:      ", SERVER);
  console.log("Deployer:    ", deployer.address);
  console.log("BNB left:    ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
