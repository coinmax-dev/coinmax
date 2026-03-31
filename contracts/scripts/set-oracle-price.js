const { ethers } = require("hardhat");
async function main() {
  const oracle = await ethers.getContractAt("MAPriceOracle", "0xff5Ab71939Fa021A7BCa38Db8b3c1672D1B819dD");
  console.log("Before:", Number(await oracle.getPriceUnsafe()) / 1e6);

  // Try emergencySetPrice (bypasses 10% limit)
  try {
    const tx = await oracle.emergencySetPrice(900000); // $0.90
    await tx.wait();
    console.log("emergencySetPrice OK");
  } catch (e) {
    console.log("emergencySetPrice failed, trying setPrice...");
    try {
      const tx = await oracle.setPrice(900000);
      await tx.wait();
    } catch (e2) {
      console.log("setPrice also failed:", e2.message?.slice(0, 80));
    }
  }

  const final = Number(await oracle.getPriceUnsafe()) / 1e6;
  console.log("After:", final);

  // Also update DB
  const { Client } = require("pg");
  const c = new Client({ connectionString: "postgresql://postgres:onelong53541314@db.enedbksmftcgtszrkppc.supabase.co:5432/postgres" });
  await c.connect();
  await c.query("UPDATE system_config SET value = $1 WHERE key = 'MA_TOKEN_PRICE'", [final.toFixed(6)]);
  console.log("DB MA_TOKEN_PRICE:", final.toFixed(6));
  await c.end();
}
main().catch(console.error);
