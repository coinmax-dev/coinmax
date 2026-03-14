const { ethers } = require("hardhat");

/**
 * Diagnose why SwapRouter transactions are failing
 */

const SWAP_ROUTER = "0xF179A34CCE54F6337A337eaE2Bc4e3c5fBf51135";
const NODES_V2 = "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";
const FUND_MANAGER = "0xbab0f5ab980870789f88807f2987ca569b875616";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

const ROUTER_ABI = [
  "function pancakeRouter() view returns (address)",
  "function pancakePool() view returns (address)",
  "function usdt() view returns (address)",
  "function usdc() view returns (address)",
  "function poolFee() view returns (uint24)",
  "function nodesV2() view returns (address)",
  "function vaultV2() view returns (address)",
  "function maxSlippageBps() view returns (uint256)",
  "function maxPriceDeviationBps() view returns (uint256)",
  "function maxSwapAmount() view returns (uint256)",
  "function twapWindow() view returns (uint32)",
  "function maxTwapDeviationBps() view returns (uint256)",
  "function cooldownPeriod() view returns (uint256)",
  "function twapCheckEnabled() view returns (bool)",
  "function isToken0Usdt() view returns (bool)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function getSpotPrice() view returns (uint256)",
  "function getTwapPrice() view returns (uint256)",
  "function isPriceSafe() view returns (bool safe, uint256 spotPrice, uint256 twapPrice)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
];

const NODES_ABI = [
  "function fundDistributor() view returns (address)",
  "function swapRouter() view returns (address)",
  "function usdc() view returns (address)",
  "function purchaseCount() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function nodePlans(string) view returns (uint256 price, bool active)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Diagnosing with:", deployer.address);
  console.log("");

  // ── SwapRouter ──
  console.log("═══ SwapRouter ═══");
  const router = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, deployer);

  const [
    pancakeRouter, pancakePool, usdt, usdc, poolFee,
    nodesV2, vaultV2, maxSlippageBps, maxPriceDeviationBps,
    maxSwapAmount, twapWindow, maxTwapDeviationBps,
    cooldownPeriod, twapCheckEnabled, isToken0Usdt,
    owner, paused,
  ] = await Promise.all([
    router.pancakeRouter(), router.pancakePool(),
    router.usdt(), router.usdc(), router.poolFee(),
    router.nodesV2(), router.vaultV2(),
    router.maxSlippageBps(), router.maxPriceDeviationBps(),
    router.maxSwapAmount(), router.twapWindow(),
    router.maxTwapDeviationBps(), router.cooldownPeriod(),
    router.twapCheckEnabled(), router.isToken0Usdt(),
    router.owner(), router.paused(),
  ]);

  console.log("  Owner:", owner);
  console.log("  Paused:", paused);
  console.log("  PancakeRouter:", pancakeRouter);
  console.log("  PancakePool:", pancakePool);
  console.log("  USDT:", usdt);
  console.log("  USDC:", usdc);
  console.log("  Pool Fee:", poolFee.toString());
  console.log("  NodesV2:", nodesV2);
  console.log("  VaultV2:", vaultV2);
  console.log("  maxSlippageBps:", maxSlippageBps.toString());
  console.log("  maxPriceDeviationBps:", maxPriceDeviationBps.toString());
  console.log("  maxSwapAmount:", ethers.formatEther(maxSwapAmount), "USDT");
  console.log("  twapWindow:", twapWindow.toString(), "s");
  console.log("  maxTwapDeviationBps:", maxTwapDeviationBps.toString());
  console.log("  cooldownPeriod:", cooldownPeriod.toString(), "s");
  console.log("  twapCheckEnabled:", twapCheckEnabled);
  console.log("  isToken0Usdt:", isToken0Usdt);
  console.log("");

  // ── Pool State ──
  console.log("═══ Pool State ═══");
  const pool = new ethers.Contract(pancakePool, POOL_ABI, deployer);
  try {
    const [sqrtPriceX96, tick, obsIndex, obsCard, obsCardNext, feeProt, unlocked] = await pool.slot0();
    const token0 = await pool.token0();
    const token1 = await pool.token1();
    let liquidity;
    try { liquidity = await pool.liquidity(); } catch { liquidity = "N/A"; }

    console.log("  token0:", token0);
    console.log("  token1:", token1);
    console.log("  sqrtPriceX96:", sqrtPriceX96.toString());
    console.log("  tick:", tick.toString());
    console.log("  observationCardinality:", obsCard.toString());
    console.log("  observationCardinalityNext:", obsCardNext.toString());
    console.log("  unlocked:", unlocked);
    console.log("  liquidity:", liquidity.toString());
  } catch (err) {
    console.log("  ERROR reading pool:", err.message);
  }
  console.log("");

  // ── Price Checks ──
  console.log("═══ Price Checks ═══");
  try {
    const spotPrice = await router.getSpotPrice();
    console.log("  Spot Price:", ethers.formatEther(spotPrice), "(1.0 = 1:1)");
  } catch (err) {
    console.log("  Spot Price ERROR:", err.reason || err.message);
  }

  try {
    const twapPrice = await router.getTwapPrice();
    console.log("  TWAP Price:", ethers.formatEther(twapPrice), "(1.0 = 1:1)");
  } catch (err) {
    console.log("  TWAP Price ERROR:", err.reason || err.message);
  }

  try {
    const [safe, spotPrice, twapPrice] = await router.isPriceSafe();
    console.log("  isPriceSafe:", safe);
    console.log("    spotPrice:", ethers.formatEther(spotPrice));
    console.log("    twapPrice:", ethers.formatEther(twapPrice));
  } catch (err) {
    console.log("  isPriceSafe ERROR:", err.reason || err.message);
  }
  console.log("");

  // ── NodesV2 ──
  console.log("═══ NodesV2 ═══");
  const nodes = new ethers.Contract(NODES_V2, NODES_ABI, deployer);
  try {
    const [nOwner, nPaused, nUsdc, nFund, nRouter, nCount] = await Promise.all([
      nodes.owner(), nodes.paused(), nodes.usdc(),
      nodes.fundDistributor(), nodes.swapRouter(), nodes.purchaseCount(),
    ]);
    console.log("  Owner:", nOwner);
    console.log("  Paused:", nPaused);
    console.log("  USDC:", nUsdc);
    console.log("  FundDistributor:", nFund);
    console.log("  SwapRouter:", nRouter);
    console.log("  PurchaseCount:", nCount.toString());

    const miniPlan = await nodes.nodePlans("MINI");
    const maxPlan = await nodes.nodePlans("MAX");
    console.log("  MINI: $" + ethers.formatEther(miniPlan.price), "active:", miniPlan.active);
    console.log("  MAX:  $" + ethers.formatEther(maxPlan.price), "active:", maxPlan.active);

    // Check: does NodesV2.swapRouter match our SwapRouter?
    if (nRouter.toLowerCase() !== SWAP_ROUTER.toLowerCase()) {
      console.log("  ⚠️  NodesV2.swapRouter MISMATCH! Expected:", SWAP_ROUTER);
    }
  } catch (err) {
    console.log("  ERROR:", err.message);
  }
  console.log("");

  // ── Token Balances ──
  console.log("═══ Token Balances ═══");
  const usdtToken = new ethers.Contract(USDT, ERC20_ABI, deployer);
  const usdcToken = new ethers.Contract(USDC, ERC20_ABI, deployer);

  const routerUsdtBal = await usdtToken.balanceOf(SWAP_ROUTER);
  const routerUsdcBal = await usdcToken.balanceOf(SWAP_ROUTER);
  console.log("  SwapRouter USDT:", ethers.formatEther(routerUsdtBal));
  console.log("  SwapRouter USDC:", ethers.formatEther(routerUsdcBal));

  const nodesUsdcBal = await usdcToken.balanceOf(NODES_V2);
  console.log("  NodesV2 USDC:", ethers.formatEther(nodesUsdcBal));

  const fundUsdtBal = await usdtToken.balanceOf(FUND_MANAGER);
  const fundUsdcBal = await usdcToken.balanceOf(FUND_MANAGER);
  console.log("  FundManager USDT:", ethers.formatEther(fundUsdtBal));
  console.log("  FundManager USDC:", ethers.formatEther(fundUsdcBal));

  console.log("");
  console.log("═══ Summary ═══");
  if (paused) console.log("  ❌ SwapRouter is PAUSED");
  if (twapCheckEnabled) console.log("  ⚠️  TWAP check is ENABLED - may fail if pool has few observations");
  console.log("  Done.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
