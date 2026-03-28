const { ethers } = require("hardhat");

async function main() {
  const GATEWAY = "0x38a692f51FF4Db415cf8620d131df518fb8F3b30";
  const gw = await ethers.getContractAt("CoinMaxGateway", GATEWAY);

  // Check every config
  console.log("=== Gateway 完整配置 ===");
  console.log("  usdt:", await gw.usdt());
  console.log("  usdc:", await gw.usdc());
  console.log("  dexRouter:", await gw.dexRouter());
  console.log("  poolFee:", (await gw.poolFee()).toString());
  console.log("  treasury:", await gw.treasury());
  console.log("  isVaultChain:", await gw.isVaultChain());
  console.log("  cUsd:", await gw.cUsd());
  console.log("  vault:", await gw.vault());
  console.log("  maxSlippageBps:", (await gw.maxSlippageBps()).toString());
  console.log("  maxDepositAmount:", ethers.formatEther(await gw.maxDepositAmount()));
  console.log("  cooldownPeriod:", (await gw.cooldownPeriod()).toString());
  
  const paused = await gw.paused();
  console.log("  paused:", paused);
  if (paused) console.log("  ❌ GATEWAY IS PAUSED!");

  // Check Vault
  const VAULT = await gw.vault();
  const vault = await ethers.getContractAt("CoinMaxVault", VAULT);
  console.log("\n=== Vault 配置 ===");
  console.log("  maToken:", await vault.maToken());
  console.log("  priceOracle:", await vault.priceOracle());
  console.log("  maPrice:", (await vault.maPrice()).toString());
  
  const vPaused = await vault.paused();
  console.log("  paused:", vPaused);
  if (vPaused) console.log("  ❌ VAULT IS PAUSED!");

  // Check Oracle
  const oracleAddr = await vault.priceOracle();
  const oracle = await ethers.getContractAt("MAPriceOracle", oracleAddr);
  const price = await oracle.price();
  const lastUpdate = await oracle.lastUpdateTime();
  const heartbeat = await oracle.heartbeat();
  const now = Math.floor(Date.now() / 1000);
  const stale = now > Number(lastUpdate) + Number(heartbeat);
  console.log("\n=== Oracle ===");
  console.log("  price:", price.toString(), `($${Number(price)/1e6})`);
  console.log("  lastUpdate:", Number(lastUpdate), `(${Math.floor((now - Number(lastUpdate))/60)} min ago)`);
  console.log("  heartbeat:", Number(heartbeat)/3600, "hours");
  console.log("  stale:", stale ? "❌ YES — getPrice() will REVERT!" : "✅ NO");

  // Check plans
  const planCount = await vault.getPlansCount();
  console.log("\n=== Vault Plans ===");
  for (let i = 0; i < Number(planCount); i++) {
    const [dur, rate, active] = await vault.getStakePlan(i);
    console.log(`  Plan ${i}: ${Number(dur)/86400}d, ${Number(rate)/100}%/day, active: ${active}`);
  }

  // Try to get price from vault
  console.log("\n=== Vault._getMAPrice() ===");
  try {
    const p = await vault.getCurrentMAPrice();
    console.log("  getCurrentMAPrice:", p.toString(), `($${Number(p)/1e6})`);
  } catch (e) {
    console.log("  ❌ getCurrentMAPrice FAILED:", e.message.slice(0, 100));
    console.log("  This is why deposit fails — Vault can't get MA price!");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
