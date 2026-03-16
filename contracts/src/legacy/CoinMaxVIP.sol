// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CoinMax VIP
/// @notice Accepts USDT/USDC payments for VIP subscriptions. Status tracking is off-chain.
contract CoinMaxVIP is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Whitelisted payment tokens (USDT, USDC)
    mapping(address => bool) public allowedTokens;

    struct VIPPlan {
        uint256 price; // 18 decimals for BSC
        bool active;
    }

    mapping(string => VIPPlan) public vipPlans;

    event VIPSubscribed(
        address indexed payer,
        string planLabel,
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );
    event TokenAllowed(address indexed token, bool allowed);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    /// @param _usdt USDT token address
    /// @param _usdc USDC token address
    constructor(address _usdt, address _usdc) Ownable(msg.sender) {
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");

        allowedTokens[_usdt] = true;
        allowedTokens[_usdc] = true;
        emit TokenAllowed(_usdt, true);
        emit TokenAllowed(_usdc, true);

        // Initialize VIP plans (18 decimals for BSC USDT/USDC)
        vipPlans["monthly"]  = VIPPlan(49 * 1e18, true);    // $49/month
        vipPlans["halfyear"] = VIPPlan(249 * 1e18, true);   // $249/half-year
    }

    /// @notice Subscribe to VIP with chosen payment token
    /// @param planLabel "monthly" or "halfyear"
    /// @param token Payment token address (USDT or USDC)
    function subscribe(string calldata planLabel, address token) external nonReentrant {
        require(allowedTokens[token], "Token not allowed");
        VIPPlan storage plan = vipPlans[planLabel];
        require(plan.price > 0 && plan.active, "Invalid VIP plan");

        IERC20(token).safeTransferFrom(msg.sender, address(this), plan.price);

        emit VIPSubscribed(msg.sender, planLabel, token, plan.price, block.timestamp);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setPlan(string calldata planLabel, uint256 price, bool active) external onlyOwner {
        vipPlans[planLabel] = VIPPlan(price, active);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "Invalid token");
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    function withdrawAll(address token, address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "No balance");
        IERC20(token).safeTransfer(to, bal);
        emit Withdrawn(token, to, bal);
    }

    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
