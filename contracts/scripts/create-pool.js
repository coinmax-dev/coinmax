const { ethers } = require("hardhat");

/**
 * Create USDT/cUSD pool on PancakeSwap V3 (BSC)
 *
 * PancakeSwap V3 Factory: 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
 * NonfungiblePositionManager: 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364
 */

const FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const CUSD = "0x61e9F27dC0f8A2B3E4Bc13740E45E4dE723BaE99";
const FEE = 500; // 0.05% fee tier

// 1:1 price → sqrtPriceX96 = sqrt(1) * 2^96 = 2^96
const SQRT_PRICE_X96 = "79228162514264337593543950336"; // exactly 1:1

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const PM_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, deployer);
  const pm = new ethers.Contract(POSITION_MANAGER, PM_ABI, deployer);

  // Sort tokens (V3 requires token0 < token1)
  const [token0, token1] = USDT.toLowerCase() < CUSD.toLowerCase()
    ? [USDT, CUSD]
    : [CUSD, USDT];

  console.log("token0:", token0);
  console.log("token1:", token1);
  console.log("Fee tier:", FEE, "(0.05%)");

  // Check if pool already exists
  const existing = await factory.getPool(token0, token1, FEE);
  if (existing !== ethers.ZeroAddress) {
    console.log("\nPool already exists:", existing);
    return;
  }

  console.log("\nCreating pool with 1:1 price...");

  const tx = await pm.createAndInitializePoolIfNecessary(
    token0,
    token1,
    FEE,
    SQRT_PRICE_X96,
    { gasLimit: 5000000 }
  );

  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  // Get pool address
  const poolAddr = await factory.getPool(token0, token1, FEE);

  console.log("\n═══════════════════════════════════════");
  console.log("  Pool Created!");
  console.log("═══════════════════════════════════════");
  console.log("  Pool:    ", poolAddr);
  console.log("  Pair:     USDT / cUSD");
  console.log("  Fee:      0.05%");
  console.log("  Price:    1:1");
  console.log("═══════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
