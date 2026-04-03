// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @notice Interface for CoinMaxVault — read stake data + advance interest time
interface ICoinMaxVaultEngine {
    function getStakePosition(address user, uint256 index) external view returns (
        uint256 cUsdDeposited,
        uint256 startTime,
        uint256 lastInterestTime,
        uint256 planIndex,
        bool principalClaimed
    );
    function getStakePlan(uint256 index) external view returns (
        uint256 duration,
        uint256 dailyRate,
        bool active
    );
    function getUserStakeCount(address user) external view returns (uint256);
    function advanceInterestTime(address user, uint256 stakeIndex, uint256 daysProcessed) external;
    function maPrice() external view returns (uint256);
    function getCurrentMAPrice() external view returns (uint256);
}

/// @notice Interface for MA Token (mintTo)
interface IMATokenEngine {
    function mintTo(address to, uint256 amount) external;
}

/// @notice Interface for CoinMaxRelease (addAccumulated)
interface ICoinMaxReleaseEngine {
    function addAccumulated(address user, uint256 amount) external;
}

/// @title CoinMax Interest Engine
/// @notice Dedicated module for daily interest processing. Runs via thirdweb
///         Server Wallet (Engine) — the backend signs batch transactions daily.
///
///  Architecture:
///    - SERVER_ROLE: thirdweb Engine wallet (automated daily processing)
///    - KEEPER_ROLE: Chainlink Automation / Gelato (backup keeper)
///    - PRICE_ROLE:  Oracle / admin that updates MA price
///
///  Flow (daily, triggered by Server Wallet):
///    1. Engine wallet calls batchProcessInterest(users[], indexes[])
///    2. For each position: calculate days elapsed × daily rate × USDC amount
///    3. Convert USD interest to MA at current maPrice
///    4. Mint MA to Release contract
///    5. Credit user's accumulated balance in Release
///    6. Advance position's lastInterestTime in Vault
///
///  Why separate from Vault:
///    - Single-responsibility: Vault handles deposits/claims, Engine handles interest
///    - Server Wallet isolation: only Engine has mint-interest permission
///    - Upgradeable independently: can upgrade interest logic without touching Vault
///    - Gas optimization: batch processing across many users
///
///  Proxy deployment:
///    impl = new CoinMaxInterestEngine();
///    proxy = new ERC1967Proxy(impl, abi.encodeCall(CoinMaxInterestEngine.initialize, (...)));
contract CoinMaxInterestEngine is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice thirdweb Engine Server Wallet — primary operator
    bytes32 public constant SERVER_ROLE = keccak256("SERVER_ROLE");

    /// @notice Backup keeper (Chainlink/Gelato)
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    /// @notice MA price updater (oracle or admin)
    bytes32 public constant PRICE_ROLE = keccak256("PRICE_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    ICoinMaxVaultEngine public vault;
    IMATokenEngine public maToken;
    ICoinMaxReleaseEngine public releaseContract;

    /// @notice Total MA interest minted (lifetime)
    uint256 public totalInterestMinted;

    /// @notice Last batch processing timestamp
    uint256 public lastBatchTime;

    /// @notice Minimum interval between batch calls (prevents double-processing)
    uint256 public minBatchInterval;

    address public trustedForwarder;

    // ─── Gap for future upgrades ────────────────────────────────────
    uint256[39] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event InterestProcessed(
        address indexed user,
        uint256 stakeIndex,
        uint256 daysProcessed,
        uint256 usdInterest,
        uint256 maInterest,
        uint256 maPrice
    );

    event BatchCompleted(
        uint256 positionsProcessed,
        uint256 totalMAMinted,
        uint256 timestamp
    );

    event MAPriceUpdated(uint256 oldPrice, uint256 newPrice);

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _vault CoinMaxVault proxy address
    /// @param _maToken MA token address
    /// @param _releaseContract CoinMaxRelease proxy address
    /// @param _admin Admin address
    /// @param _serverWallet thirdweb Engine Server Wallet address
    function initialize(
        address _vault,
        address _maToken,
        address _releaseContract,
        address _admin,
        address _serverWallet
    ) external initializer {
        require(_vault != address(0), "Invalid vault");
        require(_maToken != address(0), "Invalid MA");
        require(_releaseContract != address(0), "Invalid release");
        require(_admin != address(0), "Invalid admin");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_serverWallet != address(0)) {
            _grantRole(SERVER_ROLE, _serverWallet);
            _grantRole(KEEPER_ROLE, _serverWallet);
            _grantRole(PRICE_ROLE, _serverWallet);
        }

        vault = ICoinMaxVaultEngine(_vault);
        maToken = IMATokenEngine(_maToken);
        releaseContract = ICoinMaxReleaseEngine(_releaseContract);
        minBatchInterval = 12 hours; // prevent double-processing within same day
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: PROCESS SINGLE POSITION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Process daily interest for a single stake position.
    ///         Called by Server Wallet or Keeper.
    ///
    ///  Formula:
    ///    dailyInterestUSD = cUsdDeposited × dailyRate / 10000
    ///    totalInterestUSD = dailyInterestUSD × daysElapsed
    ///    maInterest = totalInterestUSD × 1e6 / maPrice
    function processInterest(
        address user,
        uint256 stakeIndex
    ) public whenNotPaused onlyProcessors {
        (uint256 maInterest, uint256 daysElapsed, uint256 usdInterest) =
            _calculateInterest(user, stakeIndex);

        if (daysElapsed == 0 || maInterest == 0) return;

        // 1. Mint MA to Release contract
        maToken.mintTo(address(releaseContract), maInterest);

        // 2. Credit user's accumulated balance in Release
        releaseContract.addAccumulated(user, maInterest);

        // 3. Advance lastInterestTime in Vault
        vault.advanceInterestTime(user, stakeIndex, daysElapsed);

        totalInterestMinted += maInterest;

        emit InterestProcessed(
            user,
            stakeIndex,
            daysElapsed,
            usdInterest,
            maInterest,
            vault.getCurrentMAPrice()
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: BATCH PROCESSING (Server Wallet daily job)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Batch process interest for multiple positions.
    ///         Called daily by thirdweb Engine Server Wallet.
    /// @param users Array of user addresses
    /// @param stakeIndexes Array of stake position indexes
    function batchProcessInterest(
        address[] calldata users,
        uint256[] calldata stakeIndexes
    ) external whenNotPaused onlyProcessors {
        require(users.length == stakeIndexes.length, "Length mismatch");
        require(users.length > 0, "Empty batch");

        uint256 totalMinted;
        uint256 processed;

        for (uint256 i = 0; i < users.length; i++) {
            (uint256 maInterest, uint256 daysElapsed, uint256 usdInterest) =
                _calculateInterest(users[i], stakeIndexes[i]);

            if (daysElapsed == 0 || maInterest == 0) continue;

            maToken.mintTo(address(releaseContract), maInterest);
            releaseContract.addAccumulated(users[i], maInterest);
            vault.advanceInterestTime(users[i], stakeIndexes[i], daysElapsed);

            totalMinted += maInterest;
            processed++;

            emit InterestProcessed(
                users[i],
                stakeIndexes[i],
                daysElapsed,
                usdInterest,
                maInterest,
                vault.getCurrentMAPrice()
            );
        }

        lastBatchTime = block.timestamp;
        totalInterestMinted += totalMinted;

        emit BatchCompleted(processed, totalMinted, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW: PREVIEW INTEREST
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Preview pending interest for a position (without processing)
    function previewInterest(
        address user,
        uint256 stakeIndex
    ) external view returns (
        uint256 daysElapsed,
        uint256 usdInterest,
        uint256 maInterest,
        uint256 currentMAPrice
    ) {
        (maInterest, daysElapsed, usdInterest) = _calculateInterest(user, stakeIndex);
        currentMAPrice = vault.maPrice();
    }

    /// @notice Preview batch: total pending interest for multiple positions
    function previewBatch(
        address[] calldata users,
        uint256[] calldata stakeIndexes
    ) external view returns (
        uint256 totalDays,
        uint256 totalUsdInterest,
        uint256 totalMAInterest
    ) {
        require(users.length == stakeIndexes.length, "Length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            (uint256 maInt, uint256 days_, uint256 usdInt) =
                _calculateInterest(users[i], stakeIndexes[i]);
            totalDays += days_;
            totalUsdInterest += usdInt;
            totalMAInterest += maInt;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "Invalid");
        vault = ICoinMaxVaultEngine(_vault);
    }

    function setReleaseContract(address _release) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_release != address(0), "Invalid");
        releaseContract = ICoinMaxReleaseEngine(_release);
    }

    function setMAToken(address _maToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maToken != address(0), "Invalid");
        maToken = IMATokenEngine(_maToken);
    }

    function setMinBatchInterval(uint256 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        minBatchInterval = _seconds;
    }

    function setTrustedForwarder(address _forwarder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedForwarder = _forwarder;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ═══════════════════════════════════════════════════════════════════
    //  EIP-2771 META-TX SUPPORT
    // ═══════════════════════════════════════════════════════════════════

    function _msgSender() internal view override(ContextUpgradeable) returns (address sender) {
        if (msg.sender == trustedForwarder && trustedForwarder != address(0) && msg.data.length >= 20) {
            assembly { sender := shr(96, calldataload(sub(calldatasize(), 20))) }
        } else {
            sender = msg.sender;
        }
    }

    function _msgData() internal view override(ContextUpgradeable) returns (bytes calldata) {
        if (msg.sender == trustedForwarder && trustedForwarder != address(0) && msg.data.length >= 20) {
            return msg.data[:msg.data.length - 20];
        }
        return msg.data;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Calculate pending interest for a position
    function _calculateInterest(
        address user,
        uint256 stakeIndex
    ) internal view returns (
        uint256 maInterest,
        uint256 daysElapsed,
        uint256 usdInterest
    ) {
        (
            uint256 cUsdDeposited,
            uint256 startTime,
            uint256 lastInterestTime,
            uint256 planIndex,
            bool principalClaimed
        ) = vault.getStakePosition(user, stakeIndex);

        if (principalClaimed) return (0, 0, 0);

        (uint256 duration, uint256 dailyRate,) = vault.getStakePlan(planIndex);

        // Interest accrues only during the lock period
        uint256 endTime = startTime + duration;
        uint256 currentTime = block.timestamp < endTime ? block.timestamp : endTime;

        if (currentTime <= lastInterestTime) return (0, 0, 0);

        daysElapsed = (currentTime - lastInterestTime) / 1 days;
        if (daysElapsed == 0) return (0, 0, 0);

        // dailyInterestUSD = cUsdDeposited × dailyRate / 10000
        uint256 dailyInterestUSD = (cUsdDeposited * dailyRate) / 10000;
        usdInterest = dailyInterestUSD * daysElapsed;

        // maInterest = usdInterest(18dec) × 1e6 / maPrice(6dec) = MA(18dec)
        uint256 currentMAPrice = vault.getCurrentMAPrice();
        if (currentMAPrice == 0) return (0, 0, 0);

        maInterest = (usdInterest * 1e6) / currentMAPrice;
    }

    /// @dev Modifier: only SERVER_ROLE or KEEPER_ROLE
    modifier onlyProcessors() {
        require(
            hasRole(SERVER_ROLE, msg.sender) || hasRole(KEEPER_ROLE, msg.sender),
            "Not authorized processor"
        );
        _;
    }
}
