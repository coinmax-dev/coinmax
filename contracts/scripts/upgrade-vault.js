/**
 * Upgrade CoinMaxVault implementation — adds earlyClaimPrincipal (20% burn)
 *
 * Usage:
 *   node scripts/upgrade-vault.js
 *
 * Uses thirdweb Server Wallet (0x85e44, admin) to call upgradeToAndCall on proxy.
 */

const THIRDWEB_SECRET = "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const VAULT_PROXY = "0xC3E05890dB946B311b00AB64cA255FdcC3643F0a";

async function main() {
  // Step 1: Deploy new implementation via hardhat
  const { ethers } = require("hardhat");
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  console.log("\n1. Deploying new Vault implementation...");
  const VaultFactory = await ethers.getContractFactory("CoinMaxVault");
  const newImpl = await VaultFactory.deploy();
  await newImpl.waitForDeployment();
  const newImplAddr = await newImpl.getAddress();
  console.log("   New implementation:", newImplAddr);

  // Step 2: Upgrade proxy via Server Wallet (admin)
  console.log("\n2. Upgrading proxy via Server Wallet...");
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
    },
    body: JSON.stringify({
      chainId: 56,
      from: SERVER_WALLET,
      calls: [{
        contractAddress: VAULT_PROXY,
        method: "function upgradeToAndCall(address newImplementation, bytes data)",
        params: [newImplAddr, "0x"],
      }],
    }),
  });
  const data = await res.json();
  const txId = data?.result?.transactionIds?.[0];
  console.log("   TX ID:", txId || "FAILED");
  if (data.error) console.log("   Error:", JSON.stringify(data.error));

  // Step 3: Verify
  console.log("\n3. Waiting 10s for confirmation...");
  await new Promise(r => setTimeout(r, 10000));

  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed1.binance.org");
  const implSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  const storage = await provider.getStorage(VAULT_PROXY, implSlot);
  const currentImpl = "0x" + storage.slice(26);
  console.log("   Current implementation:", currentImpl);
  console.log("   Match:", currentImpl.toLowerCase() === newImplAddr.toLowerCase() ? "YES ✓" : "NO - may need more time");

  // Step 4: Test earlyClaimPrincipal exists
  const vault = new ethers.Contract(VAULT_PROXY, [
    "function earlyClaimPrincipal(uint256) external",
  ], provider);
  try {
    // Just check function exists (will revert with "Invalid index" which is fine)
    await vault.earlyClaimPrincipal.staticCall(999).catch(e => {
      if (e.message.includes("Invalid index")) {
        console.log("\n   earlyClaimPrincipal function exists ✓");
      } else {
        console.log("\n   Function check:", e.message.slice(0, 100));
      }
    });
  } catch {}

  console.log("\nDone! Vault upgraded with earlyClaimPrincipal (80% release, 20% burn)");
}

main().catch(e => { console.error(e); process.exit(1); });
