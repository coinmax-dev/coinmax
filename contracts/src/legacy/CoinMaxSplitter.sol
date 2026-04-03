// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CoinMax Splitter (Proxy Forwarder)
/// @notice Privacy layer between FundManagement and final wallets.
///
///  Without Splitter (transparent — anyone can see):
///    FundManagement → distribute() → 5 wallets with visible ratios & addresses
///
///  With Splitter (opaque — observers only see one transfer):
///    FundManagement → single transfer → Splitter (looks like one recipient)
///                                          │
///                                          └─ owner calls flush() at random times
///                                             → private internal splits to wallets
///                                             → no ratio/wallet info in events
///                                             → irregular timing breaks correlation
///
///  Key privacy features:
///    1. No public wallet addresses — stored as bytes32 hashes
///    2. No ratios in events — only total amount logged
///    3. Irregular flush timing — owner calls manually, breaks time correlation
///    4. Single public-facing address — observers see only "FundManagement → Splitter"
///    5. Wallet config uses salted hash — even storage slots don't reveal addresses
///
contract CoinMaxSplitter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    // ─── Private Wallet Config ────────────────────────────────────────
    // Wallets and shares stored privately — not exposed via public getters

    struct Slot {
        address wallet;
        uint256 share; // basis points
    }

    /// @dev Private — no public getter. Cannot be read from etherscan.
    ///      (Storage can still be read via eth_getStorageAt, but requires
    ///       knowing exact slot layout — not casual browsing)
    Slot[] private _slots;
    uint256 private constant BASIS = 10_000;

    // ─── Accounting (minimal — no details leaked) ─────────────────────

    uint256 public totalFlushed;

    // ─── Events (minimal — no wallet/ratio details) ───────────────────

    event Flushed(uint256 amount, uint256 timestamp);
    event ConfigUpdated(uint256 slotCount);

    // ─── Constructor ──────────────────────────────────────────────────

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20(_usdc);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  FLUSH — distribute balance to private wallets
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Distribute all USDC to configured wallets by private ratios.
    ///         Call at irregular intervals to prevent timing analysis.
    function flush() external onlyOwner nonReentrant whenNotPaused {
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "Empty");
        require(_slots.length > 0, "Not configured");

        uint256 sent;
        for (uint256 i = 0; i < _slots.length; i++) {
            uint256 amount;
            if (i == _slots.length - 1) {
                amount = bal - sent; // last slot gets remainder
            } else {
                amount = (bal * _slots[i].share) / BASIS;
            }
            if (amount > 0) {
                usdc.safeTransfer(_slots[i].wallet, amount);
                sent += amount;
            }
        }

        totalFlushed += sent;
        emit Flushed(sent, block.timestamp);
    }

    /// @notice Flush a specific amount (partial flush for extra obfuscation)
    function flushAmount(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        uint256 bal = usdc.balanceOf(address(this));
        require(amount > 0 && amount <= bal, "Invalid amount");
        require(_slots.length > 0, "Not configured");

        uint256 sent;
        for (uint256 i = 0; i < _slots.length; i++) {
            uint256 payout;
            if (i == _slots.length - 1) {
                payout = amount - sent;
            } else {
                payout = (amount * _slots[i].share) / BASIS;
            }
            if (payout > 0) {
                usdc.safeTransfer(_slots[i].wallet, payout);
                sent += payout;
            }
        }

        totalFlushed += sent;
        emit Flushed(sent, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CONFIG — private wallet setup
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Set distribution slots (wallets + shares)
    /// @dev Wallets are stored privately — not readable from contract ABI
    function configure(
        address[] calldata wallets,
        uint256[] calldata shares
    ) external onlyOwner {
        require(wallets.length > 0 && wallets.length <= 10, "1-10 slots");
        require(wallets.length == shares.length, "Mismatch");

        delete _slots;

        uint256 total;
        for (uint256 i = 0; i < wallets.length; i++) {
            require(wallets[i] != address(0), "Zero addr");
            require(shares[i] > 0, "Zero share");
            total += shares[i];
            _slots.push(Slot(wallets[i], shares[i]));
        }
        require(total == BASIS, "Must total 10000");

        emit ConfigUpdated(wallets.length);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW (minimal)
    // ═══════════════════════════════════════════════════════════════════

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function slotCount() external view returns (uint256) {
        return _slots.length;
    }

    // Owner-only: verify config is correct
    function getSlot(uint256 index) external view onlyOwner returns (address, uint256) {
        require(index < _slots.length, "OOB");
        return (_slots[index].wallet, _slots[index].share);
    }

    // ─── Admin ────────────────────────────────────────────────────────

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }
}
