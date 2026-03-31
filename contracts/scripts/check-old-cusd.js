const { ethers } = require("hardhat");

async function main() {
  const addr = "0x90B99a1495E5DBf8bF44c3623657020BB1BDa3C6";
  const signer = (await ethers.getSigners())[0];
  const c = new ethers.Contract(addr, [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function totalSupply() view returns (uint256)",
    "function hasRole(bytes32, address) view returns (bool)",
  ], signer);

  try { console.log("name:", await c.name()); } catch(e) { console.log("name: error"); }
  try { console.log("symbol:", await c.symbol()); } catch(e) { console.log("symbol: error"); }
  try { console.log("totalSupply:", (await c.totalSupply()).toString()); } catch(e) { console.log("supply: error"); }

  const MINTER = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const VAULT = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
  try { console.log("Vault has MINTER on old cUSD:", await c.hasRole(MINTER, VAULT)); } catch(e) { console.log("hasRole: error"); }

  // Check code exists
  const code = await ethers.provider.getCode(addr);
  console.log("Has code:", code.length > 2 ? "YES (" + code.length + " bytes)" : "NO — EOA or destroyed");
}

main().catch(console.error);
