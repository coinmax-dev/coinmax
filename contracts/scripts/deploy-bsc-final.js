const { ethers } = require("hardhat");

const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BSC_PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const BSC_POOL_FEE = 100;
const MA_PRICE = 300000; // $0.30 initial price
const CHAIN_ID = 56;

const SPLITTER_WALLETS = [
  "0xd12097C9A12617c49220c032C84aCc99B6fFf57b",
  "0xDf90770C89732a7eba5B727fCd6a12f827102EE6",
  "0x1C4D983620B3c8c2f7607c0943f2A5989e655599",
  "0x85c3d07Ee3be12d6502353b4cA52B30cD85Ac5ff",
  "0x7DEa369864583E792D230D360C0a4C56c2103FE4",
];
const SPLITTER_SHARES = [3000, 800, 1200, 2000, 3000];

// Already deployed (code unchanged)
const DEPLOYED_MA   = "0xE3d19D3299B0C2D6c5FDB74dBb79b102449Edc36";
const DEPLOYED_CUSD = "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6";

async function main() {
  const [deployer] = await ethers.getSigners();
  const startBal = ethers.formatEther(await ethers.provider.getBalance(deployer.address));
  console.log("Deployer:", deployer.address, "| Balance:", startBal, "BNB\n");
  let tx;

  // ─── 1. Implementations ──────────────────────────────────
  console.log("─── 1. Implementations ───\n");

  const vaultImpl = await (await ethers.getContractFactory("CoinMaxVault")).deploy();
  await vaultImpl.waitForDeployment();
  console.log("  Vault impl:   ", await vaultImpl.getAddress());

  const engineImpl = await (await ethers.getContractFactory("CoinMaxInterestEngine")).deploy();
  await engineImpl.waitForDeployment();
  console.log("  Engine impl:  ", await engineImpl.getAddress());

  const releaseImpl = await (await ethers.getContractFactory("CoinMaxRelease")).deploy();
  await releaseImpl.waitForDeployment();
  console.log("  Release impl: ", await releaseImpl.getAddress());

  const gatewayImpl = await (await ethers.getContractFactory("CoinMaxGateway")).deploy();
  await gatewayImpl.waitForDeployment();
  console.log("  Gateway impl: ", await gatewayImpl.getAddress());

  // ─── 2. Price Oracle ──────────────────────────────────────
  console.log("\n─── 2. Price Oracle ───\n");

  const ERC1967Proxy = await ethers.getContractFactory(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
  );

  const oracleImpl = await (await ethers.getContractFactory("MAPriceOracle")).deploy();
  await oracleImpl.waitForDeployment();
  console.log("  Oracle impl:  ", await oracleImpl.getAddress());

  const oracleIface = new ethers.Interface([
    "function initialize(uint256 _initialPrice, address _admin, address _feeder)"
  ]);
  const oracleInit = oracleIface.encodeFunctionData("initialize", [
    MA_PRICE, deployer.address, SERVER_WALLET
  ]);
  const oracleProxy = await ERC1967Proxy.deploy(await oracleImpl.getAddress(), oracleInit);
  await oracleProxy.waitForDeployment();
  const oracleAddr = await oracleProxy.getAddress();
  console.log("  Oracle proxy: ", oracleAddr);

  // ─── 3. Splitter ──────────────────────────────────────────
  console.log("\n─── 3. Splitter ───\n");

  const splitter = await (await ethers.getContractFactory("CoinMaxSplitter")).deploy(BSC_USDC);
  await splitter.waitForDeployment();
  const splitterAddr = await splitter.getAddress();
  console.log("  Splitter:     ", splitterAddr);

  tx = await splitter.configure(SPLITTER_WALLETS, SPLITTER_SHARES);
  await tx.wait();
  console.log("  Configured 5 wallets.");

  // ─── 4. Proxies (Release → Vault → Engine) ────────────────
  console.log("\n─── 4. Proxies ───\n");

  // 4a. Release proxy
  const releaseIface = new ethers.Interface([
    "function initialize(address,address,address,address)"
  ]);
  const releaseInit = releaseIface.encodeFunctionData("initialize", [
    DEPLOYED_MA, deployer.address, ethers.ZeroAddress, SERVER_WALLET
  ]);
  const releaseProxy = await ERC1967Proxy.deploy(await releaseImpl.getAddress(), releaseInit);
  await releaseProxy.waitForDeployment();
  const releaseAddr = await releaseProxy.getAddress();
  console.log("  Release proxy: ", releaseAddr);

  // 4b. Vault proxy
  const vaultIface = new ethers.Interface([
    "function initialize(address,address,address,address,address,uint256)"
  ]);
  const vaultInit = vaultIface.encodeFunctionData("initialize", [
    DEPLOYED_CUSD, DEPLOYED_MA, deployer.address, ethers.ZeroAddress, ethers.ZeroAddress, MA_PRICE
  ]);
  const vaultProxy = await ERC1967Proxy.deploy(await vaultImpl.getAddress(), vaultInit);
  await vaultProxy.waitForDeployment();
  const vaultAddr = await vaultProxy.getAddress();
  console.log("  Vault proxy:   ", vaultAddr);

  // 4c. Engine proxy
  const engineIface = new ethers.Interface([
    "function initialize(address,address,address,address,address)"
  ]);
  const engineInit = engineIface.encodeFunctionData("initialize", [
    vaultAddr, DEPLOYED_MA, releaseAddr, deployer.address, SERVER_WALLET
  ]);
  const engineProxy = await ERC1967Proxy.deploy(await engineImpl.getAddress(), engineInit);
  await engineProxy.waitForDeployment();
  const engineAddr = await engineProxy.getAddress();
  console.log("  Engine proxy:  ", engineAddr);

  // 4d. Gateway (fresh deploy + initialize)
  const gateway = await (await ethers.getContractFactory("CoinMaxGateway")).deploy();
  await gateway.waitForDeployment();
  const gatewayAddr = await gateway.getAddress();

  const gw = await ethers.getContractAt("CoinMaxGateway", gatewayAddr);
  tx = await gw.initialize(
    true, BSC_USDT, BSC_USDC, BSC_PANCAKE_ROUTER, BSC_POOL_FEE,
    splitterAddr, deployer.address, SERVER_WALLET
  );
  await tx.wait();
  console.log("  Gateway:       ", gatewayAddr);

  // ─── 5. Wire Roles ────────────────────────────────────────
  console.log("\n─── 5. Roles ───\n");

  const MINTER   = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const GATEWAY  = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  const ENGINE   = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const VAULT    = ethers.keccak256(ethers.toUtf8Bytes("VAULT_ROLE"));
  const PRICE    = ethers.keccak256(ethers.toUtf8Bytes("PRICE_ROLE"));
  const ADMIN    = ethers.ZeroHash;

  const ma = await ethers.getContractAt("MAToken", DEPLOYED_MA);
  const cusd = await ethers.getContractAt("CUSD", DEPLOYED_CUSD);
  const vault = await ethers.getContractAt("CoinMaxVault", vaultAddr);
  const release = await ethers.getContractAt("CoinMaxRelease", releaseAddr);
  const engine = await ethers.getContractAt("CoinMaxInterestEngine", engineAddr);

  // MA: MINTER → Vault + Engine
  tx = await ma.grantRole(MINTER, vaultAddr); await tx.wait();
  tx = await ma.grantRole(MINTER, engineAddr); await tx.wait();
  console.log("  MA MINTER → Vault + Engine");

  // cUSD: MINTER → Gateway
  tx = await cusd.grantRole(MINTER, gatewayAddr); await tx.wait();
  console.log("  cUSD MINTER → Gateway");

  // Vault: GATEWAY → Gateway, ENGINE → Engine
  tx = await vault.grantRole(GATEWAY, gatewayAddr); await tx.wait();
  tx = await vault.grantRole(ENGINE, engineAddr); await tx.wait();
  tx = await vault.grantRole(PRICE, SERVER_WALLET); await tx.wait();
  console.log("  Vault roles set");

  // Vault: set oracle
  tx = await vault.setPriceOracle(oracleAddr); await tx.wait();
  console.log("  Vault → Oracle linked");

  // Release: VAULT → Engine
  tx = await release.grantRole(VAULT, engineAddr); await tx.wait();
  console.log("  Release VAULT → Engine");

  // Gateway: set cUSD + Vault
  tx = await gw.setCUsd(DEPLOYED_CUSD); await tx.wait();
  tx = await gw.setVault(vaultAddr); await tx.wait();
  console.log("  Gateway → cUSD + Vault");

  // ─── 6. Transfer Admin → Server Wallet ────────────────────
  console.log("\n─── 6. Admin → Server Wallet ───\n");

  // Vault
  tx = await vault.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  tx = await vault.renounceRole(ADMIN, deployer.address); await tx.wait();
  console.log("  Vault ✓");

  // Release
  tx = await release.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  tx = await release.renounceRole(ADMIN, deployer.address); await tx.wait();
  console.log("  Release ✓");

  // Engine
  tx = await engine.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  tx = await engine.renounceRole(ADMIN, deployer.address); await tx.wait();
  console.log("  Engine ✓");

  // Gateway
  tx = await gw.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  tx = await gw.renounceRole(ADMIN, deployer.address); await tx.wait();
  console.log("  Gateway ✓");

  // Oracle
  const oracle = await ethers.getContractAt("MAPriceOracle", oracleAddr);
  tx = await oracle.grantRole(ADMIN, SERVER_WALLET); await tx.wait();
  tx = await oracle.renounceRole(ADMIN, deployer.address); await tx.wait();
  console.log("  Oracle ✓");

  // Splitter
  tx = await splitter.transferOwnership(SERVER_WALLET); await tx.wait();
  console.log("  Splitter ✓");

  // ─── Done ─────────────────────────────────────────────────
  const finalBal = ethers.formatEther(await ethers.provider.getBalance(deployer.address));

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`
  MAToken:         ${DEPLOYED_MA}
  CUSD:            ${DEPLOYED_CUSD}
  Oracle proxy:    ${oracleAddr}
  Vault proxy:     ${vaultAddr}
  Engine proxy:    ${engineAddr}
  Release proxy:   ${releaseAddr}
  Gateway:         ${gatewayAddr}
  Splitter:        ${splitterAddr}

  Gas: ${(parseFloat(startBal) - parseFloat(finalBal)).toFixed(6)} BNB
  Remaining: ${finalBal} BNB
  Admin: ${SERVER_WALLET}
  `);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
