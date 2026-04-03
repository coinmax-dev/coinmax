// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CoinMax Vault V4 — Engine-Controlled ERC4626
/// @notice All minting/deposit operations go through Engine only.
///         Users do NOT call this contract directly.
///
///  Flow:
///    1. User pays USDT → thirdweb Pay swap → USDC → Receiver Server(0xe193)
///    2. Frontend callback → DB records deposit
///    3. Engine reads DB → calls mintDeposit() → mint cUSD + shares
///    4. Engine daily → calls settleYield() → mint cUSD interest + MA
///    5. Engine can also call mintDeposit() without real payment (admin/test)

interface ICUSD { function mint(address to, uint256 amount) external; function burnFrom(address from, uint256 amount) external; function balanceOf(address) external view returns (uint256); }
interface IMATokenV4 { function mint(address to, uint256 amount) external; }
interface IPriceOracle { function getPrice() external view returns (uint256); }

contract CoinMaxVaultV4 is Initializable, ERC4626Upgradeable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    ICUSD public cusd;
    IMATokenV4 public maToken;
    IPriceOracle public oracle;
    address public maReceiver;

    // ─── Stake tracking ──────────────────────────────────────

    struct StakePosition {
        address user;
        uint256 cusdAmount;
        uint256 shares;
        string planType;
        uint256 dailyRate;      // bps (90 = 0.90%)
        uint256 startTime;
        uint256 duration;
        bool isBonus;
        bool yieldLocked;
        bool principalClaimed;
    }

    mapping(address => StakePosition[]) public userStakes;

    // ─── Node tracking ───────────────────────────────────────

    struct NodePosition {
        address user;
        string nodeType;
        uint256 contributionUSDC;
        uint256 cusdLeverage;
        uint256 dailyRate;
        uint256 startTime;
        uint256 duration;
        bool active;
    }

    mapping(address => NodePosition[]) public userNodes;

    // ─── Stats ───────────────────────────────────────────────

    uint256 public totalCUSDDeposited;
    uint256 public totalYieldMinted;
    uint256 public totalMAMinted;

    // ─── Events ──────────────────────────────────────────────

    event DepositMinted(address indexed user, uint256 cusdAmount, uint256 shares, string planType);
    event NodeMinted(address indexed user, string nodeType, uint256 contributionUSDC, uint256 cusdLeverage);
    event YieldSettled(uint256 totalCUSDYield, uint256 totalMAMinted, uint256 maPrice, uint256 count);

    // ─── Initialize ──────────────────────────────────────────

    function initialize(
        address _cusd,
        address _usdc,      // kept for interface compatibility, not used for transfers
        address _maToken,
        address _oracle,
        address _usdcReceiver, // kept for interface compatibility
        address _maReceiver
    ) public initializer {
        __ERC4626_init(IERC20(_cusd));
        __ERC20_init("CoinMax Vault V4", "cmVAULT");
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cusd = ICUSD(_cusd);
        maToken = IMATokenV4(_maToken);
        oracle = IPriceOracle(_oracle);
        maReceiver = _maReceiver;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Mint deposit (after USDC received by Server)
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine mints cUSD + vault shares for a user deposit.
    ///         Called after USDC payment confirmed to Receiver Server.
    ///         Can also be called for admin/test deposits (no real USDC needed).
    /// @param user     Wallet address of the depositor
    /// @param amount   USDC amount (1:1 cUSD)
    /// @param planType "5_DAYS", "45_DAYS", "90_DAYS", "180_DAYS"
    function mintDeposit(
        address user,
        uint256 amount,
        string calldata planType
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused returns (uint256 shares) {
        require(amount > 0, "Zero");
        require(user != address(0), "Zero address");

        // Mint cUSD 1:1 to Vault
        cusd.mint(address(this), amount);

        // Mint vault shares to user
        shares = previewDeposit(amount);
        _mint(user, shares);

        // Record position
        uint256 duration = _parseDuration(planType);
        uint256 rate = _parseRate(planType);
        userStakes[user].push(StakePosition(
            user, amount, shares, planType, rate,
            block.timestamp, duration, false, false, false
        ));

        totalCUSDDeposited += amount;
        emit DepositMinted(user, amount, shares, planType);
    }

    /// @notice Engine mints cUSD + vault shares for bonus/test deposit
    function mintBonusDeposit(
        address user,
        uint256 amount,
        string calldata planType
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused returns (uint256 shares) {
        require(amount > 0 && user != address(0), "Invalid");

        cusd.mint(address(this), amount);
        shares = previewDeposit(amount);
        _mint(user, shares);

        uint256 duration = _parseDuration(planType);
        uint256 rate = _parseRate(planType);
        userStakes[user].push(StakePosition(
            user, amount, shares, planType, rate,
            block.timestamp, duration, true, true, false // isBonus=true, yieldLocked=true
        ));

        totalCUSDDeposited += amount;
        emit DepositMinted(user, amount, shares, planType);
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Mint node position
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine creates node position with cUSD leverage.
    ///         Called after USDC node payment confirmed.
    function mintNode(
        address user,
        string calldata nodeType,
        uint256 contributionUSDC
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused {
        require(contributionUSDC > 0 && user != address(0), "Invalid");

        (uint256 leverage, uint256 duration, uint256 rate) = _nodeConfig(nodeType);
        uint256 cusdLeverage = contributionUSDC * leverage / 100;

        // Mint leveraged cUSD
        cusd.mint(address(this), cusdLeverage);

        userNodes[user].push(NodePosition(
            user, nodeType, contributionUSDC, cusdLeverage,
            rate, block.timestamp, duration, true
        ));

        emit NodeMinted(user, nodeType, contributionUSDC, cusdLeverage);
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Batch mint deposits (multiple users at once)
    // ═══════════════════════════════════════════════════════════

    /// @notice Batch mint deposits for multiple users
    function batchMintDeposit(
        address[] calldata users,
        uint256[] calldata amounts,
        string[] calldata planTypes
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused {
        require(users.length == amounts.length && users.length == planTypes.length, "Mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] == 0 || users[i] == address(0)) continue;

            cusd.mint(address(this), amounts[i]);
            uint256 shares = previewDeposit(amounts[i]);
            _mint(users[i], shares);

            uint256 duration = _parseDuration(planTypes[i]);
            uint256 rate = _parseRate(planTypes[i]);
            userStakes[users[i]].push(StakePosition(
                users[i], amounts[i], shares, planTypes[i], rate,
                block.timestamp, duration, false, false, false
            ));

            totalCUSDDeposited += amounts[i];
            emit DepositMinted(users[i], amounts[i], shares, planTypes[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Settle daily yield
    // ═══════════════════════════════════════════════════════════

    /// @notice Daily yield settlement: mint cUSD interest + MA tokens
    function settleYield(
        address[] calldata users,
        uint256[] calldata cusdYields,
        uint256[] calldata maAmounts
    ) external onlyRole(ENGINE_ROLE) nonReentrant {
        require(users.length == cusdYields.length && users.length == maAmounts.length, "Mismatch");
        uint256 tCUSD = 0; uint256 tMA = 0; uint256 maPrice = oracle.getPrice();

        for (uint256 i = 0; i < users.length; i++) {
            if (cusdYields[i] == 0) continue;

            // Mint cUSD interest (increases ERC4626 totalAssets = backing)
            cusd.mint(address(this), cusdYields[i]);
            tCUSD += cusdYields[i];

            // Mint MA → Release contract
            if (maAmounts[i] > 0) {
                maToken.mint(maReceiver, maAmounts[i]);
                tMA += maAmounts[i];
            }
        }

        totalYieldMinted += tCUSD;
        totalMAMinted += tMA;
        emit YieldSettled(tCUSD, tMA, maPrice, users.length);
    }

    // ─── View ────────────────────────────────────────────────

    function getUserStakes(address user) external view returns (StakePosition[] memory) {
        return userStakes[user];
    }

    function getUserNodes(address user) external view returns (NodePosition[] memory) {
        return userNodes[user];
    }

    function getVaultStats() external view returns (
        uint256 totalAssets_,
        uint256 totalShares,
        uint256 cusdDeposited,
        uint256 yieldMinted,
        uint256 maMinted,
        uint256 maPrice
    ) {
        totalAssets_ = totalAssets();
        totalShares = totalSupply();
        cusdDeposited = totalCUSDDeposited;
        yieldMinted = totalYieldMinted;
        maMinted = totalMAMinted;
        maPrice = oracle.getPrice();
    }

    // ─── Internal ────────────────────────────────────────────

    function _parseDuration(string calldata p) internal pure returns (uint256) {
        if (_eq(p, "5_DAYS")) return 5 days;
        if (_eq(p, "45_DAYS")) return 45 days;
        if (_eq(p, "90_DAYS")) return 90 days;
        if (_eq(p, "180_DAYS")) return 180 days;
        revert("Invalid plan");
    }

    function _parseRate(string calldata p) internal pure returns (uint256) {
        if (_eq(p, "5_DAYS")) return 50;
        if (_eq(p, "45_DAYS")) return 70;
        if (_eq(p, "90_DAYS")) return 90;
        if (_eq(p, "180_DAYS")) return 100;
        revert("Invalid plan");
    }

    function _nodeConfig(string calldata n) internal pure returns (uint256 leverage, uint256 duration, uint256 rate) {
        if (_eq(n, "MAX")) return (1000, 120 days, 90);   // 10× leverage
        if (_eq(n, "MINI")) return (1000, 90 days, 90);   // 10× leverage
        revert("Invalid node");
    }

    function _eq(string calldata a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // ─── Admin ───────────────────────────────────────────────

    function setMaReceiver(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) { maReceiver = _r; }
    function setOracle(address _o) external onlyRole(DEFAULT_ADMIN_ROLE) { oracle = IPriceOracle(_o); }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
