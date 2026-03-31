const { ethers } = require("hardhat");

const SERVER = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const MA = "0x97D6c5955278FFcA28C696f1F21d98E74e439639";
const CUSD = "0x2b9721B3cAa0Da3ce302f5DdBC2932bAF7345b37";
const ORACLE = "0x94dDF4f45B2a4a672aeAEF2223B08b8DFEb5f0b0";
const VAULT = "0x2Ab40E3Dc72a70d88d7c39B346d76D6146e228E3";
const RELEASE = "0xcC89cCa874898cf43daBc04C3B27DD5837c4Fa23";
const FLASH = "0xA385DcbF7469961857B83709b8b6E0F160c2E76A";
const BB = "0xeB6bb96CB0C2d203257D1e62105d3e5350aEA535";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // Vault plans
  console.log("\n═══ Vault Plans ═══");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const pc = await vault.getPlansCount();
  if (Number(pc) === 0) {
    for (const [d, r] of [[5,50],[45,70],[90,90],[180,120]]) {
      await (await vault.addPlan(d * 86400, r)).wait();
      console.log("  " + d + "d " + r/100 + "%");
    }
  } else console.log("  Plans:", Number(pc));

  // fundDistributor
  await (await vault.setFundDistributor(BB)).wait();
  console.log("  fundDistributor → BB ✅");

  // Roles
  console.log("\n═══ Roles ═══");
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ENGINE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const ADMIN = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const maC = await ethers.getContractAt("MAToken", MA);
  const cusdC = await ethers.getContractAt("CUSD", CUSD);
  const relC = await ethers.getContractAt("CoinMaxRelease", RELEASE);

  const grant = async (c, role, addr, label) => {
    if (!(await c.hasRole(role, addr))) { await (await c.grantRole(role, addr)).wait(); console.log("  " + label + " ✅"); }
    else console.log("  " + label + " (already)");
  };

  await grant(maC, MINTER, VAULT, "Vault → MA MINTER");
  await grant(cusdC, MINTER, VAULT, "Vault → cUSD MINTER");
  await grant(maC, MINTER, SERVER, "Server → MA MINTER");
  await grant(relC, ADMIN, SERVER, "Server → Release ADMIN");
  await grant(vault, ENGINE, SERVER, "Server → Vault ENGINE");
  await grant(maC, MINTER, deployer.address, "Deployer → MA MINTER");

  // Verify
  console.log("\n═══ Verify ═══");
  console.log("Vault paused:", await vault.paused());
  console.log("Vault plans:", Number(await vault.getPlansCount()));
  console.log("Vault fundDist:", await vault.fundDistributor());
  console.log("Oracle price:", Number(await (await ethers.getContractAt("MAPriceOracle", ORACLE)).getPriceUnsafe()) / 1e6);
  console.log("FlashSwap paused:", await (await ethers.getContractAt("CoinMaxFlashSwap", FLASH)).paused());
  console.log("Release paused:", await relC.paused());

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║         CONFIGURATION COMPLETE           ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("Factory:      0x0a1f56a8b60c8408b38cd2895b8efd19f41a5557");
  console.log("MA Token:     " + MA);
  console.log("cUSD:         " + CUSD);
  console.log("Oracle:       " + ORACLE);
  console.log("Vault:        " + VAULT);
  console.log("Release:      " + RELEASE);
  console.log("FlashSwap:    " + FLASH);
  console.log("BatchBridge:  " + BB);
  console.log("BNB left:     " + ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
