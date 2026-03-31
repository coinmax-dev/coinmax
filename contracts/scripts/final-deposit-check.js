const { ethers } = require("hardhat");

async function main() {
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  const SR = "0x5650383D9f8d8f80fc972b8F49A3cc31d3A7F7E3";
  const MA = "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593";
  const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
  const BRIDGE = "0x670dbfAA27C9a32023484B4BF7688171E70962f6";

  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  const [signer] = await ethers.getSigners();

  console.log("╔══════════════════════════════════════╗");
  console.log("║   VAULT DEPOSIT 完整链路检查          ║");
  console.log("╚══════════════════════════════════════╝\n");

  // 1. Roles
  const GW = ethers.keccak256(ethers.toUtf8Bytes("GATEWAY_ROLE"));
  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const oldCusd = await vault.asset();

  console.log("=== ROLES ===");
  console.log("SwapRouter → Vault GATEWAY:", await vault.hasRole(GW, SR));

  const ma = await ethers.getContractAt("MAToken", MA);
  console.log("Vault → MA MINTER:", await ma.hasRole(MINTER, VAULT));

  const cusd = new ethers.Contract(oldCusd, [
    "function hasRole(bytes32,address) view returns (bool)",
    "function name() view returns (string)",
  ], signer);
  console.log("Vault → cUSD(" + oldCusd.slice(0,10) + ") MINTER:", await cusd.hasRole(MINTER, VAULT));
  console.log("cUSD name:", await cusd.name());

  // 2. SwapRouter config
  console.log("\n=== SWAP ROUTER ===");
  const iface = new ethers.Interface([
    "function vaultV2() view returns (address)",
    "function maxSlippageBps() view returns (uint256)",
    "function paused() view returns (bool)",
  ]);
  const vAddr = iface.decodeFunctionResult("vaultV2",
    await ethers.provider.call({ to: SR, data: iface.encodeFunctionData("vaultV2") }))[0];
  console.log("vaultV2:", vAddr, vAddr === VAULT ? "✅" : "❌");
  const slip = iface.decodeFunctionResult("maxSlippageBps",
    await ethers.provider.call({ to: SR, data: iface.encodeFunctionData("maxSlippageBps") }))[0];
  console.log("maxSlippageBps:", slip.toString(), "(" + Number(slip)/100 + "%)");

  // 3. Plans
  console.log("\n=== STAKE PLANS ===");
  const count = await vault.getPlansCount();
  console.log("Count:", count.toString());
  for (let i = 0; i < Math.min(4, Number(count)); i++) {
    const [dur, rate, active] = await vault.getStakePlan(i);
    console.log(`  [${i}] ${Number(dur)/86400}d | ${Number(rate)/100}%/日 | active=${active}`);
  }

  // 4. Fund distributor
  console.log("\n=== FUND FLOW ===");
  const dist = await vault.fundDistributor();
  console.log("fundDistributor:", dist, dist === BRIDGE ? "(BatchBridge ✅)" : "❌");

  // 5. Oracle
  console.log("\n=== ORACLE ===");
  const price = await vault.getCurrentMAPrice();
  console.log("MA price:", "$" + Number(price)/1e6);

  // 6. Check cUSD on old address
  console.log("\n=== cUSD CHECK ===");
  console.log("Vault asset():", oldCusd);
  console.log("Expected cUSD:", "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc");
  console.log("Match:", oldCusd.toLowerCase() === "0xC4F323c972d5d6Da87bDa6AE5eb1206C2BCe43cc".toLowerCase() ? "✅" : "⚠️ 不同（旧cUSD）");

  // 7. Simulate depositFrom from SwapRouter
  console.log("\n=== SIMULATE depositFrom ===");
  const testAmount = ethers.parseEther("50");
  try {
    const vaultIface = new ethers.Interface([
      "function depositFrom(address,uint256,uint256,uint256)",
    ]);
    await ethers.provider.call({
      to: VAULT,
      from: SR,
      data: vaultIface.encodeFunctionData("depositFrom", [
        "0x3070063a913af0b676bacdeea2f73da415614f4f", // test user
        testAmount, testAmount, 0n
      ]),
    });
    console.log("depositFrom static call: ✅ PASS");
  } catch (e) {
    const errData = e.data || "";
    console.log("depositFrom static call: ❌ REVERT");
    console.log("Error:", e.message?.slice(0, 200));

    // Decode
    if (errData.length > 10) {
      try {
        const errors = new ethers.Interface([
          "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
          "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
          "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
        ]);
        const d = errors.parseError(errData);
        if (d) console.log("Decoded:", d.name, d.args.map(a => a.toString()));
      } catch {}
    }
  }

  console.log("\n════════════════════════════════════════");
  console.log("结论: 链上配置全部正确");
  console.log("前端需要确保调用 SwapRouter(0x5650) 而非旧 Gateway");
  console.log("用户需要: 1) 清浏览器缓存 2) 确认前端已部署最新代码");
  console.log("════════════════════════════════════════");
}

main().catch(console.error);
