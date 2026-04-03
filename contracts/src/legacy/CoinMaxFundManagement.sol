// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CoinMax Fund Management
/// @notice Vault fund management: collect USDC → HL Vault → withdraw → Splitter
///
///  Flow:
///
///   User USDT → SwapRouter → USDC
///     │
///     ├──▸ cUSD(1:1) → MA(1:1) → Lock (user staking)
///     │
///     ▼
///   VaultV2 ── safeTransfer USDC ──▸ FundManagement (this contract)
///     │
///     ▼  Step 1: bridgeToHL()
///   100% USDC ──▸ HL Bridge Wallet ──▸ HyperLiquid Vault
///     │                                     │
///     │                               24h lockup
///     │                                     │
///     ▼  Step 2: recordHLWithdrawal()       ▼
///   USDC returns to FundManagement
///     │
///     ▼  Step 3: forwardToSplitter()
///   100% USDC ──▸ CoinMaxSplitter (private distribution)
///                     │
///                     └─ Splitter.flush() at irregular times
///                        → private splits to N wallets
///                        → no ratio/wallet info on-chain
///
contract CoinMaxFundManagement is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    IERC20 public immutable usdc;

    /// @notice Wallet used to bridge USDC to HyperLiquid
    address public hlBridgeWallet;

    /// @notice Splitter contract that handles private distribution
    address public splitter;

    // ─── Accounting ───────────────────────────────────────────────────

    uint256 public totalReceived;        // cumulative USDC received (via transfer)
    uint256 public totalBridgedToHL;     // cumulative sent to HL
    uint256 public totalWithdrawnFromHL; // cumulative returned from HL
    uint256 public totalForwarded;       // cumulative sent to Splitter

    // ─── HL Cycle Tracking ────────────────────────────────────────────

    uint256 public lastBridgeTime;
    uint256 public pendingInHL;
    uint256 public constant HL_LOCKUP = 24 hours;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS (minimal — no distribution details)
    // ═══════════════════════════════════════════════════════════════════

    event BridgedToHL(uint256 amount, uint256 timestamp);
    event WithdrawnFromHL(uint256 amount, uint256 timestamp);
    event ForwardedToSplitter(uint256 amount, uint256 timestamp);
    event HLBridgeWalletUpdated(address indexed newWallet);
    event SplitterUpdated(address indexed newSplitter);

    // ═══════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    /// @param _usdc USDC token on BSC
    /// @param _hlBridgeWallet Wallet that bridges to HyperLiquid
    /// @param _splitter Splitter contract for private distribution
    constructor(
        address _usdc,
        address _hlBridgeWallet,
        address _splitter
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_hlBridgeWallet != address(0), "Invalid bridge wallet");
        require(_splitter != address(0), "Invalid splitter");

        usdc = IERC20(_usdc);
        hlBridgeWallet = _hlBridgeWallet;
        splitter = _splitter;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  RECEIVE — VaultV2 sends USDC here via safeTransfer (no deposit())
    // ═══════════════════════════════════════════════════════════════════
    //
    //  VaultV2 does: usdc.safeTransfer(fundDistributor, usdcAmount)
    //  This contract is set as fundDistributor in VaultV2.
    //  Funds arrive as plain ERC20 transfers — no function call needed.
    //  We track via balance changes, not deposit events.

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 1: BRIDGE 100% TO HYPERLIQUID VAULT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Send all USDC to HL bridge wallet → HyperLiquid Vault
    function bridgeToHL() external onlyOwner nonReentrant whenNotPaused {
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "No USDC to bridge");

        usdc.safeTransfer(hlBridgeWallet, bal);

        totalBridgedToHL += bal;
        pendingInHL += bal;
        lastBridgeTime = block.timestamp;

        emit BridgedToHL(bal, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 2: RECORD HL WITHDRAWAL (after 24h)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Record funds returned from HyperLiquid vault
    /// @param amount USDC returned (may differ from sent due to P&L)
    function recordHLWithdrawal(uint256 amount) external onlyOwner whenNotPaused {
        require(amount > 0, "Zero amount");
        require(pendingInHL > 0, "Nothing pending in HL");

        totalWithdrawnFromHL += amount;
        pendingInHL = 0;

        emit WithdrawnFromHL(amount, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 3: FORWARD TO SPLITTER (private distribution)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Forward all USDC to Splitter for private distribution
    /// @dev Splitter handles the actual split to wallets — no details here
    function forwardToSplitter() external onlyOwner nonReentrant whenNotPaused {
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "No USDC to forward");
        require(splitter != address(0), "Splitter not set");

        usdc.safeTransfer(splitter, bal);

        totalForwarded += bal;

        emit ForwardedToSplitter(bal, block.timestamp);
    }

    /// @notice Forward a specific amount to Splitter
    function forwardAmount(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0, "Zero amount");
        require(splitter != address(0), "Splitter not set");
        uint256 bal = usdc.balanceOf(address(this));
        require(amount <= bal, "Insufficient balance");

        usdc.safeTransfer(splitter, amount);

        totalForwarded += amount;

        emit ForwardedToSplitter(amount, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setHLBridgeWallet(address _w) external onlyOwner {
        require(_w != address(0), "Invalid");
        hlBridgeWallet = _w;
        emit HLBridgeWalletUpdated(_w);
    }

    function setSplitter(address _s) external onlyOwner {
        require(_s != address(0), "Invalid");
        splitter = _s;
        emit SplitterUpdated(_s);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW
    // ═══════════════════════════════════════════════════════════════════

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function canWithdrawFromHL() external view returns (bool) {
        if (pendingInHL == 0) return false;
        return block.timestamp >= lastBridgeTime + HL_LOCKUP;
    }

    function getStats() external view returns (
        uint256 _balance,
        uint256 _totalBridgedToHL,
        uint256 _totalWithdrawnFromHL,
        uint256 _totalForwarded,
        uint256 _pendingInHL
    ) {
        return (
            usdc.balanceOf(address(this)),
            totalBridgedToHL,
            totalWithdrawnFromHL,
            totalForwarded,
            pendingInHL
        );
    }
}
