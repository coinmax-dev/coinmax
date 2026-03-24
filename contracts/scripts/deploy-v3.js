const { ethers } = require("hardhat");

/**
 * CoinMax V3 Deployment Script
 *
 * Deploys the modular contract architecture on Arbitrum (vault chain):
 *   1. CUSD token
 *   2. Implementation contracts (Vault, Engine, Release, Gateway)
 *   3. CoinMaxFactory
 *   4. Factory deploys proxies: Vault + Engine + Release
 *   5. Factory deploys Gateway clone for ARB
 *   6. Post-deploy: wire roles + set configs
 *
 * Usage:
 *   npx hardhat run scripts/deploy-v3.js --network arbitrum
 *   npx hardhat run scripts/deploy-v3.js --network arbitrumSepolia
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const network = await ethers.provider.getNetwork();

  console.log("═══════════════════════════════════════════════════");
  console.log("  CoinMax V3 Deployment");
  console.log("═══════════════════════════════════════════════════");
  console.log("  Chain:    ", network.name, `(${network.chainId})`);
  console.log("  Deployer: ", deployer.address);
  console.log("  Balance:  ", ethers.formatEther(balance), "ETH");
  console.log("═══════════════════════════════════════════════════\n");

  // ─── Configuration ──────────────────────────────────────────────

  const MA_TOKEN = process.env.MA_TOKEN_ADDRESS;
  const SERVER_WALLET = process.env.SERVER_WALLET_ADDRESS;
  const MA_PRICE = Number(process.env.MA_PRICE || "100000");

  // ARB chain tokens
  const ARB_USDT = process.env.ARB_USDT;
  const ARB_USDC = process.env.ARB_USDC;
  const ARB_DEX_ROUTER = process.env.ARB_DEX_ROUTER;
  const ARB_POOL_FEE = Number(process.env.ARB_POOL_FEE || "500");
  const ARB_TREASURY = process.env.ARB_TREASURY;

  // Validate required vars
  const required = {
    MA_TOKEN, SERVER_WALLET, ARB_USDT, ARB_USDC,
    ARB_DEX_ROUTER, ARB_TREASURY
  };
  for (const [key, val] of Object.entries(required)) {
    if (!val) throw new Error(`Missing env var: ${key}`);
  }

  // ─── Step 1: Deploy cUSD Token ──────────────────────────────────

  console.log("─── Step 1: Deploy cUSD Token ───\n");
  const CUSD = await ethers.getContractFactory("CUSD");
  const cusd = await CUSD.deploy(deployer.address);
  await cusd.waitForDeployment();
  const cusdAddr = await cusd.getAddress();
  console.log("  cUSD:     ", cusdAddr);

  // ─── Step 2: Deploy Implementation Contracts ────────────────────

  console.log("\n─── Step 2: Deploy Implementations ───\n");

  const VaultImpl = await ethers.getContractFactory("CoinMaxVault");
  const vaultImpl = await VaultImpl.deploy();
  await vaultImpl.waitForDeployment();
  const vaultImplAddr = await vaultImpl.getAddress();
  console.log("  Vault impl:   ", vaultImplAddr);

  const EngineImpl = await ethers.getContractFactory("CoinMaxInterestEngine");
  const engineImpl = await EngineImpl.deploy();
  await engineImpl.waitForDeployment();
  const engineImplAddr = await engineImpl.getAddress();
  console.log("  Engine impl:  ", engineImplAddr);

  const ReleaseImpl = await ethers.getContractFactory("CoinMaxRelease");
  const releaseImpl = await ReleaseImpl.deploy();
  await releaseImpl.waitForDeployment();
  const releaseImplAddr = await releaseImpl.getAddress();
  console.log("  Release impl: ", releaseImplAddr);

  const GatewayImpl = await ethers.getContractFactory("CoinMaxGateway");
  const gatewayImpl = await GatewayImpl.deploy();
  await gatewayImpl.waitForDeployment();
  const gatewayImplAddr = await gatewayImpl.getAddress();
  console.log("  Gateway impl: ", gatewayImplAddr);

  // ─── Step 3: Deploy Factory ─────────────────────────────────────

  console.log("\n─── Step 3: Deploy Factory ───\n");
  const Factory = await ethers.getContractFactory("CoinMaxFactory");
  const factory = await Factory.deploy(SERVER_WALLET);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("  Factory:  ", factoryAddr);

  // Set implementations
  let tx = await factory.setImplementations(
    vaultImplAddr, engineImplAddr, releaseImplAddr, gatewayImplAddr
  );
  await tx.wait();
  console.log("  Implementations set.");

  // ─── Step 4: Deploy Vault Chain (Proxy Contracts) ───────────────

  console.log("\n─── Step 4: Deploy Vault Chain (Proxies) ───\n");
  tx = await factory.deployVaultChain(cusdAddr, MA_TOKEN, deployer.address, MA_PRICE);
  const receipt = await tx.wait();

  const vaultProxy = await factory.vaultProxy();
  const engineProxy = await factory.engineProxy();
  const releaseProxy = await factory.releaseProxy();

  console.log("  Vault proxy:   ", vaultProxy);
  console.log("  Engine proxy:  ", engineProxy);
  console.log("  Release proxy: ", releaseProxy);

  // ─── Step 5: Deploy ARB Gateway Clone ───────────────────────────

  console.log("\n─── Step 5: Deploy ARB Gateway Clone ───\n");
  const chainId = Number(network.chainId);
  tx = await factory.deployGatewayClone(
    chainId,
    true, // isVaultChain = true (ARB)
    ARB_USDT,
    ARB_USDC,
    ARB_DEX_ROUTER,
    ARB_POOL_FEE,
    ARB_TREASURY,
    deployer.address
  );
  await tx.wait();
  const arbGateway = await factory.gatewayClones(chainId);
  console.log("  ARB Gateway:   ", arbGateway);

  // ─── Step 6: Post-Deploy Configuration ──────────────────────────

  console.log("\n─── Step 6: Post-Deploy Config ───\n");

  // 6a. Set cUSD + vault on ARB Gateway
  const gateway = await ethers.getContractAt("CoinMaxGateway", arbGateway);
  tx = await gateway.setCUsd(cusdAddr);
  await tx.wait();
  console.log("  Gateway.cUsd set");

  tx = await gateway.setVault(vaultProxy);
  await tx.wait();
  console.log("  Gateway.vault set");

  // 6b. Grant MINTER_ROLE on cUSD to Gateway (so it can mint cUSD for deposits)
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  tx = await cusd.grantRole(MINTER_ROLE, arbGateway);
  await tx.wait();
  console.log("  cUSD MINTER_ROLE -> Gateway");

  // 6c. Grant MINTER_ROLE on cUSD to Vault (so it can burn cUSD on claim)
  // Vault burns via CUSD.burn() which needs the tokens to be in vault
  // Actually vault calls ICUSD(asset()).burn() which burns from vault's own balance
  // No special role needed since ERC20Burnable.burn() burns caller's tokens

  // ─── Summary ────────────────────────────────────────────────────

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  V3 Deployment Complete!");
  console.log("═══════════════════════════════════════════════════");
  console.log(`
  cUSD Token:      ${cusdAddr}
  Factory:         ${factoryAddr}

  Vault Proxy:     ${vaultProxy}
  Engine Proxy:    ${engineProxy}
  Release Proxy:   ${releaseProxy}
  ARB Gateway:     ${arbGateway}

  Implementations:
    Vault:         ${vaultImplAddr}
    Engine:        ${engineImplAddr}
    Release:       ${releaseImplAddr}
    Gateway:       ${gatewayImplAddr}
  `);

  console.log("  Post-deploy checklist:");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │ 1. thirdweb Dashboard: Grant MINTER on MA Token to:│");
  console.log("  │    -> Vault:  ", vaultProxy.slice(0, 22), "...  │");
  console.log("  │    -> Engine: ", engineProxy.slice(0, 22), "...  │");
  console.log("  │ 2. thirdweb Engine: Set Server Wallet =", SERVER_WALLET.slice(0, 14), "│");
  console.log("  │ 3. Deploy Gateway clones on BSC + Base (separate)  │");
  console.log("  │ 4. Update frontend .env with proxy addresses       │");
  console.log("  │ 5. Set up daily interest cron via thirdweb Engine  │");
  console.log("  └─────────────────────────────────────────────────────┘");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
