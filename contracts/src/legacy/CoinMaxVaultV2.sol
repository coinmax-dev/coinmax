// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Interface for thirdweb TokenDrop (ERC20 with mintTo / burn)
interface IMATokenV2 {
    function mintTo(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Interface for CoinMaxRelease
interface ICoinMaxReleaseV2 {
    function addAccumulated(address user, uint256 amount) external;
}

/// @title CoinMax Vault V2
/// @notice Deposit USDT (swapped to USDC via PancakeSwap V3) → mint MA → auto-stake.
///
///  KEY DESIGN: MA minting is always based on the **original USDT amount** the user paid,
///  NOT the USDC amount received after swap. This ensures consistent pricing regardless
///  of any USDT/USDC rate fluctuation.
///
///  Flow:  SwapRouter → USDC (actual asset) → VaultV2 → mint MA (based on USDT input) → Stake
///
///  Example: User pays 1000 USDT → swap gets 999.5 USDC → USDC goes to fund distributor
///           → MA minted = 1000 USDT / maPrice (NOT 999.5)
contract CoinMaxVaultV2 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice USDC token (received from swap, actual stored asset)
    IERC20 public usdc;

    IMATokenV2 public maToken;
    ICoinMaxReleaseV2 public releaseContract;
    address public fundDistributor;

    /// @notice Authorized SwapRouter contract
    address public swapRouter;

    /// @notice MA price in USD (6 decimals, e.g. 100000 = $0.10)
    uint256 public maPrice;

    struct StakePlan {
        uint256 duration;      // lock period in seconds
        uint256 interestRate;  // basis points (50 = 0.5%)
        bool active;
    }

    /// @notice Staking plans (index-based)
    StakePlan[] public stakePlans;

    struct StakePosition {
        uint256 maAmount;              // MA tokens staked
        uint256 originalUsdtAmount;    // original USDT amount user paid (for records)
        uint256 usdcDeposited;         // actual USDC received after swap
        uint256 startTime;
        uint256 planIndex;
        bool principalClaimed;
        bool interestPushed;
    }

    /// @notice User staking positions
    mapping(address => StakePosition[]) public userStakes;

    uint256 public totalStaked;
    uint256 public totalUsdcDeposited;

    // ─── Events ─────────────────────────────────────────────────────────

    /// @dev Backend should use `originalUsdtAmount` for all user-facing calculations
    event DepositedV2(
        address indexed user,
        uint256 originalUsdtAmount,    // USDT user intended to pay (DB uses this)
        uint256 usdcReceived,          // actual USDC after swap
        uint256 maAmount,
        uint256 planIndex,
        uint256 stakeIndex,
        bool viaSwapRouter,
        uint256 timestamp
    );
    event PrincipalClaimed(address indexed user, uint256 stakeIndex, uint256 maAmount);
    event InterestPushed(address indexed user, uint256 stakeIndex, uint256 interestAmount);
    event MAPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event PlanAdded(uint256 index, uint256 duration, uint256 interestRate);
    event PlanUpdated(uint256 index, uint256 duration, uint256 interestRate, bool active);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _usdc USDC token address
    /// @param _maToken thirdweb TokenDrop address for MA
    /// @param _releaseContract CoinMaxRelease address
    /// @param _fundDistributor CoinMaxFundManager address
    /// @param _swapRouter CoinMaxSwapRouter address
    /// @param _maPrice Initial MA price in 6 decimals (e.g. 100000 = $0.10)
    constructor(
        address _usdc,
        address _maToken,
        address _releaseContract,
        address _fundDistributor,
        address _swapRouter,
        uint256 _maPrice
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_maToken != address(0), "Invalid MA token");
        require(_releaseContract != address(0), "Invalid release");
        require(_fundDistributor != address(0), "Invalid distributor");
        require(_swapRouter != address(0), "Invalid router");
        require(_maPrice > 0, "Invalid price");

        usdc = IERC20(_usdc);
        maToken = IMATokenV2(_maToken);
        releaseContract = ICoinMaxReleaseV2(_releaseContract);
        fundDistributor = _fundDistributor;
        swapRouter = _swapRouter;
        maPrice = _maPrice;

        // Default plans: 15d/45d/90d/180d/360d
        stakePlans.push(StakePlan(15 days,  50, true));   // 0.5%
        stakePlans.push(StakePlan(45 days,  70, true));   // 0.7%
        stakePlans.push(StakePlan(90 days,  90, true));   // 0.9%
        stakePlans.push(StakePlan(180 days, 110, true));  // 1.1%
        stakePlans.push(StakePlan(360 days, 130, true));  // 1.3%
    }

    // ─── Core: Called by SwapRouter ─────────────────────────────────────

    /// @notice Deposit on behalf of a user (called by SwapRouter after swap)
    /// @param depositor The actual user who initiated the deposit
    /// @param usdcAmount USDC amount received from swap (actual asset)
    /// @param originalUsdtAmount Original USDT amount user paid (used for MA calculation)
    /// @param planIndex Staking plan index
    function depositFrom(
        address depositor,
        uint256 usdcAmount,
        uint256 originalUsdtAmount,
        uint256 planIndex
    ) external whenNotPaused {
        require(msg.sender == swapRouter, "Only SwapRouter");
        require(depositor != address(0), "Invalid depositor");

        // Pull USDC from SwapRouter
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // MA calculation is based on ORIGINAL USDT amount, not USDC received
        _deposit(depositor, usdcAmount, originalUsdtAmount, planIndex, true);
    }

    // ─── Core: Direct USDC Deposit ─────────────────────────────────────

    /// @notice Deposit USDC directly (no swap needed, user already holds USDC)
    /// @param usdcAmount Amount of USDC to deposit
    /// @param planIndex Staking plan index
    function deposit(
        uint256 usdcAmount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        // Pull USDC from user
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // For direct deposits, USDT amount = USDC amount (assumed 1:1)
        _deposit(msg.sender, usdcAmount, usdcAmount, planIndex, false);
    }

    /// @notice Claim principal MA after maturity
    function claimPrincipal(uint256 stakeIndex) external nonReentrant whenNotPaused {
        require(stakeIndex < userStakes[msg.sender].length, "Invalid index");
        StakePosition storage pos = userStakes[msg.sender][stakeIndex];
        require(!pos.principalClaimed, "Already claimed");

        StakePlan storage plan = stakePlans[pos.planIndex];
        require(block.timestamp >= pos.startTime + plan.duration, "Not matured");

        pos.principalClaimed = true;
        totalStaked -= pos.maAmount;

        maToken.transfer(msg.sender, pos.maAmount);

        if (!pos.interestPushed) {
            _pushInterest(msg.sender, stakeIndex);
        }

        emit PrincipalClaimed(msg.sender, stakeIndex, pos.maAmount);
    }

    /// @notice Push accumulated interest to Release contract
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
        releaseContract = ICoinMaxReleaseV2(_release);
    }

    function setFundDistributor(address _fund) external onlyOwner {
        require(_fund != address(0), "Invalid address");
        fundDistributor = _fund;
    }

    function setSwapRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid address");
        swapRouter = _router;
    }

    function setUsdc(address _usdc) external onlyOwner {
        require(_usdc != address(0), "Invalid address");
        usdc = IERC20(_usdc);
    }

    function setMAToken(address _maToken) external onlyOwner {
        require(_maToken != address(0), "Invalid address");
        maToken = IMATokenV2(_maToken);
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
        uint256 originalUsdtAmount,
        uint256 usdcDeposited,
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
            pos.originalUsdtAmount,
            pos.usdcDeposited,
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

    function _deposit(
        address user,
        uint256 usdcAmount,
        uint256 originalUsdtAmount,
        uint256 planIndex,
        bool viaRouter
    ) internal {
        require(usdcAmount > 0, "Zero USDC amount");
        require(originalUsdtAmount > 0, "Zero USDT amount");
        require(planIndex < stakePlans.length, "Invalid plan");

        StakePlan storage plan = stakePlans[planIndex];
        require(plan.active, "Plan not active");

        // *** KEY: MA amount calculated from ORIGINAL USDT amount, not USDC ***
        // maAmount = originalUsdtAmount(18 dec) * 1e6 / maPrice(6 dec) = MA(18 dec)
        uint256 maAmount = (originalUsdtAmount * 1e6) / maPrice;
        require(maAmount > 0, "MA amount too small");

        // Forward USDC to fund distributor
        usdc.safeTransfer(fundDistributor, usdcAmount);

        // Mint MA to this contract (staked)
        maToken.mintTo(address(this), maAmount);

        // Create stake position
        uint256 stakeIndex = userStakes[user].length;
        userStakes[user].push(StakePosition({
            maAmount: maAmount,
            originalUsdtAmount: originalUsdtAmount,
            usdcDeposited: usdcAmount,
            startTime: block.timestamp,
            planIndex: planIndex,
            principalClaimed: false,
            interestPushed: false
        }));

        totalStaked += maAmount;
        totalUsdcDeposited += usdcAmount;

        emit DepositedV2(user, originalUsdtAmount, usdcAmount, maAmount, planIndex, stakeIndex, viaRouter, block.timestamp);
    }

    function _pushInterest(address user, uint256 stakeIndex) internal {
        StakePosition storage pos = userStakes[user][stakeIndex];
        StakePlan storage plan = stakePlans[pos.planIndex];

        uint256 interestAmount = (pos.maAmount * plan.interestRate) / 10000;
        pos.interestPushed = true;

        if (interestAmount > 0) {
            maToken.mintTo(address(releaseContract), interestAmount);
            releaseContract.addAccumulated(user, interestAmount);
            emit InterestPushed(user, stakeIndex, interestAmount);
        }
    }
}
