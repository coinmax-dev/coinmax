/**
 * Reconcile on-chain Vault Deposited events vs database records.
 * Uses BSC RPC with rate limiting.
 */
const { ethers } = require("ethers");

const VAULT_ADDRESS = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
const SUPABASE_URL = "https://enedbksmftcgtszrkppc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3OTMxMjAsImV4cCI6MjA4OTM2OTEyMH0.B1cyUgbpV5JopebVHlLWCnwRwhqa0TRICRB9btQ23vU";

const VAULT_ABI = [
  "event Deposited(address indexed user, uint256 cUsdAmount, uint256 shares, uint256 maAmount, uint256 planIndex, uint256 stakeIndex, uint256 timestamp)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed2.defibit.io");
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

  const currentBlock = await provider.getBlockNumber();
  const blocksPerDay = (24 * 60 * 60) / 3;
  const fromBlock = currentBlock - Math.floor(blocksPerDay * 90);

  console.log(`Vault: ${VAULT_ADDRESS}`);
  console.log(`Scanning blocks ${fromBlock} to ${currentBlock} (~90 days)\n`);

  // Use larger chunks (50k) with retry + delay
  const CHUNK = 50000;
  const allEvents = [];
  let errorCount = 0;

  for (let start = fromBlock; start <= currentBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, currentBlock);
    const pct = (((start - fromBlock) / (currentBlock - fromBlock)) * 100).toFixed(0);
    process.stdout.write(`\r  Scanning ${pct}% (block ${start})...`);

    let retries = 3;
    while (retries > 0) {
      try {
        const events = await vault.queryFilter("Deposited", start, end);
        allEvents.push(...events);
        break;
      } catch (e) {
        retries--;
        if (retries === 0) {
          errorCount++;
          console.log(`\n  ERROR block ${start}-${end}: ${e.message.slice(0, 80)}`);
        }
        await sleep(2000);
      }
    }
    await sleep(500); // rate limit between requests
  }

  console.log(`\r  Scanning 100% done.                    `);
  console.log(`\nFound ${allEvents.length} on-chain Deposited events (${errorCount} chunk errors)\n`);

  if (allEvents.length === 0 && errorCount === 0) {
    console.log("No on-chain deposits found in the last 90 days.");
    // Still check DB
  }

  const onChainDeposits = allEvents.map((ev) => ({
    txHash: ev.transactionHash.toLowerCase(),
    user: ev.args[0].toLowerCase(),
    cUsdAmount: ethers.formatUnits(ev.args[1], 18),
    shares: ethers.formatUnits(ev.args[2], 18),
    maAmount: ethers.formatUnits(ev.args[3], 18),
    planIndex: Number(ev.args[4]),
    stakeIndex: Number(ev.args[5]),
    timestamp: new Date(Number(ev.args[6]) * 1000).toISOString(),
    blockNumber: ev.blockNumber,
  }));

  if (onChainDeposits.length > 0) {
    console.log("=== ALL ON-CHAIN DEPOSITS ===");
    for (const d of onChainDeposits) {
      console.log(`  [${d.timestamp}] ${d.user} | ${d.cUsdAmount} USDT | Plan ${d.planIndex} | Stake ${d.stakeIndex} | TX: ${d.txHash}`);
    }
    console.log("");
  }

  // 2. Fetch DB records
  console.log("Fetching database records...");
  const [txRes, posRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/transactions?type=eq.VAULT_DEPOSIT&select=tx_hash,amount,created_at&limit=1000`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    }),
    fetch(`${SUPABASE_URL}/rest/v1/vault_positions?select=id,user_id,principal,plan_type,status,created_at&limit=1000`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    }),
  ]);

  const dbTxns = await txRes.json();
  const dbPositions = await posRes.json();

  const dbArray = Array.isArray(dbTxns) ? dbTxns : [];
  const posArray = Array.isArray(dbPositions) ? dbPositions : [];

  console.log(`  DB transactions (VAULT_DEPOSIT): ${dbArray.length}`);
  console.log(`  DB vault_positions: ${posArray.length}\n`);

  if (!Array.isArray(dbTxns)) {
    console.log("  DB transactions response:", JSON.stringify(dbTxns, null, 2));
  }
  if (!Array.isArray(dbPositions)) {
    console.log("  DB positions response:", JSON.stringify(dbPositions, null, 2));
  }

  // Print DB records
  if (dbArray.length > 0) {
    console.log("=== DB VAULT_DEPOSIT TRANSACTIONS ===");
    for (const t of dbArray) {
      console.log(`  [${t.created_at}] ${t.amount} USDT | TX: ${t.tx_hash}`);
    }
    console.log("");
  }

  if (posArray.length > 0) {
    console.log("=== DB VAULT_POSITIONS ===");
    for (const p of posArray) {
      console.log(`  [${p.created_at}] ${p.principal} USDT | ${p.plan_type} | ${p.status} | user: ${p.user_id}`);
    }
    console.log("");
  }

  // 3. Compare
  const dbTxHashSet = new Set(dbArray.map((t) => t.tx_hash?.toLowerCase()));
  const missing = onChainDeposits.filter((d) => !dbTxHashSet.has(d.txHash));

  if (missing.length === 0) {
    console.log("=== No missing deposits - all on-chain txns are in DB ===");
  } else {
    console.log(`\n*** FOUND ${missing.length} ON-CHAIN DEPOSITS NOT IN DATABASE ***\n`);
    for (const d of missing) {
      console.log(`  TX:         ${d.txHash}`);
      console.log(`  User:       ${d.user}`);
      console.log(`  Amount:     ${d.cUsdAmount} USDT`);
      console.log(`  MA Minted:  ${d.maAmount}`);
      console.log(`  Plan Index: ${d.planIndex}`);
      console.log(`  Stake Idx:  ${d.stakeIndex}`);
      console.log(`  Time:       ${d.timestamp}`);
      console.log(`  Block:      ${d.blockNumber}`);
      console.log("  ---");
    }
  }

  // 4. Reverse check
  const onChainHashSet = new Set(onChainDeposits.map((d) => d.txHash));
  const dbOnly = dbArray.filter((t) => t.tx_hash && !onChainHashSet.has(t.tx_hash.toLowerCase()));
  if (dbOnly.length > 0) {
    console.log(`\n*** ${dbOnly.length} DB RECORDS WITH NO ON-CHAIN MATCH ***`);
    for (const t of dbOnly) {
      console.log(`  TX: ${t.tx_hash} | ${t.amount} USDT | ${t.created_at}`);
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`On-chain deposits:  ${onChainDeposits.length}`);
  console.log(`DB transactions:    ${dbArray.length}`);
  console.log(`DB positions:       ${posArray.length}`);
  console.log(`Missing from DB:    ${missing.length}`);
  console.log(`DB-only (no chain): ${dbOnly.length}`);
  console.log(`Chunk scan errors:  ${errorCount}`);
}

main().catch(console.error);
