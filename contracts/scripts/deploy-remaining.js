const { ethers } = require("hardhat");

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const FACTORY = "0x0a1f56a8b60c8408b38cd2895b8efd19f41a5557";
const MA = "0x97D6c5955278FFcA28C696f1F21d98E74e439639";
const CUSD = "0x2b9721B3cAa0Da3ce302f5DdBC2932bAF7345b37";
const ORACLE = "0x94dDF4f45B2a4a672aeAEF2223B08b8DFEb5f0b0";
const VAULT = "0x2Ab40E3Dc72a70d88d7c39B346d76D6146e228E3";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("BNB:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  const proxyDeploy = async (name, initSig, initArgs) => {
    console.log(`  ${name} impl...`);
    const Impl = await ethers.getContractFactory(name);
    const impl = await Impl.deploy({ gasLimit: 5000000 });
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();

    const iface = new ethers.Interface([initSig]);
    const fn = initSig.match(/function (\w+)/)[1];
    const data = iface.encodeFunctionData(fn, initArgs);
    const Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const p = await Proxy.deploy(implAddr, data, { gasLimit: 5000000 });
    await p.waitForDeployment();
    const addr = await p.getAddress();
    console.log(`  ${name}: ${addr}`);
    return addr;
  };

  // Release (4 params: maToken, admin, engine, serverWallet)
  console.log("\n═══ Release ═══");
  const release = await proxyDeploy("CoinMaxRelease",
    "function initialize(address,address,address,address)",
    [MA, deployer.address, deployer.address, SERVER]
  );

  // FlashSwap (5 params: maToken, usdt, usdc, oracle, admin)
  console.log("\n═══ FlashSwap ═══");
  const flashSwap = await proxyDeploy("CoinMaxFlashSwap",
    "function initialize(address,address,address,address,address)",
    [MA, USDT, USDC, ORACLE, deployer.address]
  );

  // BatchBridge
  console.log("\n═══ BatchBridge ═══");
  const BB = await ethers.getContractFactory("CoinMaxBatchBridgeV2");
  const bb = await BB.deploy(USDT);
  await bb.waitForDeployment();
  const bbAddr = await bb.getAddress();
  console.log("  BatchBridge:", bbAddr);

  // Factory register
  console.log("\n═══ Factory ═══");
  const factory = await ethers.getContractAt("CoinMaxFactory", FACTORY);
  await (await factory.registerBatchBridge(bbAddr)).wait();
  console.log("  BatchBridge registered ✅");

  // Vault config
  console.log("\n═══ Vault Config ═══");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const planCount = await vault.getPlansCount();
  if (Number(planCount) === 0) {
    for (const [d, r] of [[5,50],[45,70],[90,90],[180,120]]) {
      await (await vault.addPlan(d * 86400, r)).wait();
      console.log(`  Plan: ${d}d ${r/100}%`);
    }
  } else {
    console.log("  Plans already exist:", Number(planCount));
  }
  await (await vault.setFundDistributor(bbAddr)).wait();
  console.log("  fundDistributor → BatchBridge ✅");

  // Roles
  console.log("\n═══ Roles ═══");
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ENGINE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const maC = await ethers.getContractAt("MAToken", MA);
  const cusdC = await ethers.getContractAt("CUSD", CUSD);
  const relC = await ethers.getContractAt("CoinMaxRelease", release);

  // Vault → MA + cUSD
  if (!(await maC.hasRole(MINTER, VAULT))) { await (await maC.grantRole(MINTER, VAULT)).wait(); console.log("  Vault → MA MINTER ✅"); }
  if (!(await cusdC.hasRole(MINTER, VAULT))) { await (await cusdC.grantRole(MINTER, VAULT)).wait(); console.log("  Vault → cUSD MINTER ✅"); }

  // Server
  if (!(await maC.hasRole(MINTER, SERVER))) { await (await maC.grantRole(MINTER, SERVER)).wait(); console.log("  Server → MA MINTER ✅"); }
  await (await relC.grantRole(ADMIN, SERVER)).wait(); console.log("  Server → Release ADMIN ✅");
  if (!(await vault.hasRole(ENGINE, SERVER))) { await (await vault.grantRole(ENGINE, SERVER)).wait(); console.log("  Server → Vault ENGINE ✅"); }

  // Deployer
  if (!(await maC.hasRole(MINTER, deployer.address))) { await (await maC.grantRole(MINTER, deployer.address)).wait(); console.log("  Deployer → MA MINTER ✅"); }

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         ALL CONTRACTS DEPLOYED           ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Factory:      ", FACTORY);
  console.log("MA Token:     ", MA);
  console.log("cUSD:         ", CUSD);
  console.log("Oracle:       ", ORACLE);
  console.log("Vault:        ", VAULT);
  console.log("Release:      ", release);
  console.log("FlashSwap:    ", flashSwap);
  console.log("BatchBridge:  ", bbAddr);
  console.log("BNB left:     ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
