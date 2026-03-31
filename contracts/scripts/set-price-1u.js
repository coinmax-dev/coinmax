const { ethers } = require("hardhat");
async function main() {
  const oracle = await ethers.getContractAt("MAPriceOracle", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD");
  let price = Number(await oracle.getPriceUnsafe());
  console.log("Before:", price / 1e6);

  // Step 10% at a time: 0.90 → 0.99 → 1.00
  const target = 1000000;
  while (price < target * 0.99) {
    const next = Math.min(Math.round(price * 1.10), target);
    console.log("  ->", next / 1e6);
    await (await oracle.updatePrice(next, { gasLimit: 200000 })).wait();
    price = next;
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log("Final:", Number(await oracle.getPriceUnsafe()) / 1e6);

  // Sync DB
  const { Client } = require("pg");
  const c = new Client({ connectionString: "postgresql://postgres:onelong53541314@db.enedbksmftcgtszrkppc.supabase.co:5432/postgres" });
  await c.connect();
  await c.query("UPDATE system_config SET value = '1.000000' WHERE key = 'MA_TOKEN_PRICE'");
  console.log("DB synced: $1.00");
  await c.end();
}
main().catch(console.error);
