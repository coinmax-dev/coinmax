// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CoinMax VIP
/// @notice Accepts USDC payments for VIP subscriptions (monthly / yearly). Status tracking is off-chain.
contract CoinMaxVIP is Ownable, ReentrancyGuard {
    IERC20 public immutable usdc;

    struct VIPPlan {
        uint256 price; // USDC (6 decimals)
        bool active;
    }

    mapping(string => VIPPlan) public vipPlans;

    event VIPSubscribed(
        address indexed payer,
        string planLabel,
        uint256 amount,
        uint256 timestamp
    );
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address _usdc) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        usdc = IERC20(_usdc);

        // Initialize VIP plans
        vipPlans["monthly"] = VIPPlan(69 * 1e6, true);   // $69/month
        vipPlans["yearly"]  = VIPPlan(899 * 1e6, true);   // $899/year
    }

    /// @notice Subscribe to VIP
    /// @param planLabel "monthly" or "yearly"
    function subscribe(string calldata planLabel) external nonReentrant {
        VIPPlan storage plan = vipPlans[planLabel];
        require(plan.price > 0 && plan.active, "Invalid VIP plan");
        require(usdc.transferFrom(msg.sender, address(this), plan.price), "Transfer failed");
        emit VIPSubscribed(msg.sender, planLabel, plan.price, block.timestamp);
    }

    /// @notice Owner updates a VIP plan price
    function setPlan(string calldata planLabel, uint256 price, bool active) external onlyOwner {
        vipPlans[planLabel] = VIPPlan(price, active);
    }

    /// @notice Owner withdraws funds
    function withdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        require(usdc.transfer(to, amount), "Withdraw failed");
        emit Withdrawn(to, amount);
    }

    function withdrawAll(address to) external onlyOwner {
        require(to != address(0), "Invalid address");
        uint256 bal = usdc.balanceOf(address(this));
        require(bal > 0, "No balance");
        require(usdc.transfer(to, bal), "Withdraw failed");
        emit Withdrawn(to, bal);
    }

    function getBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
