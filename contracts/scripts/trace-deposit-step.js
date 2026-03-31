const { ethers } = require("hardhat");

async function main() {
  const SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const USER = "0x3070063a913af0b676bacdeea2f73da415614f4f";
  const PANCAKE_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";

  const [signer] = await ethers.getSigners();
  const amount = ethers.parseEther("50"); // 50 USDT test
  const minOut = ethers.parseEther("49.75"); // 0.5% slippage

  // ═══ Check user state ═══
  console.log("=== USER STATE ===");
  const usdt = new ethers.Contract(USDT, [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ], signer);
  const userBal = await usdt.balanceOf(USER);
  const userAllow = await usdt.allowance(USER, SR);
  console.log("User USDT balance:", ethers.formatEther(userBal));
  console.log("User USDT allowance to SwapRouter:", ethers.formatEther(userAllow));

  if (userBal < amount) {
    console.log("⚠️  User has insufficient USDT! Need 50, have", ethers.formatEther(userBal));
  }

  // ═══ SwapRouter state ═══
  console.log("\n=== SWAP ROUTER STATE ===");
  const srIface = new ethers.Interface([
    "function paused() view returns (bool)",
    "function maxSwapAmount() view returns (uint256)",
    "function maxSlippageBps() view returns (uint256)",
    "function cooldownPeriod() view returns (uint256)",
    "function lastSwapTime(address) view returns (uint256)",
    "function maxPriceDeviationBps() view returns (uint256)",
    "function twapCheckEnabled() view returns (bool)",
    "function maxTwapDeviationBps() view returns (uint256)",
    "function vaultV2() view returns (address)",
    "function pancakePool() view returns (address)",
  ]);

  async function readSR(fn) {
    return srIface.decodeFunctionResult(fn, await ethers.provider.call({
      to: SR, data: srIface.encodeFunctionData(fn)
    }))[0];
  }
  async function readSRWithArg(fn, arg) {
    return srIface.decodeFunctionResult(fn, await ethers.provider.call({
      to: SR, data: srIface.encodeFunctionData(fn, [arg])
    }))[0];
  }

  const paused = await readSR("paused");
  console.log("paused:", paused);
  if (paused) { console.log("❌ SwapRouter is PAUSED!"); return; }

  const maxSwap = await readSR("maxSwapAmount");
  console.log("maxSwapAmount:", ethers.formatEther(maxSwap));
  if (amount > maxSwap) { console.log("❌ Exceeds max swap!"); return; }

  const maxSlip = await readSR("maxSlippageBps");
  console.log("maxSlippageBps:", maxSlip.toString());

  // Check slippage validation
  const floor = (amount * (10000n - maxSlip)) / 10000n;
  console.log("Slippage floor:", ethers.formatEther(floor));
  console.log("minUsdcOut:", ethers.formatEther(minOut));
  console.log("minOut >= floor:", minOut >= floor ? "✅" : "❌ SLIPPAGE TOO HIGH!");

  const cooldown = await readSR("cooldownPeriod");
  const lastSwap = await readSRWithArg("lastSwapTime", USER);
  const now = BigInt(Math.floor(Date.now()/1000));
  console.log("cooldownPeriod:", cooldown.toString(), "s");
  console.log("lastSwapTime:", lastSwap.toString());
  console.log("cooldown OK:", now >= lastSwap + cooldown ? "✅" : "❌ COOLDOWN ACTIVE!");

  // ═══ Pool price check ═══
  console.log("\n=== POOL PRICE CHECK ===");
  const maxDevBps = await readSR("maxPriceDeviationBps");
  console.log("maxPriceDeviationBps:", maxDevBps.toString());

  const pool = await readSR("pancakePool");
  const poolC = new ethers.Contract(pool, [
    "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)",
    "function token0() view returns (address)",
  ], signer);
  const [sqrtPriceX96, tick] = await poolC.slot0();
  const token0 = await poolC.token0();
  console.log("Pool:", pool);
  console.log("token0:", token0, token0.toLowerCase() === USDT.toLowerCase() ? "(USDT)" : "(USDC)");
  console.log("tick:", tick.toString());

  // Calculate spot price
  const isToken0Usdt = token0.toLowerCase() === USDT.toLowerCase();
  let spotPrice;
  const sqrtP = BigInt(sqrtPriceX96);
  if (isToken0Usdt) {
    spotPrice = (sqrtP * sqrtP * BigInt(1e18)) >> 192n;
  } else {
    spotPrice = (BigInt(1e18) << 192n) / (sqrtP * sqrtP);
  }
  console.log("Spot price (1e18=1:1):", spotPrice.toString());
  console.log("Spot price readable:", (Number(spotPrice) / 1e18).toFixed(6));

  // Check deviation
  const diff = spotPrice > BigInt(1e18) ? spotPrice - BigInt(1e18) : BigInt(1e18) - spotPrice;
  const devBps = (diff * 10000n) / BigInt(1e18);
  console.log("Deviation from 1:1:", devBps.toString(), "bps (" + (Number(devBps)/100).toFixed(2) + "%)");
  console.log("Within maxPriceDeviationBps:", devBps <= maxDevBps ? "✅" : "❌ PRICE TOO FAR FROM 1:1!");

  // TWAP check
  const twapEnabled = await readSR("twapCheckEnabled");
  console.log("twapCheckEnabled:", twapEnabled);

  // ═══ USDT allowance from SwapRouter to PancakeRouter ═══
  console.log("\n=== INTERNAL ALLOWANCES ===");
  const usdtAllowSRtoPancake = await usdt.allowance(SR, PANCAKE_ROUTER);
  console.log("USDT allowance (SwapRouter→PancakeRouter):", ethers.formatEther(usdtAllowSRtoPancake));

  const usdc = new ethers.Contract(USDC, [
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
  ], signer);
  const usdcAllowSRtoVault = await usdc.allowance(SR, VAULT);
  console.log("USDC allowance (SwapRouter→Vault):", ethers.formatEther(usdcAllowSRtoVault));

  // ═══ Full static call simulation ═══
  console.log("\n=== FULL STATIC CALL (from USER) ===");
  const calldata = new ethers.Interface([
    "function swapAndDepositVault(uint256,uint256,uint256)",
  ]).encodeFunctionData("swapAndDepositVault", [amount, 0n, minOut]);

  try {
    await ethers.provider.call({ to: SR, from: USER, data: calldata });
    console.log("✅ PASS — deposit should work!");
  } catch (e) {
    console.log("❌ REVERT");
    if (e.data) {
      console.log("Raw error data:", e.data.slice(0, 100));
      // Try decode
      if (e.data.startsWith("0x08c379a0")) {
        const reason = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + e.data.slice(10));
        console.log("Reason:", reason[0]);
      } else {
        try {
          const errs = new ethers.Interface([
            "error ERC20InsufficientAllowance(address,uint256,uint256)",
            "error ERC20InsufficientBalance(address,uint256,uint256)",
          ]);
          const d = errs.parseError(e.data);
          if (d) console.log("Decoded:", d.name, d.args.map(a=>a.toString()));
        } catch {}
      }
    } else {
      console.log("Message:", e.message?.slice(0, 300));
    }
  }
}

main().catch(console.error);
