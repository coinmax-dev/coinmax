// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Interface for thirdweb TokenDrop (ERC20 with mintTo / burn)
interface IMAToken {
    function mintTo(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Interface for CoinMaxRelease
interface ICoinMaxRelease {
    function addAccumulated(address user, uint256 amount) external;
}

/// @title CoinMax Vault
/// @notice Deposit USDT/USDC → mint MA → auto-stake → interest accrual → principal release.
///         Interest is pushed to CoinMaxRelease for burn-based claiming.
contract CoinMaxVaultV1 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    IMAToken public maToken;
    ICoinMaxRelease public releaseContract;
    address public fundDistributor;

    /// @notice MA price in USD (6 decimals, e.g. 100000 = $0.10)
    uint256 public maPrice;

    /// @notice Whitelisted payment tokens
    mapping(address => bool) public allowedTokens;

    struct StakePlan {
        uint256 duration;      // lock period in seconds
        uint256 interestRate;  // basis points (50 = 0.5%)
        bool active;
    }

    /// @notice Staking plans (index-based)
    StakePlan[] public stakePlans;

    struct StakePosition {
        uint256 maAmount;       // MA tokens staked
        uint256 startTime;
        uint256 planIndex;
        bool principalClaimed;
        bool interestPushed;
    }

    /// @notice User staking positions
    mapping(address => StakePosition[]) public userStakes;

    uint256 public totalStaked;

    // ─── Events ─────────────────────────────────────────────────────────

    event Deposited(
        address indexed user,
        address indexed token,
        uint256 depositAmount,
        uint256 maAmount,
        uint256 planIndex,
        uint256 stakeIndex,
        uint256 timestamp
    );
    event PrincipalClaimed(address indexed user, uint256 stakeIndex, uint256 maAmount);
    event InterestPushed(address indexed user, uint256 stakeIndex, uint256 interestAmount);
    event MAPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event PlanAdded(uint256 index, uint256 duration, uint256 interestRate);
    event PlanUpdated(uint256 index, uint256 duration, uint256 interestRate, bool active);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _maToken thirdweb TokenDrop address for MA
    /// @param _releaseContract CoinMaxRelease address
    /// @param _fundDistributor CoinMaxFundManager address
    /// @param _maPrice Initial MA price in 6 decimals (e.g. 100000 = $0.10)
    /// @param _usdt USDT address
    /// @param _usdc USDC address
    constructor(
        address _maToken,
        address _releaseContract,
        address _fundDistributor,
        uint256 _maPrice,
        address _usdt,
        address _usdc
    ) Ownable(msg.sender) {
        require(_maToken != address(0), "Invalid MA token");
        require(_releaseContract != address(0), "Invalid release");
        require(_fundDistributor != address(0), "Invalid distributor");
        require(_maPrice > 0, "Invalid price");

        maToken = IMAToken(_maToken);
        releaseContract = ICoinMaxRelease(_releaseContract);
        fundDistributor = _fundDistributor;
        maPrice = _maPrice;

        allowedTokens[_usdt] = true;
        allowedTokens[_usdc] = true;

        // Default plans: 15d/45d/90d/180d/360d
        stakePlans.push(StakePlan(15 days,  50, true));   // 0.5%
        stakePlans.push(StakePlan(45 days,  70, true));   // 0.7%
        stakePlans.push(StakePlan(90 days,  90, true));   // 0.9%
        stakePlans.push(StakePlan(180 days, 110, true));  // 1.1%
        stakePlans.push(StakePlan(360 days, 130, true));  // 1.3%
    }

    // ─── Core ───────────────────────────────────────────────────────────

    /// @notice Deposit USDT/USDC to mint and stake MA
    /// @param amount USDT/USDC amount (6 decimals)
    /// @param token Payment token (USDT or USDC)
    /// @param planIndex Staking plan index
    function deposit(
        uint256 amount,
        address token,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Zero amount");
        require(planIndex < stakePlans.length, "Invalid plan");

        StakePlan storage plan = stakePlans[planIndex];
        require(plan.active, "Plan not active");

        // Calculate MA amount: deposit(6 dec) * 1e18 / maPrice(6 dec) = MA(18 dec)
        uint256 maAmount = (amount * 1e18) / maPrice;
        require(maAmount > 0, "MA amount too small");

        // Transfer USDT/USDC to fund distributor
        IERC20(token).safeTransferFrom(msg.sender, fundDistributor, amount);

        // Mint MA to this contract (staked)
        maToken.mintTo(address(this), maAmount);

        // Create stake position
        uint256 stakeIndex = userStakes[msg.sender].length;
        userStakes[msg.sender].push(StakePosition({
            maAmount: maAmount,
            startTime: block.timestamp,
            planIndex: planIndex,
            principalClaimed: false,
            interestPushed: false
        }));

        totalStaked += maAmount;

        emit Deposited(msg.sender, token, amount, maAmount, planIndex, stakeIndex, block.timestamp);
    }

    /// @notice Claim principal MA after maturity
    /// @param stakeIndex Index of user's stake position
    function claimPrincipal(uint256 stakeIndex) external nonReentrant whenNotPaused {
        require(stakeIndex < userStakes[msg.sender].length, "Invalid index");
        StakePosition storage pos = userStakes[msg.sender][stakeIndex];
        require(!pos.principalClaimed, "Already claimed");

        StakePlan storage plan = stakePlans[pos.planIndex];
        require(block.timestamp >= pos.startTime + plan.duration, "Not matured");

        pos.principalClaimed = true;
        totalStaked -= pos.maAmount;

        // Transfer principal MA to user
        maToken.transfer(msg.sender, pos.maAmount);

        // Push interest to release contract if not done
        if (!pos.interestPushed) {
            _pushInterest(msg.sender, stakeIndex);
        }

        emit PrincipalClaimed(msg.sender, stakeIndex, pos.maAmount);
    }

    /// @notice Push accumulated interest to Release contract (callable after maturity)
    function pushInterest(uint256 stakeIndex) external nonReentrant whenNotPaused {
        require(stakeIndex < userStakes[msg.sender].length, "Invalid index");
        StakePosition storage pos = userStakes[msg.sender][stakeIndex];
        require(!pos.interestPushed, "Already pushed");

        StakePlan storage plan = stakePlans[pos.planIndex];
        require(block.timestamp >= pos.startTime + plan.duration, "Not matured");

        _pushInterest(msg.sender, stakeIndex);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setMAPrice(uint256 _maPrice) external onlyOwner {
        require(_maPrice > 0, "Invalid price");
        uint256 old = maPrice;
        maPrice = _maPrice;
        emit MAPriceUpdated(old, _maPrice);
    }

    function addPlan(uint256 duration, uint256 interestRate) external onlyOwner {
        stakePlans.push(StakePlan(duration, interestRate, true));
        emit PlanAdded(stakePlans.length - 1, duration, interestRate);
    }

    function updatePlan(uint256 index, uint256 duration, uint256 interestRate, bool active) external onlyOwner {
        require(index < stakePlans.length, "Invalid index");
        stakePlans[index] = StakePlan(duration, interestRate, active);
        emit PlanUpdated(index, duration, interestRate, active);
    }

    function setReleaseContract(address _release) external onlyOwner {
        require(_release != address(0), "Invalid address");
        releaseContract = ICoinMaxRelease(_release);
    }

    function setFundDistributor(address _fund) external onlyOwner {
        require(_fund != address(0), "Invalid address");
        fundDistributor = _fund;
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "Invalid token");
        allowedTokens[token] = allowed;
    }

    function setMAToken(address _maToken) external onlyOwner {
        require(_maToken != address(0), "Invalid address");
        maToken = IMAToken(_maToken);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
    }

    // ─── View ───────────────────────────────────────────────────────────

    function getUserStakeCount(address user) external view returns (uint256) {
        return userStakes[user].length;
    }

    function getStakeInfo(address user, uint256 index) external view returns (
        uint256 maAmount,
        uint256 startTime,
        uint256 planIndex,
        uint256 duration,
        uint256 interestRate,
        uint256 interestAmount,
        bool matured,
        bool principalClaimed,
        bool interestPushed
    ) {
        StakePosition storage pos = userStakes[user][index];
        StakePlan storage plan = stakePlans[pos.planIndex];
        return (
            pos.maAmount,
            pos.startTime,
            pos.planIndex,
            plan.duration,
            plan.interestRate,
            (pos.maAmount * plan.interestRate) / 10000,
            block.timestamp >= pos.startTime + plan.duration,
            pos.principalClaimed,
            pos.interestPushed
        );
    }

    function getPlansCount() external view returns (uint256) {
        return stakePlans.length;
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _pushInterest(address user, uint256 stakeIndex) internal {
        StakePosition storage pos = userStakes[user][stakeIndex];
        StakePlan storage plan = stakePlans[pos.planIndex];

        uint256 interestAmount = (pos.maAmount * plan.interestRate) / 10000;
        pos.interestPushed = true;

        if (interestAmount > 0) {
            // Mint interest MA to release contract
            maToken.mintTo(address(releaseContract), interestAmount);
            // Record accumulated interest for user
            releaseContract.addAccumulated(user, interestAmount);
            emit InterestPushed(user, stakeIndex, interestAmount);
        }
    }
}
