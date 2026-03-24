// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Interface for thirdweb MA Token (ERC20 with mintTo)
interface IMAToken {
    function mintTo(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Interface for MAPriceOracle
interface IMAPriceOracle {
    function getPrice() external view returns (uint256);
    function getPriceUnsafe() external view returns (uint256);
}

/// @notice Interface for cUSD token (burn for accounting cleanup)
interface ICUSD {
    function burn(uint256 amount) external;
}

/// @title CoinMax Vault (ERC4626 Upgradeable)
/// @notice Core vault on Arbitrum. Deployed behind ERC1967Proxy via CoinMaxFactory.
///
///  Responsibilities:
///    1. ERC4626 share accounting for cUSD deposits (soulbound shares)
///    2. Staking positions: lock MA for configurable periods
///    3. MA minting on deposit (based on USDC equivalent / MA price)
///    4. Expose staking data to InterestEngine for daily interest processing
///
///  What this contract does NOT do (delegated to other modules):
///    - Daily interest calculation → CoinMaxInterestEngine
///    - MA release / vesting / burn → CoinMaxRelease
///    - Cross-chain deposits → CoinMaxGateway
///    - USDC fund management → CoinMaxFundManagement
///
///  Roles:
///    DEFAULT_ADMIN_ROLE — owner / multisig (upgrade, config)
///    GATEWAY_ROLE       — CoinMaxGateway (depositFor)
///    ENGINE_ROLE        — CoinMaxInterestEngine (readStake, markInterest)
///
///  Proxy deployment:
///    impl = new CoinMaxVault();
///    proxy = new ERC1967Proxy(impl, abi.encodeCall(CoinMaxVault.initialize, (...)));
contract CoinMaxVault is
    Initializable,
    ERC4626Upgradeable,
    AccessControlUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    bytes32 public constant GATEWAY_ROLE = keccak256("GATEWAY_ROLE");
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    bytes32 public constant PRICE_ROLE = keccak256("PRICE_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE (append-only for upgradeable — never reorder or remove)
    // ═══════════════════════════════════════════════════════════════════

    IMAToken public maToken;

    /// @notice MA Price Oracle contract
    IMAPriceOracle public priceOracle;

    /// @notice Fallback MA price (used if oracle not set, 6 decimals)
    uint256 public maPrice;

    // ─── Stake Plans ────────────────────────────────────────────────

    struct StakePlan {
        uint256 duration;      // lock period in seconds
        uint256 dailyRate;     // daily interest in basis points (50 = 0.5%)
        bool active;
    }

    StakePlan[] public stakePlans;

    // ─── Stake Positions ────────────────────────────────────────────

    struct StakePosition {
        uint256 cUsdShares;          // vault shares for this position
        uint256 cUsdDeposited;       // cUSD deposited (= USDC equivalent)
        uint256 maAmount;            // MA tokens locked (principal)
        uint256 startTime;
        uint256 lastInterestTime;    // last time daily interest was processed
        uint256 planIndex;
        bool principalClaimed;
    }

    mapping(address => StakePosition[]) public userStakes;

    uint256 public totalMAStaked;
    uint256 public totalCUsdDeposited;

    // ─── Gap for future upgrades ────────────────────────────────────
    uint256[40] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event Deposited(
        address indexed user,
        uint256 cUsdAmount,
        uint256 shares,
        uint256 maAmount,
        uint256 planIndex,
        uint256 stakeIndex,
        uint256 timestamp
    );
    event PrincipalClaimed(address indexed user, uint256 stakeIndex, uint256 maAmount);
    event InterestTimeAdvanced(address indexed user, uint256 stakeIndex, uint256 newTime);
    event MAPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event PlanAdded(uint256 index, uint256 duration, uint256 dailyRate);
    event PlanUpdated(uint256 index, uint256 duration, uint256 dailyRate, bool active);

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER (replaces constructor for proxy pattern)
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _cUsd cUSD token address (ERC4626 underlying asset)
    /// @param _maToken MA token address (thirdweb TokenDrop)
    /// @param _admin Admin address (gets DEFAULT_ADMIN_ROLE)
    /// @param _gateway CoinMaxGateway address (gets GATEWAY_ROLE)
    /// @param _engine CoinMaxInterestEngine address (gets ENGINE_ROLE)
    /// @param _maPrice Initial MA price (6 decimals)
    function initialize(
        address _cUsd,
        address _maToken,
        address _admin,
        address _gateway,
        address _engine,
        uint256 _maPrice
    ) external initializer {
        require(_cUsd != address(0), "Invalid cUSD");
        require(_maToken != address(0), "Invalid MA");
        require(_admin != address(0), "Invalid admin");
        require(_maPrice > 0, "Invalid price");

        __ERC4626_init(IERC20(_cUsd));
        __ERC20_init("CoinMax Vault Share", "cmVault");
        __AccessControl_init();
        // ReentrancyGuard (OZ5) does not need init
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(PRICE_ROLE, _admin); // admin can also update price
        if (_gateway != address(0)) _grantRole(GATEWAY_ROLE, _gateway);
        if (_engine != address(0)) _grantRole(ENGINE_ROLE, _engine);

        maToken = IMAToken(_maToken);
        maPrice = _maPrice;

        // Default stake plans: 5d/45d/90d/180d with daily interest rates
        stakePlans.push(StakePlan(5 days,    50, true));   // 0.5% daily
        stakePlans.push(StakePlan(45 days,   70, true));   // 0.7% daily
        stakePlans.push(StakePlan(90 days,   90, true));   // 0.9% daily
        stakePlans.push(StakePlan(180 days, 120, true));   // 1.2% daily
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ERC4626 OVERRIDES — soulbound shares
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Shares are soulbound — only mint (deposit) and burn (claim) allowed
    function _update(address from, address to, uint256 value) internal override {
        require(
            from == address(0) || to == address(0),
            "Vault shares are non-transferable"
        );
        super._update(from, to, value);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @dev Block standard ERC4626 entry points — must use depositAndStake / depositFor
    function deposit(uint256, address) public pure override returns (uint256) {
        revert("Use depositAndStake");
    }
    function mint(uint256, address) public pure override returns (uint256) {
        revert("Use depositAndStake");
    }
    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert("Use claimPrincipal");
    }
    function redeem(uint256, address, address) public pure override returns (uint256) {
        revert("Use claimPrincipal");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: DEPOSIT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Direct deposit: user has cUSD on ARB
    function depositAndStake(
        uint256 cUsdAmount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        require(cUsdAmount > 0, "Zero amount");
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), cUsdAmount);
        _processDeposit(msg.sender, cUsdAmount, planIndex);
    }

    /// @notice Deposit on behalf of user (called by Gateway via GATEWAY_ROLE)
    function depositFor(
        address user,
        uint256 cUsdAmount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused onlyRole(GATEWAY_ROLE) {
        require(user != address(0), "Invalid user");
        require(cUsdAmount > 0, "Zero amount");
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), cUsdAmount);
        _processDeposit(user, cUsdAmount, planIndex);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: CLAIM PRINCIPAL (after maturity)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Claim locked MA principal after lock period ends.
    ///         Burns vault shares + cUSD (accounting cleanup).
    function claimPrincipal(uint256 stakeIndex) external nonReentrant whenNotPaused {
        require(stakeIndex < userStakes[msg.sender].length, "Invalid index");
        StakePosition storage pos = userStakes[msg.sender][stakeIndex];
        require(!pos.principalClaimed, "Already claimed");

        StakePlan storage plan = stakePlans[pos.planIndex];
        require(block.timestamp >= pos.startTime + plan.duration, "Not matured");

        pos.principalClaimed = true;
        totalMAStaked -= pos.maAmount;

        // Transfer locked MA to user
        maToken.transfer(msg.sender, pos.maAmount);

        // Burn vault shares (accounting)
        _burn(msg.sender, pos.cUsdShares);

        // Burn underlying cUSD (accounting token, no longer needed)
        ICUSD(asset()).burn(pos.cUsdDeposited);

        emit PrincipalClaimed(msg.sender, stakeIndex, pos.maAmount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ENGINE INTERFACE — called by CoinMaxInterestEngine
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Advance a position's lastInterestTime (called by InterestEngine
    ///         after it has processed and minted the interest externally).
    /// @dev Only ENGINE_ROLE can call this — ensures interest is processed
    ///      by the dedicated engine contract, not directly.
    function advanceInterestTime(
        address user,
        uint256 stakeIndex,
        uint256 daysProcessed
    ) external onlyRole(ENGINE_ROLE) {
        require(stakeIndex < userStakes[user].length, "Invalid index");
        StakePosition storage pos = userStakes[user][stakeIndex];
        require(!pos.principalClaimed, "Position closed");

        pos.lastInterestTime += daysProcessed * 1 days;

        emit InterestTimeAdvanced(user, stakeIndex, pos.lastInterestTime);
    }

    /// @notice Read stake position data (used by InterestEngine for calculations)
    function getStakePosition(
        address user,
        uint256 index
    ) external view returns (
        uint256 cUsdDeposited,
        uint256 startTime,
        uint256 lastInterestTime,
        uint256 planIndex,
        bool principalClaimed
    ) {
        StakePosition storage pos = userStakes[user][index];
        return (
            pos.cUsdDeposited,
            pos.startTime,
            pos.lastInterestTime,
            pos.planIndex,
            pos.principalClaimed
        );
    }

    /// @notice Get stake plan details
    function getStakePlan(uint256 index) external view returns (
        uint256 duration,
        uint256 dailyRate,
        bool active
    ) {
        StakePlan storage plan = stakePlans[index];
        return (plan.duration, plan.dailyRate, plan.active);
    }

    /// @notice Get current MA price (oracle → fallback)
    /// @dev Called by InterestEngine to get price for interest calculation
    function getCurrentMAPrice() external view returns (uint256) {
        return _getMAPrice();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN (DEFAULT_ADMIN_ROLE)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Update fallback MA price. Callable by PRICE_ROLE.
    function setMAPrice(uint256 _maPrice) external onlyRole(PRICE_ROLE) {
        require(_maPrice > 0, "Invalid price");
        uint256 old = maPrice;
        maPrice = _maPrice;
        emit MAPriceUpdated(old, _maPrice);
    }

    function addPlan(uint256 duration, uint256 dailyRate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakePlans.push(StakePlan(duration, dailyRate, true));
        emit PlanAdded(stakePlans.length - 1, duration, dailyRate);
    }

    function updatePlan(
        uint256 index,
        uint256 duration,
        uint256 dailyRate,
        bool active
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < stakePlans.length, "Invalid index");
        stakePlans[index] = StakePlan(duration, dailyRate, active);
        emit PlanUpdated(index, duration, dailyRate, active);
    }

    function setPriceOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceOracle = IMAPriceOracle(_oracle);
    }

    function setMAToken(address _maToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maToken != address(0), "Invalid");
        maToken = IMAToken(_maToken);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW
    // ═══════════════════════════════════════════════════════════════════

    function getUserStakeCount(address user) external view returns (uint256) {
        return userStakes[user].length;
    }

    function getStakeInfo(address user, uint256 index) external view returns (
        uint256 cUsdShares,
        uint256 cUsdDeposited,
        uint256 maAmount,
        uint256 startTime,
        uint256 lastInterestTime,
        uint256 planIndex,
        uint256 duration,
        uint256 dailyRate,
        uint256 pendingInterestDays,
        bool matured,
        bool principalClaimed
    ) {
        StakePosition storage pos = userStakes[user][index];
        StakePlan storage plan = stakePlans[pos.planIndex];

        uint256 endTime = pos.startTime + plan.duration;
        uint256 currentTime = block.timestamp < endTime ? block.timestamp : endTime;
        uint256 pendingDays = currentTime > pos.lastInterestTime
            ? (currentTime - pos.lastInterestTime) / 1 days
            : 0;

        return (
            pos.cUsdShares,
            pos.cUsdDeposited,
            pos.maAmount,
            pos.startTime,
            pos.lastInterestTime,
            pos.planIndex,
            plan.duration,
            plan.dailyRate,
            pendingDays,
            block.timestamp >= endTime,
            pos.principalClaimed
        );
    }

    function getPlansCount() external view returns (uint256) {
        return stakePlans.length;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Get MA price: oracle first, fallback to stored maPrice
    function _getMAPrice() internal view returns (uint256) {
        if (address(priceOracle) != address(0)) {
            try priceOracle.getPrice() returns (uint256 oraclePrice) {
                if (oraclePrice > 0) return oraclePrice;
            } catch {}
        }
        require(maPrice > 0, "No price available");
        return maPrice;
    }

    function _processDeposit(
        address user,
        uint256 cUsdAmount,
        uint256 planIndex
    ) internal {
        require(planIndex < stakePlans.length, "Invalid plan");
        StakePlan storage plan = stakePlans[planIndex];
        require(plan.active, "Plan not active");

        // 1. Mint vault shares (1:1 with cUSD)
        uint256 shares = previewDeposit(cUsdAmount);
        _mint(user, shares);

        // 2. Mint MA: maAmount = cUsdAmount(18dec) * 1e6 / maPrice(6dec) = MA(18dec)
        uint256 currentPrice = _getMAPrice();
        uint256 maAmount = (cUsdAmount * 1e6) / currentPrice;
        require(maAmount > 0, "MA amount too small");
        maToken.mintTo(address(this), maAmount);

        // 3. Create stake position
        uint256 stakeIndex = userStakes[user].length;
        userStakes[user].push(StakePosition({
            cUsdShares: shares,
            cUsdDeposited: cUsdAmount,
            maAmount: maAmount,
            startTime: block.timestamp,
            lastInterestTime: block.timestamp,
            planIndex: planIndex,
            principalClaimed: false
        }));

        totalMAStaked += maAmount;
        totalCUsdDeposited += cUsdAmount;

        emit Deposited(user, cUsdAmount, shares, maAmount, planIndex, stakeIndex, block.timestamp);
    }
}
