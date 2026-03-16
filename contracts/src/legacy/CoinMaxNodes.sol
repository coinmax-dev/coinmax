// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CoinMax Nodes
/// @notice Accepts USDT/USDC payments for node memberships (MINI / MAX).
///         Funds are forwarded directly to a fund distribution contract.
///         Backend listens to NodePurchased events for callback processing.
contract CoinMaxNodes is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice Fund distribution contract address where all payments are forwarded
    address public fundDistributor;

    /// @notice Whitelisted payment tokens (USDT, USDC, etc.)
    mapping(address => bool) public allowedTokens;

    struct NodePlan {
        uint256 price; // token amount (6 decimals for USDT/USDC)
        bool active;
    }

    /// @notice Node plans: "MINI" => small node ($1,000), "MAX" => large node ($6,000)
    mapping(string => NodePlan) public nodePlans;

    /// @notice Purchase counter for unique order tracking
    uint256 public purchaseCount;

    // ─── Events (backend callback via event listener) ───────────────────

    /// @notice Emitted on every successful node purchase
    event NodePurchased(
        uint256 indexed purchaseId,
        address indexed payer,
        string nodeType,
        address token,
        uint256 amount,
        uint256 timestamp
    );

    event FundDistributorUpdated(address indexed oldAddr, address indexed newAddr);
    event TokenAllowed(address indexed token, bool allowed);
    event PlanUpdated(string nodeType, uint256 price, bool active);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _fundDistributor Fund distribution contract address
    /// @param _usdt USDT token address
    /// @param _usdc USDC token address
    constructor(
        address _fundDistributor,
        address _usdt,
        address _usdc
    ) Ownable(msg.sender) {
        require(_fundDistributor != address(0), "Invalid distributor");
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");

        fundDistributor = _fundDistributor;

        // Whitelist payment tokens
        allowedTokens[_usdt] = true;
        allowedTokens[_usdc] = true;
        emit TokenAllowed(_usdt, true);
        emit TokenAllowed(_usdc, true);

        // Initialize node plans (18 decimals for BSC USDT/USDC)
        nodePlans["MINI"] = NodePlan(100 * 1e18, true);  // $100 small node
        nodePlans["MAX"]  = NodePlan(600 * 1e18, true);  // $600 large node
        emit PlanUpdated("MINI", 100 * 1e18, true);
        emit PlanUpdated("MAX", 600 * 1e18, true);
    }

    // ─── Core ───────────────────────────────────────────────────────────

    /// @notice Purchase a node membership with chosen payment token
    /// @param nodeType "MINI" or "MAX"
    /// @param token Payment token address (must be whitelisted USDT/USDC)
    function purchaseNode(
        string calldata nodeType,
        address token
    ) external nonReentrant whenNotPaused {
        require(allowedTokens[token], "Token not allowed");

        NodePlan storage plan = nodePlans[nodeType];
        require(plan.price > 0 && plan.active, "Invalid node type");

        // Funds go directly from payer to fund distribution contract (never held here)
        IERC20(token).safeTransferFrom(msg.sender, fundDistributor, plan.price);

        purchaseCount++;

        emit NodePurchased(
            purchaseCount,
            msg.sender,
            nodeType,
            token,
            plan.price,
            block.timestamp
        );
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /// @notice Update fund distribution contract address
    function setFundDistributor(address _fundDistributor) external onlyOwner {
        require(_fundDistributor != address(0), "Invalid address");
        address old = fundDistributor;
        fundDistributor = _fundDistributor;
        emit FundDistributorUpdated(old, _fundDistributor);
    }

    /// @notice Add or remove a whitelisted payment token
    function setAllowedToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "Invalid token");
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice Update a node plan's price and status
    function setPlan(string calldata nodeType, uint256 price, bool active) external onlyOwner {
        nodePlans[nodeType] = NodePlan(price, active);
        emit PlanUpdated(nodeType, price, active);
    }

    /// @notice Pause contract in emergency
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency: recover tokens accidentally sent to this contract
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }
}
