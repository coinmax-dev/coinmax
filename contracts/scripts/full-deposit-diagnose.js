const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const SWAP_ROUTER = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
  const CUSD = "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const USDT = "0x55d398326f99059fF775485246999027B3197955";
  const BATCH_BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
  const ORACLE = "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD";

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  // ═══ 1. Role checks ═══
  console.log("\n=== 1. ROLE CHECKS ===");
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const GW_ROLE = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

  console.log("SwapRouter → Vault GATEWAY_ROLE:", await vault.hasRole(GW_ROLE, SWAP_ROUTER));

  // Check MA minter
  const ma = await ethers.getContractAt("MAToken", MA);
  console.log("Vault → MA MINTER_ROLE:", await ma.hasRole(MINTER_ROLE, VAULT));

  // Check cUSD minter (CRITICAL!)
  const cusd = new ethers.Contract(CUSD, [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function totalSupply() view returns (uint256)",
  ], signer);
  console.log("Vault → cUSD MINTER_ROLE:", await cusd.hasRole(MINTER_ROLE, VAULT));

  // ═══ 2. SwapRouter config ═══
  console.log("\n=== 2. SWAP ROUTER CONFIG ===");
  const iface = new ethers.Interface([
    "function vaultV2() view returns (address)",
    "function maxSlippageBps() view returns (uint256)",
    "function maxSwapAmount() view returns (uint256)",
    "function cooldownPeriod() view returns (uint256)",
    "function paused() view returns (bool)",
  ]);

  const vaultAddr = iface.decodeFunctionResult("vaultV2",
    await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("vaultV2") }))[0];
  console.log("SwapRouter.vaultV2:", vaultAddr, vaultAddr === VAULT ? "✅ CORRECT" : "❌ WRONG!");

  const maxSlippage = iface.decodeFunctionResult("maxSlippageBps",
    await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("maxSlippageBps") }))[0];
  console.log("SwapRouter.maxSlippageBps:", maxSlippage.toString(), "(" + (Number(maxSlippage)/100) + "%)");

  const maxSwap = iface.decodeFunctionResult("maxSwapAmount",
    await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("maxSwapAmount") }))[0];
  console.log("SwapRouter.maxSwapAmount:", ethers.formatEther(maxSwap), "USDT");

  const cooldown = iface.decodeFunctionResult("cooldownPeriod",
    await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("cooldownPeriod") }))[0];
  console.log("SwapRouter.cooldownPeriod:", cooldown.toString(), "seconds");

  try {
    const paused = iface.decodeFunctionResult("paused",
      await ethers.provider.call({ to: SWAP_ROUTER, data: iface.encodeFunctionData("paused") }))[0];
    console.log("SwapRouter.paused:", paused);
  } catch { console.log("SwapRouter.paused: (no paused function)"); }

  // ═══ 3. Vault config ═══
  console.log("\n=== 3. VAULT CONFIG ===");
  console.log("Vault.asset() (cUSD):", await vault.asset());
  console.log("Vault.fundDistributor:", await vault.fundDistributor());
  console.log("Vault.totalSupply:", ethers.formatEther(await vault.totalSupply()));
  console.log("cUSD.totalSupply:", ethers.formatEther(await cusd.totalSupply()));
  console.log("cUSD balance in Vault:", ethers.formatEther(await cusd.balanceOf(VAULT)));

  // Check oracle
  try {
    const price = await vault.getCurrentMAPrice();
    console.log("Vault.getCurrentMAPrice:", price.toString(), "($" + Number(price)/1e6 + ")");
  } catch (e) {
    console.log("Vault.getCurrentMAPrice: ERROR -", e.message);
  }

  // Check stake plans
  console.log("\n=== 4. STAKE PLANS ===");
  try {
    for (let i = 0; i < 4; i++) {
      try {
        const plan = await vault.stakePlans(i);
        console.log(`Plan[${i}]: days=${plan.duration / 86400n}, dailyRate=${plan.dailyRate}, active=${plan.active}, minDeposit=${ethers.formatEther(plan.minDeposit)}`);
      } catch {
        console.log(`Plan[${i}]: NOT CONFIGURED`);
        break;
      }
    }
  } catch (e) {
    console.log("Error reading plans:", e.message);
  }

  // ═══ 5. USDC allowance chain ═══
  console.log("\n=== 5. USDC ALLOWANCE (SwapRouter → Vault) ===");
  const usdc = new ethers.Contract(USDC, [
    "function allowance(address owner, address spender) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
  ], signer);
  const allowance = await usdc.allowance(SWAP_ROUTER, VAULT);
  console.log("USDC allowance (SwapRouter→Vault):", ethers.formatEther(allowance));
  console.log("USDC balance in SwapRouter:", ethers.formatEther(await usdc.balanceOf(SWAP_ROUTER)));

  // ═══ 6. PancakeSwap pool check ═══
  console.log("\n=== 6. PANCAKESWAP POOL ===");
  const poolIface = new ethers.Interface([
    "function pancakePool() view returns (address)",
  ]);
  try {
    const pool = poolIface.decodeFunctionResult("pancakePool",
      await ethers.provider.call({ to: SWAP_ROUTER, data: poolIface.encodeFunctionData("pancakePool") }))[0];
    console.log("PancakeSwap Pool:", pool);

    const poolContract = new ethers.Contract(pool, [
      "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint32, bool)",
      "function liquidity() view returns (uint128)",
    ], signer);
    const [sqrtPriceX96, tick] = await poolContract.slot0();
    const liq = await poolContract.liquidity();
    console.log("Pool sqrtPriceX96:", sqrtPriceX96.toString());
    console.log("Pool tick:", tick.toString());
    console.log("Pool liquidity:", liq.toString());
  } catch (e) {
    console.log("Pool check error:", e.message);
  }

  // ═══ 7. Simulate a static call ═══
  console.log("\n=== 7. SIMULATE DEPOSIT (static call) ===");
  const testAmount = ethers.parseEther("10"); // 10 USDT
  const minOut = ethers.parseEther("9.95"); // 0.5% slippage

  const srIface = new ethers.Interface([
    "function swapAndDepositVault(uint256 usdtAmount, uint256 planIndex, uint256 minUsdcOut)",
  ]);

  try {
    // First check: does the deployer have USDT?
    const usdtContract = new ethers.Contract(USDT, [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
    ], signer);
    console.log("Deployer USDT balance:", ethers.formatEther(await usdtContract.balanceOf(signer.address)));
    console.log("Deployer USDT allowance to SwapRouter:", ethers.formatEther(await usdtContract.allowance(signer.address, SWAP_ROUTER)));

    // Try static call
    const calldata = srIface.encodeFunctionData("swapAndDepositVault", [testAmount, 0n, minOut]);
    const result = await ethers.provider.call({
      to: SWAP_ROUTER,
      from: signer.address,
      data: calldata,
    });
    console.log("Static call SUCCESS ✅");
  } catch (e) {
    console.log("Static call REVERTED ❌");
    // Try to decode error
    if (e.data) {
      console.log("Error data:", e.data);
      try {
        // Try common OZ 5.x errors
        const errors = new ethers.Interface([
          "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
          "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
          "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
          "error SafeERC20FailedOperation(address token)",
        ]);
        const decoded = errors.parseError(e.data);
        if (decoded) {
          console.log("Decoded error:", decoded.name, decoded.args);
        }
      } catch {}
    }
    console.log("Error message:", e.message?.slice(0, 300));
  }

  // ═══ 8. Check if Vault impl is correct (upgraded?) ═══
  console.log("\n=== 8. VAULT PROXY IMPLEMENTATION ===");
  try {
    const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
    const implRaw = await ethers.provider.getStorage(VAULT, implSlot);
    const impl = "0x" + implRaw.slice(26);
    console.log("Vault implementation:", impl);

    // Check if depositFrom(4 params) exists on the implementation
    const testSig = "0x" + ethers.keccak256(ethers.toUtf8Bytes("depositFrom(address,uint256,uint256,uint256)")).slice(2, 10);
    console.log("depositFrom(4) selector:", testSig);

    // Also check depositFor(3 params)
    const testSig2 = "0x" + ethers.keccak256(ethers.toUtf8Bytes("depositFor(address,uint256,uint256)")).slice(2, 10);
    console.log("depositFor(3) selector:", testSig2);

    // Try to call depositFrom with static call to check selector exists
    const vaultIface = new ethers.Interface([
      "function depositFrom(address depositor, uint256 usdcAmount, uint256 originalUsdtAmount, uint256 planIndex)",
    ]);
    try {
      await ethers.provider.call({
        to: VAULT,
        from: SWAP_ROUTER,
        data: vaultIface.encodeFunctionData("depositFrom", [
          signer.address, ethers.parseEther("1"), ethers.parseEther("1"), 0n
        ]),
      });
      console.log("depositFrom(4) callable from SwapRouter ✅");
    } catch (e2) {
      if (e2.data && e2.data !== "0x") {
        console.log("depositFrom(4) exists but reverts with:", e2.data?.slice(0, 20));
        try {
          const errors = new ethers.Interface([
            "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
            "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
            "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
          ]);
          const decoded = errors.parseError(e2.data);
          if (decoded) console.log("  → Decoded:", decoded.name, decoded.args.map(a => a.toString()));
        } catch {}
      } else {
        console.log("depositFrom(4) DOES NOT EXIST on vault impl ❌");
      }
    }
  } catch (e) {
    console.log("Proxy check error:", e.message);
  }
}

main().catch(console.error);
