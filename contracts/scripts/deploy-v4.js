const { ethers } = require("hardhat");

/**
 * Deploy V4 Full Suite to BSC Mainnet
 *
 * Order:
 *   1. CUSD (no deps)
 *   2. MAToken (no deps)
 *   3. MAPriceOracle (needs CUSD + MA)
 *   4. ReleaseV4 (needs MA)
 *   5. FlashSwapV4 (needs MA + Oracle + USDT)
 *   6. VaultV4 proxy (needs CUSD + USDC + MA + Oracle + Receiver + Release)
 *   7. Configure roles
 *
 * Wallets:
 *   Deployer:      0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1
 *   Engine:        0xDd6660E403d0242c1BeE52a4de50484AAF004446
 *   USDC Receiver: 0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff
 *
 * Run: cd contracts && npx hardhat run scripts/deploy-v4.js --network bsc
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
  const USDC_RECEIVER = "0xe193ACcf11aBf508e8c7D0CeE03ea4E6f75B09ff";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";

  // Oracle config
  const BASE_PRICE = 100000;    // $0.10 in 6 decimals
  const DAILY_RATE_BPS = 10;    // 0.10% daily appreciation
  const FLOOR_PRICE = 50000;    // $0.05 floor

  console.log("\n════════════════════════════════════════");
  console.log("  Deploying V4 Contracts");
  console.log("════════════════════════════════════════\n");

  // ── 1. CUSD ──
  console.log("[1/6] Deploying CUSD...");
  const CUSD = await ethers.getContractFactory("src/v4/CUSD.sol:CUSD");
  const cusd = await CUSD.deploy();
  await cusd.waitForDeployment();
  const cusdAddr = await cusd.getAddress();
  console.log("  CUSD:", cusdAddr);

  // ── 2. MAToken ──
  console.log("[2/6] Deploying MAToken...");
  const MA = await ethers.getContractFactory("src/v4/MAToken.sol:MAToken");
  const ma = await MA.deploy();
  await ma.waitForDeployment();
  const maAddr = await ma.getAddress();
  console.log("  MAToken:", maAddr);

  // ── 3. MAPriceOracle ──
  console.log("[3/6] Deploying MAPriceOracle...");
  const Oracle = await ethers.getContractFactory("src/v4/MAPriceOracle.sol:MAPriceOracle");
  const oracle = await Oracle.deploy(maAddr, cusdAddr, BASE_PRICE, DAILY_RATE_BPS, FLOOR_PRICE);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("  Oracle:", oracleAddr);

  // ── 4. ReleaseV4 ──
  console.log("[4/6] Deploying ReleaseV4...");
  const Release = await ethers.getContractFactory("ReleaseV4");
  const release = await Release.deploy(maAddr);
  await release.waitForDeployment();
  const releaseAddr = await release.getAddress();
  console.log("  Release:", releaseAddr);

  // ── 5. FlashSwapV4 ──
  console.log("[5/6] Deploying FlashSwapV4...");
  const Flash = await ethers.getContractFactory("FlashSwapV4");
  const flash = await Flash.deploy(maAddr, oracleAddr, USDT, deployer.address);
  await flash.waitForDeployment();
  const flashAddr = await flash.getAddress();
  console.log("  FlashSwap:", flashAddr);

  // ── 6. VaultV4 (UUPS Proxy) ──
  console.log("[6/6] Deploying VaultV4 (impl + proxy)...");
  const VaultImpl = await ethers.getContractFactory("CoinMaxVaultV4");
  const vaultImpl = await VaultImpl.deploy();
  await vaultImpl.waitForDeployment();
  const vaultImplAddr = await vaultImpl.getAddress();
  console.log("  Vault impl:", vaultImplAddr);

  // Deploy ERC1967 Proxy
  const initData = VaultImpl.interface.encodeFunctionData("initialize", [
    cusdAddr,       // _cusd
    USDC,           // _usdc
    maAddr,         // _maToken
    oracleAddr,     // _oracle
    USDC_RECEIVER,  // _usdcReceiver
    releaseAddr,    // _maReceiver
  ]);
  const Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const proxy = await Proxy.deploy(vaultImplAddr, initData);
  await proxy.waitForDeployment();
  const vaultAddr = await proxy.getAddress();
  console.log("  Vault proxy:", vaultAddr);

  // ── 7. Configure Roles ──
  console.log("\n[7] Configuring roles...");
  const vault = await ethers.getContractAt("CoinMaxVaultV4", vaultAddr);

  // CUSD: MINTER_ROLE → Vault
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await (await cusd.grantRole(MINTER_ROLE, vaultAddr)).wait();
  console.log("  CUSD MINTER_ROLE → Vault ✅");

  // MAToken: MINTER_ROLE → Vault (for settleYield)
  await (await ma.grantRole(MINTER_ROLE, vaultAddr)).wait();
  console.log("  MA MINTER_ROLE → Vault ✅");

  // MAToken: MINTER_ROLE → FlashSwap (for burnFrom)
  await (await ma.grantRole(MINTER_ROLE, flashAddr)).wait();
  console.log("  MA MINTER_ROLE → FlashSwap ✅");

  // MAToken: MINTER_ROLE → Release (for burn on destroy)
  await (await ma.grantRole(MINTER_ROLE, releaseAddr)).wait();
  console.log("  MA MINTER_ROLE → Release ✅");

  // Vault: ENGINE_ROLE → Engine wallet
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  await (await vault.grantRole(ENGINE_ROLE, ENGINE)).wait();
  console.log("  Vault ENGINE_ROLE → Engine ✅");

  // Release: ENGINE_ROLE → Engine wallet + Vault
  await (await release.grantRole(ENGINE_ROLE, ENGINE)).wait();
  await (await release.grantRole(ENGINE_ROLE, vaultAddr)).wait();
  console.log("  Release ENGINE_ROLE → Engine + Vault ✅");

  // Oracle: FEEDER_ROLE → Engine + Deployer
  const FEEDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FEEDER_ROLE"));
  await (await oracle.grantRole(FEEDER_ROLE, ENGINE)).wait();
  await (await oracle.grantRole(FEEDER_ROLE, deployer.address)).wait();
  console.log("  Oracle FEEDER_ROLE → Engine + Deployer ✅");

  // ── Summary ──
  console.log("\n════════════════════════════════════════");
  console.log("  V4 Deployment Complete");
  console.log("════════════════════════════════════════");
  console.log("");
  console.log("Contracts:");
  console.log("  CUSD:        ", cusdAddr);
  console.log("  MAToken:     ", maAddr);
  console.log("  Oracle:      ", oracleAddr);
  console.log("  VaultV4:     ", vaultAddr, "(proxy)");
  console.log("  VaultV4 impl:", vaultImplAddr);
  console.log("  ReleaseV4:   ", releaseAddr);
  console.log("  FlashSwapV4: ", flashAddr);
  console.log("");
  console.log("Wallets:");
  console.log("  Deployer:      ", deployer.address);
  console.log("  Engine:        ", ENGINE);
  console.log("  USDC Receiver: ", USDC_RECEIVER);
  console.log("");
  console.log("Roles:");
  console.log("  CUSD MINTER   → Vault");
  console.log("  MA MINTER     → Vault, FlashSwap, Release");
  console.log("  ENGINE        → Vault(Engine), Release(Engine+Vault)");
  console.log("  FEEDER        → Oracle(Engine+Deployer)");
  console.log("");
  console.log("Update .env:");
  console.log(`  VITE_CUSD_V4_ADDRESS=${cusdAddr}`);
  console.log(`  VITE_MA_TOKEN_V4_ADDRESS=${maAddr}`);
  console.log(`  VITE_ORACLE_V4_ADDRESS=${oracleAddr}`);
  console.log(`  VITE_VAULT_V4_ADDRESS=${vaultAddr}`);
  console.log(`  VITE_RELEASE_V4_ADDRESS=${releaseAddr}`);
  console.log(`  VITE_FLASH_SWAP_V4_ADDRESS=${flashAddr}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
