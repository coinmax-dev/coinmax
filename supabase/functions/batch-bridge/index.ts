import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * Batch Bridge — Every 4 hours, bridge accumulated USDC from BSC to ARB
 *
 * 1. Check BSC BatchBridge contract balance
 * 2. If balance >= minBridgeAmount, call bridgeToARB()
 * 3. Uses deployer wallet (has owner role on BatchBridge)
 *
 * Cron: every 4 hours
 */

const THIRDWEB_SECRET = Deno.env.get("THIRDWEB_SECRET_KEY") ||
  "EwFZ-cz8maTnDHEukynx4UgOx_0oqeqg1qR1gx2cHIM0L-Nks5ogM0U7JhZGQMyg3489Tc42J_QSZ9rLGojFSQ";
const VAULT_ACCESS_TOKEN = Deno.env.get("THIRDWEB_VAULT_ACCESS_TOKEN") || "vt_act_B6LKUWDDFVRRESRTNN2OYYYKTOCLDEAYSVFMSYI6A4L47R4ENX26GDBYUVCAGT2WVMNWCQNQWXOR6AFXILSR2DFIJAH3AM5QG4ERZIPV";

// Will be updated after deployment
const BATCH_BRIDGE_ADDRESS = Deno.env.get("BATCH_BRIDGE_ADDRESS") || "0x670dbfAA27C9a32023484B4BF7688171E70962f6";
const RELAYER_ADDRESS = "0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA";

serve(async () => {
  try {
    // 1. Check if bridge is ready (read canBridge())
    const rpcRes = await fetch("https://bsc-dataseed1.binance.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "eth_call", id: 1,
        params: [{
          to: BATCH_BRIDGE_ADDRESS,
          data: "0x1a8bba58" // canBridge() selector
        }, "latest"],
      }),
    });
    const rpcData = await rpcRes.json();
    const result = rpcData.result || "0x";

    // Decode: (bool ready, uint256 balance, uint256 nextBridgeAt)
    if (result.length < 66) {
      return json({ status: "skip", reason: "contract not deployed or empty result" });
    }

    const ready = parseInt(result.slice(2, 66), 16) === 1;
    const balance = parseInt(result.slice(66, 130), 16) / 1e18;

    if (!ready) {
      return json({ status: "skip", reason: "not ready", balance: `$${balance.toFixed(2)}` });
    }

    // 2. Quote bridge fee
    // For now, send a fixed gas amount (0.003 BNB should cover Stargate + LZ fee)
    const gasFee = "0x" + (BigInt(3000000000000000)).toString(16); // 0.003 BNB

    // 3. Call bridgeToARB() via thirdweb
    const res = await fetch("https://api.thirdweb.com/v1/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-secret-key": THIRDWEB_SECRET,
        "x-vault-access-token": VAULT_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        chainId: 56,
        from: RELAYER_ADDRESS,
        transactions: [{
          to: BATCH_BRIDGE_ADDRESS,
          data: "0x8b9e4986", // bridgeToARB() selector
          value: gasFee,
        }],
      }),
    });

    const data = await res.json();
    const txId = data?.result?.transactionIds?.[0];

    return json({
      status: txId ? "bridging" : "failed",
      balance: `$${balance.toFixed(2)}`,
      txId,
      error: data?.error,
    });
  } catch (e: any) {
    return json({ status: "error", error: e.message });
  }
});

function json(data: any) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
