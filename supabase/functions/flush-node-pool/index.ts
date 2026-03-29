import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Flush NodePool — Transfer accumulated USDC to node wallet
 * Cron: every 30 minutes
 */

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") ||
  "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";

const NODE_POOL = "0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a";
const SERVER_WALLET = "0x85e44A8Be3B0b08e437B16759357300A4Cd1d95b";
const BSC_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";

serve(async () => {
  // Check balance
  let balance = 0;
  try {
    const r = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BSC_USDC,
          data: "0x70a08231000000000000000000000000" + NODE_POOL.slice(2).toLowerCase(),
        }, "latest"],
      }),
    });
    const d = await r.json();
    balance = parseInt(d.result || "0x0", 16) / 1e18;
  } catch {}

  if (balance < 1) {
    return new Response(JSON.stringify({ status: "skip", balance: `$${balance.toFixed(2)}` }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Call flush() on NodePool
  const res = await fetch("https://api.thirdweb.com/v1/transactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-secret-key": THIRDWEB_SECRET,
      "x-vault-access-token": VAULT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      chainId: 56,
      from: SERVER_WALLET,
      transactions: [{
        to: NODE_POOL,
        data: "0xd6f0948c", // flush() selector
        value: "0",
      }],
    }),
  });

  const data = await res.json();
  const txId = data?.result?.transactionIds?.[0];

  return new Response(JSON.stringify({
    status: txId ? "flushed" : "failed",
    balance: `$${balance.toFixed(2)}`,
    txId,
  }), { headers: { "Content-Type": "application/json" } });
});
