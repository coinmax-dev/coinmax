const { ethers } = require("hardhat");
async function main() {
  const oracle = await ethers.getContractAt("MAPriceOracle", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD");
  let price = Number(await oracle.getPriceUnsafe());
  console.log("Start:", price / 1e6);

  const target = 900000;
  const steps = [];
  let p = price;
  while (p < target * 0.99) {
    p = Math.min(Math.round(p * 1.10), target);
    steps.push(p);
  }
  console.log("Steps needed:", steps.length, "→", steps.map(s => (s/1e6).toFixed(3)).join(", "));

  for (const next of steps) {
    try {
      console.log("  Setting", next / 1e6, "...");
      const tx = await oracle.updatePrice(next, { gasLimit: 200000 });
      await tx.wait();
      console.log("  ✅");
      // Wait 3 seconds between updates (cooldown)
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      console.log("  ❌ Failed at", next / 1e6, "- trying wait...");
      await new Promise(r => setTimeout(r, 10000));
      try {
        const tx2 = await oracle.updatePrice(next, { gasLimit: 200000 });
        await tx2.wait();
        console.log("  ✅ retry OK");
      } catch (e2) {
        console.log("  ❌ Still failed, stopping");
        break;
      }
    }
  }

  const final = Number(await oracle.getPriceUnsafe()) / 1e6;
  console.log("Final:", final);

  // Sync DB
  const { Client } = require("pg");
  const c = new Client({ connectionString: "postgresql://postgres:onelong53541314@db.enedbksmftcgtszrkppc.supabase.co:5432/postgres" });
  await c.connect();
  await c.query("UPDATE system_config SET value = $1 WHERE key = 'MA_TOKEN_PRICE'", [final.toFixed(6)]);
  console.log("DB synced:", final.toFixed(6));
  await c.end();
}
main().catch(console.error);
