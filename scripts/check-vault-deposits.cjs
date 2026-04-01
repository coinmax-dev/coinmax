/**
 * Reconcile on-chain Vault Deposited events vs database records.
 * Usage: node scripts/check-vault-deposits.cjs
 */
const { ethers } = require("ethers");

const VAULT_ADDRESS = "0xE0A80b82F42d009cdE772d5c34b1682C2D79e821";
const SUPABASE_URL = "https://enedbksmftcgtszrkppc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVuZWRia3NtZnRjZ3RzenJrcHBjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3OTMxMjAsImV4cCI6MjA4OTM2OTEyMH0.B1cyUgbpV5JopebVHlLWCnwRwhqa0TRICRB9btQ23vU";

const VAULT_ABI = [
  "event Deposited(address indexed user, uint256 cUsdAmount, uint256 shares, uint256 maAmount, uint256 planIndex, uint256 stakeIndex, uint256 timestamp)",
];

async function main() {
  // 1. Fetch all on-chain Deposited events
  const provider = new ethers.JsonRpcProvider("https://bsc-dataseed1.binance.org");
  const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

  // Get contract deployment block (search from a reasonable starting block)
  // We'll search last ~60 days worth of blocks (~3s per block on BSC)
  const currentBlock = await provider.getBlockNumber();
  const blocksPerDay = (24 * 60 * 60) / 3;
  const fromBlock = currentBlock - Math.floor(blocksPerDay * 90); // 90 days back

  console.log(`Scanning Deposited events from block ${fromBlock} to ${currentBlock}...`);
  console.log(`Vault contract: ${VAULT_ADDRESS}\n`);

  // Query in chunks of 5000 blocks (BSC limit)
  const CHUNK = 5000;
  const allEvents = [];
  for (let start = fromBlock; start <= currentBlock; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, currentBlock);
    try {
      const events = await vault.queryFilter("Deposited", start, end);
      allEvents.push(...events);
    } catch (e) {
      console.error(`Error querying blocks ${start}-${end}: ${e.message}`);
    }
  }

  console.log(`Found ${allEvents.length} on-chain Deposited events\n`);

  if (allEvents.length === 0) {
    console.log("No on-chain deposits found. Done.");
    return;
  }

  // Parse events
  const onChainDeposits = allEvents.map((ev) => ({
    txHash: ev.transactionHash,
    user: ev.args[0].toLowerCase(),
    cUsdAmount: ethers.formatUnits(ev.args[1], 18),
    shares: ethers.formatUnits(ev.args[2], 18),
    maAmount: ethers.formatUnits(ev.args[3], 18),
    planIndex: Number(ev.args[4]),
    stakeIndex: Number(ev.args[5]),
    timestamp: new Date(Number(ev.args[6]) * 1000).toISOString(),
    blockNumber: ev.blockNumber,
  }));

  // 2. Fetch all vault-related transactions from database
  const txHashes = onChainDeposits.map((d) => d.txHash);

  // Query transactions table for VAULT_DEPOSIT type
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?type=eq.VAULT_DEPOSIT&select=tx_hash,amount,created_at`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  const dbTxns = await res.json();
  console.log(`Found ${dbTxns.length} VAULT_DEPOSIT records in database\n`);

  const dbTxHashSet = new Set(
    (Array.isArray(dbTxns) ? dbTxns : []).map((t) => t.tx_hash?.toLowerCase())
  );

  // 3. Find mismatches
  const missing = onChainDeposits.filter(
    (d) => !dbTxHashSet.has(d.txHash.toLowerCase())
  );

  if (missing.length === 0) {
    console.log("ALL on-chain deposits are recorded in database. No gaps found.");
  } else {
    console.log(`\n*** FOUND ${missing.length} ON-CHAIN DEPOSITS NOT IN DATABASE ***\n`);
    for (const d of missing) {
      console.log(`  TX: ${d.txHash}`);
      console.log(`  User: ${d.user}`);
      console.log(`  Amount: ${d.cUsdAmount} USDT`);
      console.log(`  MA Minted: ${d.maAmount}`);
      console.log(`  Plan Index: ${d.planIndex}`);
      console.log(`  Stake Index: ${d.stakeIndex}`);
      console.log(`  Time: ${d.timestamp}`);
      console.log(`  Block: ${d.blockNumber}`);
      console.log("  ---");
    }
  }

  // 4. Also check reverse: DB records with no on-chain match
  const onChainHashSet = new Set(onChainDeposits.map((d) => d.txHash.toLowerCase()));
  const dbOnly = (Array.isArray(dbTxns) ? dbTxns : []).filter(
    (t) => t.tx_hash && !onChainHashSet.has(t.tx_hash.toLowerCase())
  );
  if (dbOnly.length > 0) {
    console.log(`\n*** FOUND ${dbOnly.length} DB RECORDS WITH NO ON-CHAIN MATCH ***\n`);
    for (const t of dbOnly) {
      console.log(`  TX: ${t.tx_hash}, Amount: ${t.amount}, Created: ${t.created_at}`);
    }
  }
}

main().catch(console.error);
