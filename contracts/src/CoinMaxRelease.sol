// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Interface for MA token (thirdweb TokenDrop)
interface IMATokenRelease {
    function transfer(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @title CoinMax Release
/// @notice Manages interest release with burn-based claiming schedules.
///         Users choose release speed — faster release = higher burn rate.
///
///  Schedule     | Burn Rate | Release Period
///  Instant      | 20%       | Immediate
///  7-day linear | 15%       | 7 days
///  15-day       | 10%       | 15 days
///  30-day       | 5%        | 30 days
///  60-day       | 0%        | 60 days
contract CoinMaxRelease is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    IMATokenRelease public maToken;

    /// @notice Authorized vault contract that can add accumulated interest
    address public vaultContract;

    /// @notice User's total accumulated interest (not yet scheduled for release)
    mapping(address => uint256) public accumulated;

    struct ReleasePlan {
        uint256 burnRate;   // basis points (2000 = 20%)
        uint256 duration;   // release period in seconds (0 = instant)
        bool active;
    }

    /// @notice Release plans (index-based)
    ReleasePlan[] public releasePlans;

    struct ReleasePosition {
        uint256 releaseAmount;  // MA to receive (after burn)
        uint256 burnedAmount;   // MA burned
        uint256 startTime;
        uint256 duration;       // 0 = instant (already claimed)
        uint256 claimed;        // amount already claimed
    }

    /// @notice User's release positions
    mapping(address => ReleasePosition[]) public userReleases;

    // ─── Events ─────────────────────────────────────────────────────────

    event AccumulatedAdded(address indexed user, uint256 amount);
    event ReleaseCreated(
        address indexed user,
        uint256 releaseIndex,
        uint256 planIndex,
        uint256 totalAmount,
        uint256 releaseAmount,
        uint256 burnedAmount
    );
    event ReleaseClaimed(address indexed user, uint256 releaseIndex, uint256 amount);
    event ReleasePlanUpdated(uint256 index, uint256 burnRate, uint256 duration, bool active);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _maToken MA token address (thirdweb TokenDrop)
    /// @param _vaultContract CoinMaxVault address
    constructor(
        address _maToken,
        address _vaultContract
    ) Ownable(msg.sender) {
        require(_maToken != address(0), "Invalid MA token");
        require(_vaultContract != address(0), "Invalid vault");

        maToken = IMATokenRelease(_maToken);
        vaultContract = _vaultContract;

        // Default release plans
        releasePlans.push(ReleasePlan(2000, 0,       true));  // Instant: burn 20%
        releasePlans.push(ReleasePlan(1500, 7 days,  true));  // 7-day:   burn 15%
        releasePlans.push(ReleasePlan(1000, 15 days, true));  // 15-day:  burn 10%
        releasePlans.push(ReleasePlan(500,  30 days, true));  // 30-day:  burn 5%
        releasePlans.push(ReleasePlan(0,    60 days, true));  // 60-day:  no burn
    }

    // ─── Vault Interface ────────────────────────────────────────────────

    /// @notice Called by Vault to add accumulated interest for a user
    /// @dev Only callable by authorized vault contract
    function addAccumulated(address user, uint256 amount) external {
        require(msg.sender == vaultContract, "Only vault");
        accumulated[user] += amount;
        emit AccumulatedAdded(user, amount);
    }

    // ─── Core ───────────────────────────────────────────────────────────

    /// @notice Create a release schedule for accumulated interest
    /// @param amount MA amount to release from accumulated balance
    /// @param planIndex Release plan (0=instant, 1=7d, 2=15d, 3=30d, 4=60d)
    function createRelease(
        uint256 amount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Zero amount");
        require(accumulated[msg.sender] >= amount, "Insufficient accumulated");
        require(planIndex < releasePlans.length, "Invalid plan");

        ReleasePlan storage plan = releasePlans[planIndex];
        require(plan.active, "Plan not active");

        // Deduct from accumulated
        accumulated[msg.sender] -= amount;

        // Calculate burn and release amounts
        uint256 burnAmount = (amount * plan.burnRate) / 10000;
        uint256 releaseAmount = amount - burnAmount;

        // Burn MA tokens
        if (burnAmount > 0) {
            maToken.burn(burnAmount);
        }

        uint256 releaseIndex = userReleases[msg.sender].length;

        if (plan.duration == 0) {
            // Instant release: transfer immediately
            maToken.transfer(msg.sender, releaseAmount);

            userReleases[msg.sender].push(ReleasePosition({
                releaseAmount: releaseAmount,
                burnedAmount: burnAmount,
                startTime: block.timestamp,
                duration: 0,
                claimed: releaseAmount
            }));
        } else {
            // Linear release: create vesting schedule
            userReleases[msg.sender].push(ReleasePosition({
                releaseAmount: releaseAmount,
                burnedAmount: burnAmount,
                startTime: block.timestamp,
                duration: plan.duration,
                claimed: 0
            }));
        }

        emit ReleaseCreated(msg.sender, releaseIndex, planIndex, amount, releaseAmount, burnAmount);
    }

    /// @notice Claim vested MA from a linear release schedule
    /// @param releaseIndex Index of user's release position
    function claimRelease(uint256 releaseIndex) external nonReentrant whenNotPaused {
        require(releaseIndex < userReleases[msg.sender].length, "Invalid index");
        ReleasePosition storage pos = userReleases[msg.sender][releaseIndex];
        require(pos.duration > 0, "Instant release already claimed");

        uint256 vested = _vestedAmount(pos);
        uint256 claimable = vested - pos.claimed;
        require(claimable > 0, "Nothing to claim");

        pos.claimed += claimable;
        maToken.transfer(msg.sender, claimable);

        emit ReleaseClaimed(msg.sender, releaseIndex, claimable);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setVaultContract(address _vault) external onlyOwner {
        require(_vault != address(0), "Invalid address");
        vaultContract = _vault;
    }

    function setMAToken(address _maToken) external onlyOwner {
        require(_maToken != address(0), "Invalid address");
        maToken = IMATokenRelease(_maToken);
    }

    function updateReleasePlan(uint256 index, uint256 burnRate, uint256 duration, bool active) external onlyOwner {
        require(index < releasePlans.length, "Invalid index");
        require(burnRate <= 10000, "Burn rate too high");
        releasePlans[index] = ReleasePlan(burnRate, duration, active);
        emit ReleasePlanUpdated(index, burnRate, duration, active);
    }

    function addReleasePlan(uint256 burnRate, uint256 duration) external onlyOwner {
        require(burnRate <= 10000, "Burn rate too high");
        releasePlans.push(ReleasePlan(burnRate, duration, true));
        emit ReleasePlanUpdated(releasePlans.length - 1, burnRate, duration, true);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
    }

    // ─── View ───────────────────────────────────────────────────────────

    function getUserReleaseCount(address user) external view returns (uint256) {
        return userReleases[user].length;
    }

    function getReleaseInfo(address user, uint256 index) external view returns (
        uint256 releaseAmount,
        uint256 burnedAmount,
        uint256 startTime,
        uint256 duration,
        uint256 claimed,
        uint256 claimable
    ) {
        ReleasePosition storage pos = userReleases[user][index];
        uint256 vested = _vestedAmount(pos);
        return (
            pos.releaseAmount,
            pos.burnedAmount,
            pos.startTime,
            pos.duration,
            pos.claimed,
            vested - pos.claimed
        );
    }

    function getReleasePlansCount() external view returns (uint256) {
        return releasePlans.length;
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _vestedAmount(ReleasePosition storage pos) internal view returns (uint256) {
        if (pos.duration == 0) {
            return pos.releaseAmount;
        }

        uint256 elapsed = block.timestamp - pos.startTime;
        if (elapsed >= pos.duration) {
            return pos.releaseAmount;
        }

        return (pos.releaseAmount * elapsed) / pos.duration;
    }
}
