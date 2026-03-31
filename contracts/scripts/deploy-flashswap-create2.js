const { ethers } = require("hardhat");

/**
 * Deploy FlashSwap with CREATE2 (deterministic address)
 * Same salt on BSC + ARB = same proxy address on both chains
 *
 * Architecture:
 *   CREATE2 → ERC1967Proxy(FlashSwap impl) → initialize(ma, usdt, usdc, oracle, admin)
 *
 * Each chain has different token/oracle addresses but same proxy address.
 */

// CREATE2 deployer (standard across all chains)
const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT = ethers.keccak256(ethers.toUtf8Bytes("CoinMaxFlashSwap_v1"));

// Chain configs
const CHAINS = {
  bsc: {
    ma: "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593",
    usdt: "0x55d398326f99059fF775485246999027B3197955",
    usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    oracle: "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD",
  },
  arbitrum: {
    ma: "0xdFaC84b2f9cfD02b3f44760E0Ff88b4EeC0e1593", // TODO: deploy MA on ARB or use bridge
    usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    oracle: "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD", // TODO: deploy Oracle on ARB
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainName = network.chainId === 56n ? "bsc" : network.chainId === 42161n ? "arbitrum" : "unknown";
  const config = CHAINS[chainName];

  if (!config) {
    console.log("Unknown chain:", network.chainId.toString());
    return;
  }

  console.log("Chain:", chainName, "| Deployer:", deployer.address);
  console.log("BNB/ETH:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));

  // 1. Deploy implementation
  console.log("\n1. Deploying FlashSwap implementation...");
  const Impl = await ethers.getContractFactory("CoinMaxFlashSwap");
  const impl = await Impl.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log("   Implementation:", implAddr);

  // 2. Encode initialize calldata
  const initData = Impl.interface.encodeFunctionData("initialize", [
    config.ma,
    config.usdt,
    config.usdc,
    config.oracle,
    deployer.address,
  ]);

  // 3. Deploy ERC1967Proxy via CREATE2
  console.log("\n2. Deploying ERC1967Proxy via CREATE2...");
  console.log("   Salt:", SALT);

  // ERC1967Proxy constructor: (address implementation, bytes data)
  const proxyFactory = await ethers.getContractFactory("ERC1967Proxy", {
    libraries: {},
  });
  const proxyBytecode = ethers.solidityPacked(
    ["bytes", "bytes"],
    [proxyFactory.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes"], [implAddr, initData])]
  );

  // Calculate CREATE2 address
  const create2Addr = ethers.getCreate2Address(
    CREATE2_FACTORY,
    SALT,
    ethers.keccak256(proxyBytecode)
  );
  console.log("   Predicted address:", create2Addr);

  // Check if already deployed
  const existing = await ethers.provider.getCode(create2Addr);
  if (existing !== "0x") {
    console.log("   Already deployed at this address! ✅");

    // Verify it works
    const fs = await ethers.getContractAt("CoinMaxFlashSwap", create2Addr);
    console.log("   maToken:", await fs.maToken());
    console.log("   oracle:", await fs.oracle());
    return;
  }

  // Deploy via CREATE2 factory
  const tx = await deployer.sendTransaction({
    to: CREATE2_FACTORY,
    data: ethers.solidityPacked(["bytes32", "bytes"], [SALT, proxyBytecode]),
    gasLimit: 3000000,
  });
  console.log("   TX:", tx.hash);
  const receipt = await tx.wait();
  console.log("   Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");

  // Verify
  const deployed = await ethers.provider.getCode(create2Addr);
  if (deployed === "0x") {
    console.log("   ❌ Deployment failed - no code at predicted address");
    return;
  }

  console.log("\n3. Verifying...");
  const fs = await ethers.getContractAt("CoinMaxFlashSwap", create2Addr);
  console.log("   maToken:", await fs.maToken());
  console.log("   usdt:", await fs.usdt());
  console.log("   oracle:", await fs.oracle());
  console.log("   feeBps:", Number(await fs.feeBps()));
  console.log("   holdingRuleBps:", Number(await fs.holdingRuleBps()));

  console.log("\n═══════════════════════════════════════");
  console.log("FlashSwap CREATE2:", create2Addr);
  console.log("Chain:", chainName);
  console.log("Same salt on ARB will give same address ✅");
  console.log("═══════════════════════════════════════");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
