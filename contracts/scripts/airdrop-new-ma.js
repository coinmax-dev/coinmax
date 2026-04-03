const { ethers } = require("hardhat");

/**
 * Airdrop new MA Token to users who held old MA
 * Mints exact same amount of new MA (0xc6d2) to each holder
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const NEW_MA = "0xc6d2dbC85DC3091C41692822A128c19F9eAc7988";
  const ma = await ethers.getContractAt("src/v4/MAToken.sol:MAToken", NEW_MA);

  const holders = [
    ["0x5EEe521C753f04fC31633c6A65C89879E1d20A1d", "114.4"],
    ["0x77200c71B651d05a38f453EE9cF2904f48833149", "72.0"],
    ["0x7252534Ae6CDEffd6a964Ae7A1956ed4802E7B5c", "56.0"],
    ["0x49dD11De804F2a07D9a2666000B836b7cA168d26", "55.2"],
    ["0x35E5086374095c6C89b82057847c58D8ceB89554", "53.6"],
    ["0x1C785ae722483f5Be7b44027FF8032f3B0211c97", "50.773974096754999296"],
    ["0x9285B83e63571Bd24577cfaDDf35fa1839E4A275", "48.0"],
    ["0x50dfFeF6CB5d13e7B74Bd53534FD069eCa64C675", "45.712"],
    ["0x09e1488544c7Cab19016a75B52C1883Bd9Ef49F3", "44.8"],
    ["0x37a0934de53Cc7360Da9A51354d13518dea19900", "44.8"],
    ["0xab340A5770b5eBcB1B8227B84a38070d9AbD5920", "44.8"],
    ["0xBd959B219A4B6C07Faaa4224D6486EBb8a77ef3f", "44.8"],
    ["0xC8fAE488d96eF4732B85C348Adf149f6a16dbb5E", "44.8"],
    ["0xb38306fFC784Eb9E9B5f744a679E93D332d41bcf", "40.0"],
    ["0xc4A41D24b157f126497c6e6e89e071F724808fBE", "40.0"],
    ["0xef5F149b42405b950c1715A6bFDcdF5867e2Da8D", "33.948"],
    ["0xC92Bc4a2bc50Ad01bD49Ea8DdfD7Ff6D31A1E3cf", "8.0"],
    ["0xf9481D700c0C093F2867d975429ec69D4576B8AC", "4.21"],
    ["0xE743dDAd1fE6eC82d6C1A98a63400aad7b823cf1", "0.375220014441043776"],
    ["0x0DF3D4097Feb8d25d7DEC1e6F7407C8eA124C7CE", "0.16"],
  ];

  console.log("\n=== Airdrop New MA ===");
  console.log("Holders:", holders.length);
  console.log("Total:", holders.reduce((s, h) => s + parseFloat(h[1]), 0).toFixed(4), "MA");

  // Check deployer has MINTER_ROLE
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const hasMinter = await ma.hasRole(MINTER_ROLE, deployer.address);
  if (!hasMinter) {
    console.log("Granting MINTER_ROLE to deployer...");
    await (await ma.grantRole(MINTER_ROLE, deployer.address)).wait();
  }

  let minted = 0;
  for (const [addr, amount] of holders) {
    const wei = ethers.parseEther(amount);
    try {
      const tx = await ma.mint(addr, wei);
      await tx.wait();
      minted++;
      console.log("  ✅", addr.slice(0, 10), amount, "MA");
    } catch (e) {
      console.log("  ❌", addr.slice(0, 10), e.message?.slice(0, 60));
    }
  }

  // Revoke MINTER_ROLE from deployer
  if (!hasMinter) {
    await (await ma.revokeRole(MINTER_ROLE, deployer.address)).wait();
    console.log("\nMINTER_ROLE revoked from deployer");
  }

  console.log("\nDone:", minted + "/" + holders.length, "minted");
  console.log("New MA totalSupply:", ethers.formatEther(await ma.totalSupply()));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
