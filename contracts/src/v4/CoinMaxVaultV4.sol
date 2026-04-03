// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CoinMax Vault V4 — Pure cUSD ERC4626 Vault
/// @notice Only holds cUSD. No MA logic. Engine controls all operations.
///
///  Architecture:
///    - VaultV4: Pure cUSD vault. Deposits cUSD, tracks shares, produces interest.
///    - MA Token: Separate. Engine mints MA based on cUSD interest. Not in this contract.
///    - Release: Separate. Manages MA lock/release/destroy. Not in this contract.
///
///  Flow:
///    1. User pays USDT → swap → USDC to Server wallet (off-chain)
///    2. DB records deposit
///    3. Engine mints cUSD → calls depositFor() → Vault holds cUSD, Engine gets shares
///    4. Vault daily: cUSD interest accrues (totalAssets grows)
///    5. Engine reads interest → mints MA separately → DB records
///
///  Engine can deposit cUSD for any reason (real payment, admin, test, repeat)

interface ICUSD {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract CoinMaxVaultV4 is
    Initializable,
    ERC4626Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard
{
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    ICUSD public cusd;

    // ─── Position tracking ───────────────────────────────────

    struct Position {
        address user;
        uint256 cusdAmount;
        string planType;
        uint256 dailyRate;      // bps (90 = 0.90%)
        uint256 startTime;
        uint256 duration;
        bool isBonus;
        bool active;
    }

    Position[] public positions;
    mapping(address => uint256[]) public userPositionIds;

    // ─── Stats ───────────────────────────────────────────────

    uint256 public totalDeposited;
    uint256 public totalInterestMinted;     // total cUSD interest added
    uint256 public positionCount;

    // ─── Events ──────────────────────────────────────────────

    event PositionCreated(uint256 indexed posId, address indexed user, uint256 cusdAmount, string planType, bool isBonus);
    event InterestAdded(uint256 cusdAmount, uint256 positionsProcessed);

    // ─── Initialize ──────────────────────────────────────────

    function initialize(
        address _cusd
    ) public initializer {
        __ERC4626_init(IERC20(_cusd));
        __ERC20_init("CoinMax Vault V4", "cmVAULT");
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cusd = ICUSD(_cusd);
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Create position (mint cUSD + deposit into ERC4626)
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine creates a cUSD position for a user.
    ///         Mints cUSD → deposits into ERC4626 → tracks position.
    function createPosition(
        address user,
        uint256 cusdAmount,
        string calldata planType,
        bool isBonus
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused returns (uint256 posId) {
        require(cusdAmount > 0 && user != address(0), "Invalid");

        // Mint cUSD to Vault
        cusd.mint(address(this), cusdAmount);

        // Track position
        uint256 duration = _parseDuration(planType);
        uint256 rate = _parseRate(planType);

        posId = positions.length;
        positions.push(Position(
            user, cusdAmount, planType, rate,
            block.timestamp, duration, isBonus, true
        ));
        userPositionIds[user].push(posId);

        totalDeposited += cusdAmount;
        positionCount++;

        emit PositionCreated(posId, user, cusdAmount, planType, isBonus);
    }

    /// @notice Batch create positions
    function batchCreatePositions(
        address[] calldata users,
        uint256[] calldata amounts,
        string[] calldata planTypes,
        bool[] calldata isBonus
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused {
        require(users.length == amounts.length && users.length == planTypes.length && users.length == isBonus.length, "Mismatch");

        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] == 0 || users[i] == address(0)) continue;

            cusd.mint(address(this), amounts[i]);

            uint256 duration = _parseDuration(planTypes[i]);
            uint256 rate = _parseRate(planTypes[i]);

            uint256 posId = positions.length;
            positions.push(Position(
                users[i], amounts[i], planTypes[i], rate,
                block.timestamp, duration, isBonus[i], true
            ));
            userPositionIds[users[i]].push(posId);

            totalDeposited += amounts[i];
            positionCount++;

            emit PositionCreated(posId, users[i], amounts[i], planTypes[i], isBonus[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Add daily interest (cUSD only, no MA here)
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine adds cUSD interest to Vault (increases totalAssets).
    ///         MA minting happens separately outside this contract.
    function addInterest(uint256 cusdAmount) external onlyRole(ENGINE_ROLE) nonReentrant {
        require(cusdAmount > 0, "Zero");
        cusd.mint(address(this), cusdAmount);
        totalInterestMinted += cusdAmount;
        emit InterestAdded(cusdAmount, positionCount);
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Close position
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine closes a position (matured or early exit)
    function closePosition(uint256 posId) external onlyRole(ENGINE_ROLE) {
        require(posId < positions.length, "Invalid");
        Position storage pos = positions[posId];
        require(pos.active, "Already closed");
        pos.active = false;
    }

    // ─── View ────────────────────────────────────────────────

    function getPosition(uint256 posId) external view returns (Position memory) {
        return positions[posId];
    }

    function getUserPositions(address user) external view returns (Position[] memory, uint256[] memory ids) {
        uint256[] storage posIds = userPositionIds[user];
        Position[] memory result = new Position[](posIds.length);
        for (uint256 i = 0; i < posIds.length; i++) {
            result[i] = positions[posIds[i]];
        }
        return (result, posIds);
    }

    function getActivePositionCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].active) count++;
        }
    }

    function getVaultStats() external view returns (
        uint256 totalAssets_,
        uint256 deposited,
        uint256 interestMinted,
        uint256 totalPositions,
        uint256 activePositions
    ) {
        totalAssets_ = totalAssets();
        deposited = totalDeposited;
        interestMinted = totalInterestMinted;
        totalPositions = positionCount;
        // count active
        for (uint256 i = 0; i < positions.length; i++) {
            if (positions[i].active) activePositions++;
        }
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

    function _eq(string calldata a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    // ─── Admin ───────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
