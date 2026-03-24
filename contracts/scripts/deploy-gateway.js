const { ethers } = require("hardhat");

/**
 * Deploy CoinMax Gateway Clone on source chains (BSC / Base)
 *
 * Pre-requisites:
 *   - V3 core already deployed on ARB (run deploy-v3.js first)
 *   - Factory address from ARB deployment
 *
 * Usage:
 *   npx hardhat run scripts/deploy-gateway.js --network bsc
 *   npx hardhat run scripts/deploy-gateway.js --network base
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("═══════════════════════════════════════════════════");
  console.log(`  Deploy Gateway Clone — ${network.name} (${chainId})`);
  console.log("  Deployer:", deployer.address);
  console.log("═══════════════════════════════════════════════════\n");

  // Chain-specific config
  let USDT, USDC, DEX_ROUTER, POOL_FEE, TREASURY;

  if (chainId === 56 || chainId === 97) {
    // BSC / BSC Testnet
    USDT = process.env.BSC_USDT;
    USDC = process.env.BSC_USDC;
    DEX_ROUTER = process.env.BSC_DEX_ROUTER;
    POOL_FEE = Number(process.env.BSC_POOL_FEE || "100");
    TREASURY = process.env.BSC_TREASURY;
  } else if (chainId === 8453 || chainId === 84532) {
    // Base / Base Sepolia
    USDT = process.env.BASE_USDT;
    USDC = process.env.BASE_USDC;
    DEX_ROUTER = process.env.BASE_DEX_ROUTER;
    POOL_FEE = Number(process.env.BASE_POOL_FEE || "100");
    TREASURY = process.env.BASE_TREASURY;
  } else {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const SERVER_WALLET = process.env.SERVER_WALLET_ADDRESS;

  for (const [k, v] of Object.entries({ USDT, USDC, DEX_ROUTER, TREASURY, SERVER_WALLET })) {
    if (!v) throw new Error(`Missing: ${k}`);
  }

  // Deploy Gateway implementation
  const GatewayImpl = await ethers.getContractFactory("CoinMaxGateway");
  const impl = await GatewayImpl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("Gateway impl:", implAddr);

  // Deploy clone via OZ Clones (manual since Factory is on ARB)
  const { Clones } = require("@openzeppelin/contracts/proxy/Clones");

  // Actually, we can just deploy and initialize directly
  // since Factory is only on ARB
  const clone = await GatewayImpl.deploy();
  await clone.waitForDeployment();
  const cloneAddr = await clone.getAddress();

  // Initialize as source chain gateway (isVaultChain = false)
  const gateway = await ethers.getContractAt("CoinMaxGateway", cloneAddr);
  const tx = await gateway.initialize(
    false,  // isVaultChain = false (source chain)
    USDT,
    USDC,
    DEX_ROUTER,
    POOL_FEE,
    TREASURY,
    deployer.address,
    SERVER_WALLET
  );
  await tx.wait();

  console.log(`\n  Gateway deployed: ${cloneAddr}`);
  console.log(`  Chain: ${network.name} (${chainId})`);
  console.log(`  Treasury: ${TREASURY}`);
  console.log(`\n  Next steps:`);
  console.log(`  1. Set bridge adapter: gateway.setBridgeAdapter(<bridge>)`);
  console.log(`  2. Set vault chain ID: gateway.setVaultChainId(42161)`);
  console.log(`  3. On ARB Gateway: setTrustedRemote(bytes32(${cloneAddr}), true)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
