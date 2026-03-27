/**
 * Redeploy CoinMaxVault with UUPS + earlyClaimPrincipal
 *
 * 1. Deploy new implementation
 * 2. Deploy new ERC1967Proxy
 * 3. Initialize with same config as old vault
 * 4. Grant roles (Gateway, Engine, Server Wallet)
 * 5. Update Gateway to point to new Vault
 *
 * Usage: npx hardhat run scripts/redeploy-vault.js --network bsc
 */

const { ethers } = require("hardhat");

const THIRDWEB_SECRET = "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";

// Old addresses
const OLD_VAULT = "0xC3E05890dB946B311b00AB64cA255FdcC3643F0a";
const CUSD = "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6";
const MA_TOKEN = "0xE3d19D3299B0C2D6c5FDB74dBb79b102449Edc36";
const ORACLE = "0x3EC635802091b9F95b2891f3fd2504499f710145";
const ENGINE = "0x696a19562B30aD4F0f85C93f2369F044757849aB";
const GATEWAY = "0x62ac5FabC1a3bFd26B423F42FFb0934D4D3721eb";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  // 1. Deploy new implementation
  console.log("1. Deploying new Vault implementation (UUPS + earlyClaimPrincipal)...");
  const VaultFactory = await ethers.getContractFactory("CoinMaxVault");
  const impl = await VaultFactory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   Implementation:", implAddr);

  // 2. Prepare initialize calldata
  // initialize(address _cUsd, address _maToken, address _admin, address _gateway, address _engine, uint256 _maPrice)
  const initData = VaultFactory.interface.encodeFunctionData("initialize", [
    CUSD,              // _cUsd
    MA_TOKEN,          // _maToken
    deployer.address,  // _admin
    GATEWAY,           // _gateway
    ENGINE,            // _engine
    530000,            // _maPrice ($0.53, 6 decimals)
  ]);

  // 3. Deploy proxy
  console.log("\n2. Deploying ERC1967Proxy...");
  const ProxyFactory = await ethers.getContractFactory("ERC1967Proxy");
  const proxy = await ProxyFactory.deploy(implAddr, initData);
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  console.log("   New Vault Proxy:", proxyAddr);

  // 4. Setup roles
  console.log("\n3. Setting up roles...");
  const vault = await ethers.getContractAt("CoinMaxVault", proxyAddr);

  const ADMIN = await vault.DEFAULT_ADMIN_ROLE();
  const GATEWAY_ROLE = await vault.GATEWAY_ROLE();
  const ENGINE_ROLE = await vault.ENGINE_ROLE();
  const PRICE_ROLE = await vault.PRICE_ROLE();

  // Grant roles
  let tx;
  tx = await vault.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  console.log("   Admin → Server Wallet ✓");

  tx = await vault.grantRole(GATEWAY_ROLE, GATEWAY); await tx.wait();
  console.log("   Gateway Role ✓");

  tx = await vault.grantRole(ENGINE_ROLE, ENGINE); await tx.wait();
  console.log("   Engine Role ✓");

  tx = await vault.grantRole(PRICE_ROLE, SERVER_WALLET); await tx.wait();
  console.log("   Price Role ✓");

  // 5. Add stake plans (same as original: 5d, 45d, 90d, 180d, 360d)
  console.log("\n4. Adding stake plans...");
  const plans = [
    { days: 5, rate: 50 },    // 0.5%/day
    { days: 45, rate: 70 },   // 0.7%/day
    { days: 90, rate: 90 },   // 0.9%/day
    { days: 180, rate: 120 }, // 1.2%/day
    { days: 360, rate: 150 }, // 1.5%/day
  ];
  for (const p of plans) {
    tx = await vault.addPlan(p.days * 86400, p.rate);
    await tx.wait();
    console.log(`   Plan: ${p.days}d @ ${p.rate/100}%/day ✓`);
  }

  // 6. Test earlyClaimPrincipal exists
  console.log("\n5. Testing earlyClaimPrincipal...");
  try {
    await vault.earlyClaimPrincipal.staticCall(999);
  } catch (e) {
    if (e.message.includes("Invalid index")) {
      console.log("   earlyClaimPrincipal EXISTS ✓");
    } else {
      console.log("   Test:", e.message.slice(0, 80));
    }
  }

  // 7. Test upgradeability
  console.log("\n6. Testing UUPS upgradeability...");
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const storage = await ethers.provider.getStorage(proxyAddr, implSlot);
  console.log("   Implementation slot:", "0x" + storage.slice(26));

  console.log("\n═══════════════════════════════════════");
  console.log("  NEW VAULT DEPLOYED");
  console.log("═══════════════════════════════════════");
  console.log("  Proxy:          ", proxyAddr);
  console.log("  Implementation: ", implAddr);
  console.log("  Old Vault:      ", OLD_VAULT);
  console.log("═══════════════════════════════════════");
  console.log("\nNEXT STEPS:");
  console.log("  1. Update Gateway to point to new Vault (setVault)");
  console.log("  2. Update VITE_VAULT_V3_ADDRESS in .env");
  console.log("  3. Grant cUSD MINTER_ROLE to new Vault");
  console.log("  4. Grant MA mintTo access to new Vault");
}

main().catch(e => { console.error(e); process.exit(1); });
