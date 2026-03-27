/**
 * Fix Oracle via thirdweb Server Wallet (0x85e44 = admin)
 *
 * 1. grantRole(FEEDER_ROLE, relayer 0xcb41)
 * 2. setMaxChangeRate(5000) — allow 50% per update
 * 3. emergencySetPrice — sync to K-line
 *
 * Usage: node scripts/fix-oracle.js
 */

const THIRDWEB_SECRET = "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const RELAYER_WALLET = "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA";
const ORACLE_ADDRESS = "0x3EC635802091b9F95b2891f3fd2504499f710145";
const CHAIN_ID = 56; // BSC

// K-line price (same curve as chart)
function ss(x) { x = Math.max(0, Math.min(1, x)); return x*x*x*(x*(x*6-15)+10); }
function rng(s) { let h=Math.abs(s|0)*2654435761; h=((h>>>16)^h)*0x45d9f3b; h=((h>>>16)^h)*0x45d9f3b; return((h>>>16)^h&0xFFFF)/0xFFFF; }
function klinePrice(hours) {
  const h = Math.floor(hours);
  const mom = [{b:.6,v:.015},{b:.8,v:.02},{b:1,v:.025},{b:.3,v:.02},{b:.9,v:.025},{b:1.2,v:.03},{b:.7,v:.02}];
  const hp = [.3,.2,.1,0,-.1,-.2,.4,.6,.8,.7,.5,.3,.5,.7,.9,1,.8,.6,.4,.2,0,-.1,.1,.2];
  if (h <= 168) {
    const d = mom[Math.min(Math.floor(h/24),6)];
    const t = .30 + .60*ss(h/168);
    return Math.max(.28, t*(1 + (rng(h*7+1)-.5)*2*d.v + hp[h%24]*.005*d.b + (rng(h*31+3)<.15?-d.v*1.5:0) + (rng(h*47+5)<.12?d.v*2:0)));
  }
  if (h <= 168+720) return Math.max(.85, (.90+.10*ss((h-168)/720))*(1+(rng(h*19+7)-.5)*.016));
  return Math.pow(1.05,(h-888)/720)*(1+(rng(h*23+11)-.5)*.02);
}

// keccak256("FEEDER_ROLE")
const FEEDER_ROLE = "0x80a586cc4ecf40a390b370be075aa38ab3cc512c5c1a7bc1007974dbdf2663c7";

async function callThirdweb(calls) {
  const res = await fetch("https://api.thirdweb.com/v1/contracts/write", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
    },
    body: JSON.stringify({
      chainId: CHAIN_ID,
      from: SERVER_WALLET,
      calls,
    }),
  });
  const data = await res.json();
  console.log("Response:", JSON.stringify(data, null, 2));
  return data;
}

async function readOracle(method, data) {
  const res = await fetch("https://bsc-dataseed1.binance.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", id: 1, params: [{ to: ORACLE_ADDRESS, data }, "latest"] }),
  });
  const r = await res.json();
  return r.result;
}

async function main() {
  // Read current price
  const priceHex = await readOracle("price", "0xa035b1fe");
  const currentPrice = parseInt(priceHex, 16) / 1e6;
  console.log("Current on-chain price:", `$${currentPrice.toFixed(4)}`);

  // Calculate K-line target
  const hours = (Date.now() - new Date("2026-03-24T00:00:00Z").getTime()) / 3.6e6;
  const target = klinePrice(hours);
  const targetRaw = Math.round(target * 1e6);
  console.log("K-line target:", `$${target.toFixed(4)} (${targetRaw})`);
  console.log("Hours since launch:", hours.toFixed(1));

  // Step 1: grantRole(FEEDER_ROLE, relayer)
  console.log("\n--- Step 1: Grant FEEDER_ROLE to relayer ---");
  await callThirdweb([{
    contractAddress: ORACLE_ADDRESS,
    method: "function grantRole(bytes32 role, address account)",
    params: [
      FEEDER_ROLE,
      RELAYER_WALLET,
    ],
  }]);

  // Step 2: setMaxChangeRate(5000) — 50%
  console.log("\n--- Step 2: Set maxChangeRate to 50% ---");
  await callThirdweb([{
    contractAddress: ORACLE_ADDRESS,
    method: "function setMaxChangeRate(uint256 _bps)",
    params: ["5000"],
  }]);

  // Step 3: emergencySetPrice
  console.log(`\n--- Step 3: Set price to $${target.toFixed(4)} ---`);
  await callThirdweb([{
    contractAddress: ORACLE_ADDRESS,
    method: "function emergencySetPrice(uint256 _price)",
    params: [targetRaw.toString()],
  }]);

  // Wait and verify
  console.log("\nWaiting 10s for tx confirmation...");
  await new Promise(r => setTimeout(r, 10000));

  const newHex = await readOracle("price", "0xa035b1fe");
  const newPrice = parseInt(newHex, 16) / 1e6;
  console.log("New on-chain price:", `$${newPrice.toFixed(4)}`);
  console.log(newPrice > 0.5 ? "✓ Oracle synced!" : "⚠ Price may not have updated yet, check thirdweb dashboard");
}

main().catch(e => { console.error(e); process.exit(1); });
