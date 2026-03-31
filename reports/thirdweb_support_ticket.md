# thirdweb Support Ticket

> Contact: coinmax.finance@gmail.com
> Date: 2026-03-31
> Priority: CRITICAL — Funds Recovery

---

**Subject: [URGENT] Engine v2 Dedicated Relayer SIGNING_FAILED on BSC – $13,340 USDC Stuck**

**Please prioritize this as a critical funds recovery issue. I am requesting immediate assistance to either restore signing capability, export the private key, or execute the ownership transfer on my behalf.**

---

Hi thirdweb team,

I have a critical issue with a Dedicated Relayer (Engine v2) that can no longer sign transactions on BSC, resulting in **$13,340 USDC stuck** in smart contracts that only this relayer can access.

## Account Info

| Field | Value |
|-------|-------|
| Contact Email | coinmax.finance@gmail.com |
| Client ID | `a0612a159cd5aeecde69cda291faff38` |
| Relayer Address | `0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA` |
| Chain | BSC (Chain ID 56) |
| Wallet Type | Dedicated Relayer (Engine v2, NOT a v3 Server Wallet) |
| Relayer BNB Balance | 0.0514 BNB (sufficient for gas) |
| Relayer Nonce | 11 (previously sent 11 successful transactions) |
| Relayer Account Type | EOA (no contract code on-chain) |

## Problem

This Dedicated Relayer was **previously functional** on BSC (nonce=11, confirming 11 transactions were successfully signed and sent before). Now ALL signing attempts return:

```
Error: SIGNING_FAILED
Inner: VAULT_ERROR: Enclave error: INVALID_INPUT - Invalid input
```

The wallet is NOT listed in `Engine.getServerWallets()` (which only shows v3 Server Wallets), confirming it is a legacy Engine v2 Dedicated Relayer.

## Stuck Funds

This relayer is the `owner` (Ownable pattern) of two smart contracts on BSC:

| Contract | Address | Stuck Balance |
|----------|---------|---------------|
| NodePool (CoinMaxSplitter) | `0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a` | **$13,290.49 USDC** |
| BatchBridge V1 | `0x670dbfAA27C9a32023484B4BF7688171E70962f6` | **$49.97 USDC** |
| **Total** | | **$13,340.46 USDC** |

Only the `owner` address (`0xcb41...`) can call `transferOwnership()`, `flush()`, or `emergencyWithdraw()` on these contracts. No other address has permission.

## What I've Tried

| # | Method | API/SDK | Result |
|---|--------|---------|--------|
| 1 | `POST /v1/contracts/write` | `from: "0xcb41..."` | ❌ SIGNING_FAILED |
| 2 | `POST /v1/transactions` | `from: "0xcb41..."` | ❌ SIGNING_FAILED |
| 3 | contracts/write with `signerType: "eoa"` | | ❌ SIGNING_FAILED |
| 4 | contracts/write with `executionOptions.type: "legacy"` | | ❌ SIGNING_FAILED |
| 5 | transactions with `type: 0` (legacy tx) | | ❌ SIGNING_FAILED |
| 6 | SDK `Engine.serverWallet({ address: "0xcb41..." })` | | ❌ VAULT_ERROR: INVALID_INPUT |
| 7 | `Engine.getServerWallets()` | | 0xcb41 NOT in list (only 4 v3 wallets) |

### Full Error from SDK

```json
{
  "errorCode": "SIGNING_FAILED",
  "innerError": {
    "type": "VAULT_ERROR",
    "message": "Enclave error: INVALID_INPUT - Invalid input - details: {\"address\":\"0xcb41f3c3ed6c255f57cda1ba3fd42389b0f0f0aa\"...}"
  }
}
```

## Request

Any of these would resolve the issue:

### Option A: Restore Signing
Fix the vault/enclave so `0xcb41` can sign transactions on BSC (Chain 56) again, as it previously did (11 successful transactions).

### Option B: Export Private Key
Export the private key of the Dedicated Relayer `0xcb41` so I can sign locally using ethers.js/Hardhat.

### Option C: Execute Transactions on My Behalf

**Transaction 1 — NodePool:**
```
Contract: 0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a
Chain: BSC (56)
From: 0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA
Function: transferOwnership(address newOwner)
Parameter: 0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1
```

**Transaction 2 — BatchBridge V1:**
```
Contract: 0x670dbfAA27C9a32023484B4BF7688171E70962f6
Chain: BSC (56)
From: 0xcb41F3C3eD6C255F57Cda1bA3fd42389B0f0F0aA
Function: transferOwnership(address newOwner)
Parameter: 0x1B6B492d8fbB8ded7dC6E1D48564695cE5BCB9b1
```

These two transactions would transfer contract ownership to my deployer wallet (`0x1B6B...`), allowing me to withdraw the stuck USDC myself.

## Contract ABIs (for reference)

```solidity
// Both contracts (Ownable pattern)
function transferOwnership(address newOwner) external;
function owner() external view returns (address);

// NodePool additional
function flush() external;
function emergencyWithdraw(address token, address to, uint256 amount) external;

// BatchBridge additional
function emergencyWithdraw(address token, address to, uint256 amount) external;
```

## On-Chain Verification

Anyone can verify on BSCScan:
- NodePool owner: https://bscscan.com/address/0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a#readContract → `owner()` returns `0xcb41...`
- NodePool USDC: https://bscscan.com/token/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d?a=0x7dE393D02C153cF943E0cf30C7B2B7A073E5e75a
- BatchBridge owner: https://bscscan.com/address/0x670dbfAA27C9a32023484B4BF7688171E70962f6#readContract → `owner()` returns `0xcb41...`

Thank you for your urgent assistance. Please reply to coinmax.finance@gmail.com.
