# CoinMax Contracts - Deployment Guide

## Architecture Overview

```
User (approve USDT/USDC)
     |
     v
+------------------+    USDT/USDC     +---------------------+
|  CoinMaxNodes    | ----------------> | CoinMaxFundManager  |
|  (Node purchase) |                   | (Fund distribution) |
|  MINI: $100      |                   |  50/50 split        |
|  MAX:  $600      |                   +---------------------+
+------------------+
                                       +---------------------+
+------------------+    USDT/USDC      | CoinMaxFundManager  |
|  CoinMaxVault   | ----------------> | (same or separate)  |
|  (Staking entry) |                   +---------------------+
|                  |
|  1. Receive USD  |   mintTo()    +-------------------------+
|  2. Mint MA      | -----------> |   MA Token (thirdweb)   |
|  3. Auto-stake   |              |   TokenDrop (ERC20)     |
|  4. Interest     |              |   Price set in dashboard|
+--------+---------+              +-----------+-------------+
         |                                    |
         | interest mintTo()                  | burn()
         | + addAccumulated()                 |
         v                                    |
+------------------+                          |
| CoinMaxRelease   |--------------------------+
| (Interest claim) |
|                  |
| Instant:  -20%   |
| 7-day:    -15%   |
| 15-day:   -10%   |
| 30-day:   -5%    |
| 60-day:   0%     |
+------------------+

+------------------+
|  CoinMaxVIP      |  (VIP subscriptions, standalone)
+------------------+
```

## Contract List

| Contract            | File                    | Description                          |
|---------------------|-------------------------|--------------------------------------|
| MA Token            | thirdweb TokenDrop      | ERC20 token, mint price via dashboard|
| CoinMaxFundManager  | CoinMaxFundManager.sol  | Receives payments, splits to wallets |
| CoinMaxNodes        | CoinMaxNodes.sol        | Node purchase (MINI $100 / MAX $600) |
| CoinMaxVault        | CoinMaxVault.sol        | USDT/USDC deposit -> MA staking      |
| CoinMaxRelease      | CoinMaxRelease.sol      | Interest release with burn tiers     |
| CoinMaxVIP          | CoinMaxVIP.sol          | VIP subscription payments            |

## Deployment Order (IMPORTANT)

Deploy in this exact order on **opBNB (Chain ID: 204)**:

### Step 1: MA Token (thirdweb Dashboard)

1. Go to thirdweb dashboard -> Deploy -> Token Drop
2. Set token name: `MA`, symbol: `MA`, decimals: `18`
3. Deploy on opBNB
4. Set claim conditions (mint price) in dashboard
5. **Save the contract address** -> `MA_TOKEN_ADDRESS`

### Step 2: CoinMaxFundManager

Constructor params:
```
_usdt: <USDT address on opBNB>
_usdc: <USDC address on opBNB>
```

After deploy, call `setRecipients`:
```
_wallets: ["0xWallet1", "0xWallet2"]
_shares:  [5000, 5000]   // 50% each, must total 10000
```

**Save the contract address** -> `FUND_MANAGER_ADDRESS`

### Step 3: CoinMaxRelease

Constructor params:
```
_maToken:       <MA_TOKEN_ADDRESS>
_vaultContract: <use your deployer address as placeholder, update after Step 4>
```

**Save the contract address** -> `RELEASE_ADDRESS`

### Step 4: CoinMaxVault

Constructor params:
```
_maToken:          <MA_TOKEN_ADDRESS>
_releaseContract:  <RELEASE_ADDRESS>
_fundDistributor:  <FUND_MANAGER_ADDRESS>
_maPrice:          100000          (= $0.10 in 6 decimals, adjust as needed)
_usdt:             <USDT address on opBNB>
_usdc:             <USDC address on opBNB>
```

**Save the contract address** -> `VAULT_ADDRESS`

### Step 5: CoinMaxNodes

Constructor params:
```
_fundDistributor: <FUND_MANAGER_ADDRESS>
_usdt:            <USDT address on opBNB>
_usdc:            <USDC address on opBNB>
```

Already deployed at: `0x941C3A9459cEe89644996d48A640544DA202ae35`

### Step 6: CoinMaxVIP

Constructor params:
```
_usdc: <USDC address on opBNB>
```

## Post-Deployment Configuration

### 6.1 Update CoinMaxRelease vault address

On CoinMaxRelease, call:
```
setVaultContract(<VAULT_ADDRESS>)
```

### 6.2 Grant MINTER_ROLE on MA Token

On the MA TokenDrop (thirdweb dashboard -> Permissions):
- Grant **Minter** role to `VAULT_ADDRESS` (mints staking principal + interest)

### 6.3 Authorize source on FundManager (optional)

On CoinMaxFundManager, call:
```
setAuthorizedSource(<VAULT_ADDRESS>, true)
setAuthorizedSource(<NODE_ADDRESS>, true)
```

## Staking Plans

| Index | Duration | Interest Rate | Default |
|-------|----------|---------------|---------|
| 0     | 15 days  | 0.5%          | Active  |
| 1     | 45 days  | 0.7%          | Active  |
| 2     | 90 days  | 0.9%          | Active  |
| 3     | 180 days | 1.1%          | Active  |
| 4     | 360 days | 1.3%          | Active  |

Adjust via `updatePlan(index, duration, interestRate, active)` on CoinMaxVault.

## Release Plans (Burn Tiers)

| Index | Release Period | Burn Rate | Description        |
|-------|---------------|-----------|---------------------|
| 0     | Instant       | 20%       | Immediate, burn 20% |
| 1     | 7 days        | 15%       | Linear over 7 days  |
| 2     | 15 days       | 10%       | Linear over 15 days |
| 3     | 30 days       | 5%        | Linear over 30 days |
| 4     | 60 days       | 0%        | No burn             |

Adjust via `updateReleasePlan(index, burnRate, duration, active)` on CoinMaxRelease.

## Frontend Environment Variables

```env
VITE_NODE_CONTRACT_ADDRESS=0x941C3A9459cEe89644996d48A640544DA202ae35
VITE_VAULT_CONTRACT_ADDRESS=<VAULT_ADDRESS>
VITE_VIP_CONTRACT_ADDRESS=<VIP_ADDRESS>
VITE_VIP_RECEIVER_ADDRESS=<VIP_RECEIVER_WALLET>
VITE_USDT_ADDRESS=<USDT on opBNB>
VITE_USDC_ADDRESS=<USDC on opBNB>
```

## Security Checklist

- [ ] MA Token: only Vault has MINTER_ROLE
- [ ] CoinMaxRelease: `vaultContract` set to correct Vault address
- [ ] CoinMaxVault: `fundDistributor` set to FundManager address
- [ ] CoinMaxNodes: `fundDistributor` set to FundManager address
- [ ] FundManager: `recipients` and `shares` configured correctly (sum = 10000)
- [ ] All contracts: test `pause()` / `unpause()` works
- [ ] All contracts: verify `owner()` is the correct admin wallet
- [ ] No funds are held in Vault or Nodes contracts (forwarded to FundManager)

## Admin Operations

### Change MA mint price
```
CoinMaxVault.setMAPrice(newPrice)   // 6 decimals, e.g. 200000 = $0.20
```

### Change node prices
```
CoinMaxNodes.setPlan("MINI", 200000000, true)   // $200
CoinMaxNodes.setPlan("MAX", 1200000000, true)   // $1200
```

### Distribute funds
```
CoinMaxFundManager.distribute(<token_address>)
```

### Emergency pause
```
CoinMaxVault.pause()
CoinMaxRelease.pause()
CoinMaxNodes.pause()
```

## Thirdweb Deploy Command

```bash
npx thirdweb deploy -k <YOUR_API_KEY> --contract-name <ContractName> --ci
```
