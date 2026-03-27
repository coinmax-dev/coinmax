/**
 * Deploy StargateBridgeAdapter on BSC + wire to Vault V2
 *
 * Stargate V1 on BSC:
 *   Router: 0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8
 *   USDT Pool ID: 2  (BSC uses USDT for Stargate)
 *   ARB Chain ID: 110 (LayerZero)
 *   ARB USDT Pool ID: 2
 *
 * Usage: npx hardhat run scripts/deploy-bridge-adapter.js --network bsc
 */

const { ethers } = require("hardhat");

const THIRDWEB_SECRET = "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";

// BSC Stargate
const STARGATE_ROUTER = "0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // BSC USDC
const DST_CHAIN_ID = 110;  // Arbitrum (LayerZero chain ID)
const SRC_POOL_ID = 1;     // USDC pool on BSC
const DST_POOL_ID = 1;     // USDC pool on ARB
const SLIPPAGE_BPS = 50;   // 0.5%

// Vault V2
const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  // 1. Deploy StargateBridgeAdapter
  console.log("1. Deploying StargateBridgeAdapter...");
  const Factory = await ethers.getContractFactory("StargateBridgeAdapter");
  const adapter = await Factory.deploy(
    STARGATE_ROUTER,
    BSC_USDC,
    DST_CHAIN_ID,
    SRC_POOL_ID,
    DST_POOL_ID,
    SLIPPAGE_BPS,
    SERVER_WALLET, // default recipient on ARB
  );
  await adapter.waitForDeployment();
  const adapterAddr = await adapter.getAddress();
  console.log("   Adapter:", adapterAddr);

  // 2. Transfer ownership to Server Wallet
  console.log("\n2. Transferring ownership to Server Wallet...");
  const tx1 = await adapter.transferOwnership(SERVER_WALLET);
  await tx1.wait();
  console.log("   Done ✓");

  // 3. Wire to Vault V2 (via thirdweb Server Wallet since Vault admin = Server Wallet)
  console.log("\n3. Wiring adapter to Vault V2...");

  // setBridgeAdapter
  const res1 = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret-key": THIRDWEB_SECRET },
    body: JSON.stringify({
      chainId: 56,
      from: SERVER_WALLET,
      calls: [{
        contractAddress: VAULT,
        method: "function setBridgeAdapter(address _b)",
        params: [adapterAddr],
      }],
    }),
  });
  const d1 = await res1.json();
  console.log("   setBridgeAdapter:", d1?.result?.transactionIds?.[0] || "QUEUED");

  // setRemoteVault (ARB server wallet, chain 42161)
  const res2 = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-secret-key": THIRDWEB_SECRET },
    body: JSON.stringify({
      chainId: 56,
      from: SERVER_WALLET,
      calls: [{
        contractAddress: VAULT,
        method: "function setRemoteVault(address _r, uint32 _chainId)",
        params: [SERVER_WALLET, "42161"],
      }],
    }),
  });
  const d2 = await res2.json();
  console.log("   setRemoteVault:", d2?.result?.transactionIds?.[0] || "QUEUED");

  // 4. Update treasury_config in DB
  console.log("\n4. Updating DB config...");
  // (This would be done via supabase, just log the address)

  console.log("\n═══════════════════════════════════════");
  console.log("  STARGATE BRIDGE ADAPTER DEPLOYED");
  console.log("═══════════════════════════════════════");
  console.log("  Adapter:         ", adapterAddr);
  console.log("  Stargate Router: ", STARGATE_ROUTER);
  console.log("  Source:           BSC USDC Pool", SRC_POOL_ID);
  console.log("  Destination:      ARB (chain", DST_CHAIN_ID, ") Pool", DST_POOL_ID);
  console.log("  Slippage:        ", SLIPPAGE_BPS / 100, "%");
  console.log("  Recipient:       ", SERVER_WALLET, "(ARB)");
  console.log("  Vault V2:        ", VAULT);
  console.log("═══════════════════════════════════════");
  console.log("\nUpdate treasury_config: stargate_adapter =", adapterAddr);
}

main().catch(e => { console.error(e); process.exit(1); });
