const { ethers } = require("hardhat");

/**
 * Redeploy FlashSwapV4 + ReleaseV4 as UUPS proxies
 * Then revoke old contract roles and grant to new
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const MA_TOKEN = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  const ORACLE = "0xB73A4Ac36a36C92C8d6F6828ea431Ca30f1943a2";
  const ENGINE = "0xDd6660E403d0242c1BeE52a4de50484AAF004446";
  const VAULT = "0x08a24206b7AcAA7cf68E8a5bE16fE6cE7a4D1744";
  const OLD_FLASH = "0xf596f3BEe64C4AB698a8e6A65893cd32457F5Df3";
  const OLD_RELEASE = "0x04A210CbdFD3e402EC8d8B2d60f2aA350e65c443";

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const ENGINE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ENGINE_ROLE"));

  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", MA_TOKEN);

  // ── 1. Deploy FlashSwapV4 as UUPS proxy ──
  console.log("\n[1] Deploying FlashSwapV4 (UUPS)...");
  const FlashImpl = await ethers.getContractFactory("FlashSwapV4");
  const flashImpl = await FlashImpl.deploy();
  await flashImpl.waitForDeployment();
  console.log("  impl:", await flashImpl.getAddress());

  const flashInit = FlashImpl.interface.encodeFunctionData("initialize", [MA_TOKEN, ORACLE]);
  const Proxy = await ethers.getContractFactory("@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy");
  const flashProxy = await Proxy.deploy(await flashImpl.getAddress(), flashInit);
  await flashProxy.waitForDeployment();
  const flashAddr = await flashProxy.getAddress();
  console.log("  proxy:", flashAddr);

  // ── 2. Deploy ReleaseV4 as UUPS proxy ──
  console.log("\n[2] Deploying ReleaseV4 (UUPS)...");
  const ReleaseImpl = await ethers.getContractFactory("ReleaseV4");
  const releaseImpl = await ReleaseImpl.deploy();
  await releaseImpl.waitForDeployment();
  console.log("  impl:", await releaseImpl.getAddress());

  const releaseInit = ReleaseImpl.interface.encodeFunctionData("initialize", [MA_TOKEN]);
  const releaseProxy = await Proxy.deploy(await releaseImpl.getAddress(), releaseInit);
  await releaseProxy.waitForDeployment();
  const releaseAddr = await releaseProxy.getAddress();
  console.log("  proxy:", releaseAddr);

  // ── 3. Configure roles ──
  console.log("\n[3] Configuring roles...");
  const flash = await ethers.getContractAt("FlashSwapV4", flashAddr);
  const release = await ethers.getContractAt("ReleaseV4", releaseAddr);

  // FlashSwap: ENGINE_ROLE → Engine
  await (await flash.grantRole(ENGINE_ROLE, ENGINE)).wait();
  console.log("  FlashSwap ENGINE_ROLE → Engine ✅");

  // MA: MINTER_ROLE → new FlashSwap (for burnFrom)
  await (await ma.grantRole(MINTER_ROLE, flashAddr)).wait();
  console.log("  MA MINTER_ROLE → new FlashSwap ✅");

  // MA: MINTER_ROLE → new Release (for burn on destroy)
  await (await ma.grantRole(MINTER_ROLE, releaseAddr)).wait();
  console.log("  MA MINTER_ROLE → new Release ✅");

  // Release: ENGINE_ROLE → Engine + Vault
  await (await release.grantRole(ENGINE_ROLE, ENGINE)).wait();
  await (await release.grantRole(ENGINE_ROLE, VAULT)).wait();
  console.log("  Release ENGINE_ROLE → Engine + Vault ✅");

  // Update Vault maReceiver → new Release
  const vault = await ethers.getContractAt("CoinMaxVaultV4", VAULT);
  await (await vault.setMaReceiver(releaseAddr)).wait();
  console.log("  Vault maReceiver → new Release ✅");

  // ── 4. Revoke old contract roles ──
  console.log("\n[4] Revoking old contract roles...");
  await (await ma.revokeRole(MINTER_ROLE, OLD_FLASH)).wait();
  console.log("  MA MINTER revoked from old FlashSwap ✅");
  await (await ma.revokeRole(MINTER_ROLE, OLD_RELEASE)).wait();
  console.log("  MA MINTER revoked from old Release ✅");

  // ── Summary ──
  console.log("\n════════════════════════════════════════");
  console.log("  Upgrade Complete");
  console.log("════════════════════════════════════════");
  console.log("FlashSwapV4 (new):", flashAddr, "(UUPS proxy)");
  console.log("ReleaseV4 (new): ", releaseAddr, "(UUPS proxy)");
  console.log("Old FlashSwap:   ", OLD_FLASH, "(roles revoked)");
  console.log("Old Release:     ", OLD_RELEASE, "(roles revoked)");
  console.log("");
  console.log("Update .env:");
  console.log(`  VITE_FLASH_SWAP_V4_ADDRESS=${flashAddr}`);
  console.log(`  VITE_RELEASE_V4_ADDRESS=${releaseAddr}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
