// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Protocol Treasury
/// @notice ALL funds enter here, then 100% bridge to HyperLiquid Vault.
///
///  Flow:
///   1. User USDT → SwapRouter → cUSDT → mint MA (locked)
///   2. USDT 100% → ProtocolTreasury (this contract)
///   3. 100% → HL bridge wallet → HyperLiquid Vault (we are Leader)
///   4. From HL Vault: withdraw 50% back → management wallet (fund-allocation)
///   5. Remaining 50% stays in HL Vault → AI strategy trading
///
///   User USDT
///     │
///     ▼
///   ProtocolTreasury ──100%──▸ HL Bridge ──▸ HyperLiquid Vault
///                                                │
///                                          ┌─────┴─────┐
///                                         50%         50%
///                                       withdraw     stays
///                                          │           │
///                                          ▼           ▼
///                                    Management    AI Trading
///                                    (fund-alloc)  (strategy)
contract ProtocolTreasury is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public usdt;
    IERC20 public usdc;

    /// @notice Authorized depositors (NodesV2, VaultV2, SwapRouter)
    mapping(address => bool) public authorizedDepositors;

    /// @notice Wallet that bridges funds to HyperLiquid (receives 100%)
    address public hlBridgeWallet;

    // ─── Accounting ─────────────────────────────────────────────────────

    uint256 public totalDeposited;
    uint256 public totalBridged;

    enum SourceType { NODE, VAULT, OTHER }

    struct DepositRecord {
        address source;
        SourceType sourceType;
        uint256 amount;
        address token;
        uint256 timestamp;
    }

    DepositRecord[100] public depositLog;
    uint256 public depositLogIndex;
    mapping(address => uint256) public cumulativeDeposits;

    // ─── Events ─────────────────────────────────────────────────────────

    event FundsDeposited(address indexed source, SourceType sourceType, address indexed token, uint256 amount, uint256 timestamp);
    event BridgedToHL(uint256 amount, address indexed token, uint256 timestamp);

    // ─── Constructor ────────────────────────────────────────────────────

    constructor(
        address _usdt,
        address _usdc,
        address _hlBridgeWallet
    ) Ownable(msg.sender) {
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");
        require(_hlBridgeWallet != address(0), "Invalid HL bridge");

        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        hlBridgeWallet = _hlBridgeWallet;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  DEPOSIT — 100% in from NodesV2/VaultV2
    // ═══════════════════════════════════════════════════════════════════

    function deposit(address token, uint256 amount, SourceType sourceType) external whenNotPaused {
        require(authorizedDepositors[msg.sender], "Not authorized");
        require(amount > 0, "Zero amount");
        require(token == address(usdt) || token == address(usdc), "Invalid token");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        totalDeposited += amount;
        cumulativeDeposits[msg.sender] += amount;

        depositLog[depositLogIndex % 100] = DepositRecord({
            source: msg.sender, sourceType: sourceType,
            amount: amount, token: token, timestamp: block.timestamp
        });
        depositLogIndex++;

        emit FundsDeposited(msg.sender, sourceType, token, amount, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  BRIDGE — 100% to HyperLiquid
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Send 100% to HL bridge wallet → HyperLiquid Vault
    function bridgeToHL(address token, uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(amount > 0 && amount <= IERC20(token).balanceOf(address(this)), "Invalid");
        require(token == address(usdt) || token == address(usdc), "Invalid token");

        IERC20(token).safeTransfer(hlBridgeWallet, amount);
        totalBridged += amount;

        emit BridgedToHL(amount, token, block.timestamp);
    }

    /// @notice Bridge all current balance to HL
    function bridgeAllToHL(address token) external onlyOwner nonReentrant whenNotPaused {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "No balance");
        require(token == address(usdt) || token == address(usdc), "Invalid token");

        IERC20(token).safeTransfer(hlBridgeWallet, bal);
        totalBridged += bal;

        emit BridgedToHL(bal, token, block.timestamp);
    }

    // ─── View ───────────────────────────────────────────────────────────

    function usdtBalance() external view returns (uint256) { return usdt.balanceOf(address(this)); }
    function usdcBalance() external view returns (uint256) { return usdc.balanceOf(address(this)); }

    function getStats() external view returns (
        uint256 _usdtBal, uint256 _usdcBal,
        uint256 _totalDeposited, uint256 _totalBridged, uint256 _depositCount
    ) {
        return (
            usdt.balanceOf(address(this)), usdc.balanceOf(address(this)),
            totalDeposited, totalBridged, depositLogIndex
        );
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setHLBridgeWallet(address _w) external onlyOwner {
        require(_w != address(0), "Invalid"); hlBridgeWallet = _w;
    }

    function setAuthorizedDepositor(address _d, bool _auth) external onlyOwner {
        require(_d != address(0), "Invalid"); authorizedDepositors[_d] = _auth;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }
}
