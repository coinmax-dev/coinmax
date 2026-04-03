const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  const RELEASE = "0x1de32fF0aa9884536C8ba7Aa7fD1f6Ea6cf523Bc";
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const CUSD = "0x512d6d3C33D4a018e35a7d4c89754e0e3E72fD4B";

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));

  // ── 1. Deploy MAStaking (UUPS Proxy) ──
  console.log("\n[1] Deploying MAStaking...");
  const Impl = await ethers.getContractFactory("MAStaking");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  console.log("  impl:", await impl.getAddress());

  const initData = Impl.interface.encodeFunctionData("initialize", [MA, RELEASE]);
  const Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(await impl.getAddress(), initData);
  await proxy.waitForDeployment();
  const stakingAddr = await proxy.getAddress();
  console.log("  proxy:", stakingAddr);

  // ── 2. Configure roles ──
  console.log("\n[2] Configuring roles...");

  // MAStaking: ENGINE_ROLE → Engine
  const staking = await ethers.getContractAt("MAStaking", stakingAddr);
  await (await staking.grantRole(ENGINE_ROLE, ENGINE)).wait();
  console.log("  MAStaking ENGINE_ROLE → Engine ✅");

  // MA Token: MINTER_ROLE → MAStaking (so it can mint MA on lock)
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA);
  await (await ma.grantRole(MINTER_ROLE, stakingAddr)).wait();
  console.log("  MA MINTER_ROLE → MAStaking ✅");

  // ── 3. Upgrade VaultV4 (new version without MA) ──
  console.log("\n[3] Upgrading VaultV4...");
  const VaultImpl = await ethers.getContractFactory("CoinMaxVaultV4");
  const vaultImpl = await VaultImpl.deploy();
  await vaultImpl.waitForDeployment();
  console.log("  new impl:", await vaultImpl.getAddress());

  // Note: initialize signature changed (only _cusd now)
  // But UUPS upgrade preserves storage, so we just upgradeToAndCall with empty data
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);
  await (await vault.upgradeToAndCall(await vaultImpl.getAddress(), "0x")).wait();
  console.log("  VaultV4 upgraded ✅");

  // ── 4. Grant CUSD MINTER to Engine (for addInterest) ──
  const cusd = await ethers.getContractAt("src/v4/CUSD.sol:CUSD", CUSD);
  const hasEngineMinter = await cusd.hasRole(MINTER_ROLE, ENGINE);
  if (!hasEngineMinter) {
    await (await cusd.grantRole(MINTER_ROLE, ENGINE)).wait();
    console.log("  CUSD MINTER_ROLE → Engine ✅");
  }

  // Grant ENGINE_ROLE on Vault to Engine (might need re-grant after upgrade)
  const hasEngineVault = await vault.hasRole(ENGINE_ROLE, ENGINE);
  if (!hasEngineVault) {
    await (await vault.grantRole(ENGINE_ROLE, ENGINE)).wait();
    console.log("  Vault ENGINE_ROLE → Engine ✅ (re-granted)");
  }

  // ── Summary ──
  console.log("\n════════════════════════════════════════");
  console.log("  Deployment Complete");
  console.log("════════════════════════════════════════");
  console.log("MAStaking:", stakingAddr, "(UUPS proxy)");
  console.log("VaultV4:  ", VAULT, "(upgraded)");
  console.log("");
  console.log("Update .env:");
  console.log(`  VITE_MA_STAKING_ADDRESS=${stakingAddr}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
