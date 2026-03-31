---
name: feedback_no_relayer_owner
description: Never set thirdweb relayer/server wallet as contract owner. Always use deployer EOA. $13K stuck due to relayer signing failure.
type: feedback
---

Never use thirdweb Server Wallet or Dedicated Relayer as contract owner/admin.

**Why:** 0xcb41 (Dedicated Relayer) was set as owner of NodePool + BatchBridge. Relayer's enclave key became inaccessible → $13,340 USDC permanently stuck. thirdweb cannot export private keys.

**How to apply:**
- All contract `owner` / `DEFAULT_ADMIN_ROLE` → deployer EOA (self-custody private key)
- Server Wallets only get operational roles (MINTER, ENGINE, OPERATOR) — never ADMIN/owner
- Factory contract owner → deployer EOA or multisig
- If deployer private key is lost, contracts are still upgradeable via Timelock
- Test environment credentials ≠ production credentials
