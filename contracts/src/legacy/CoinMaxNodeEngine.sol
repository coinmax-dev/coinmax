// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @notice Interface for MA Token (mintTo)
interface IMATokenNode {
    function mintTo(address to, uint256 amount) external;
}

/// @notice Interface for CoinMaxRelease (addAccumulated)
interface ICoinMaxReleaseNode {
    function addAccumulated(address user, uint256 amount) external;
}

/// @notice Interface for MA Price Oracle
interface IMAPriceOracleNode {
    function getPrice() external view returns (uint256);
}

/// @title CoinMax Node Engine
/// @notice Dedicated module for node daily interest processing.
///         Called by Server Wallet (thirdweb Engine) after DB settlement.
///
///  Architecture:
///    - SERVER_ROLE: thirdweb Engine wallet (daily batch processing)
///    - KEEPER_ROLE: backup keeper (Chainlink/Gelato)
///
///  Flow (daily, triggered by Edge Function via Server Wallet):
///    1. DB settle_node_fixed_yield() calculates earnings per node (9U or 54U)
///    2. Edge function reads pending node rewards from DB
///    3. Edge function calls batchMintNodeRewards(users[], usdAmounts[])
///    4. For each entry: convert USD to MA at current maPrice
///    5. Mint MA to Release contract
///    6. Credit user's accumulated balance in Release
///
///  Why separate from InterestEngine:
///    - InterestEngine reads from Vault stake positions (on-chain)
///    - Node earnings come from DB settlement (off-chain calculation)
///    - Different lifecycle: nodes have qualification checks (pause/destroy)
///
///  Proxy deployment:
///    impl = new CoinMaxNodeEngine();
///    proxy = new ERC1967Proxy(impl, abi.encodeCall(CoinMaxNodeEngine.initialize, (...)));
contract CoinMaxNodeEngine is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable
{
    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    bytes32 public constant SERVER_ROLE = keccak256("SERVER_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    IMATokenNode public maToken;
    ICoinMaxReleaseNode public releaseContract;
    IMAPriceOracleNode public priceOracle;

    /// @notice Total MA minted for node rewards (lifetime)
    uint256 public totalNodeRewardsMinted;

    /// @notice Last batch processing timestamp
    uint256 public lastBatchTime;

    /// @notice Minimum interval between batch calls
    uint256 public minBatchInterval;

    /// @notice Fallback MA price (6 decimals) if oracle unavailable
    uint256 public fallbackMAPrice;

    address public trustedForwarder;

    // ─── Gap for future upgrades ────────────────────────────────────
    uint256[38] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event NodeRewardMinted(
        address indexed user,
        uint256 usdAmount,
        uint256 maAmount,
        uint256 maPrice,
        string nodeType
    );

    event NodeBatchCompleted(
        uint256 usersProcessed,
        uint256 totalMAMinted,
        uint256 timestamp
    );

    event NodeRewardDestroyed(
        address indexed user,
        uint256 maAmount,
        string reason
    );

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _maToken MA token address
    /// @param _releaseContract CoinMaxRelease proxy address
    /// @param _priceOracle MAPriceOracle address
    /// @param _admin Admin address
    /// @param _serverWallet thirdweb Engine Server Wallet address
    function initialize(
        address _maToken,
        address _releaseContract,
        address _priceOracle,
        address _admin,
        address _serverWallet
    ) external initializer {
        require(_maToken != address(0), "Invalid MA");
        require(_releaseContract != address(0), "Invalid release");
        require(_admin != address(0), "Invalid admin");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_serverWallet != address(0)) {
            _grantRole(SERVER_ROLE, _serverWallet);
            _grantRole(KEEPER_ROLE, _serverWallet);
        }

        maToken = IMATokenNode(_maToken);
        releaseContract = ICoinMaxReleaseNode(_releaseContract);
        if (_priceOracle != address(0)) {
            priceOracle = IMAPriceOracleNode(_priceOracle);
        }

        minBatchInterval = 12 hours;
        fallbackMAPrice = 100000; // $0.10 default (6 decimals)
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: MINT SINGLE NODE REWARD
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Mint MA for a single node daily reward.
    /// @param user User wallet address
    /// @param usdAmount USD value of daily reward (18 decimals, e.g. 9e18 = 9 USD)
    /// @param nodeType "MINI" or "MAX" (for event logging)
    function mintNodeReward(
        address user,
        uint256 usdAmount,
        string calldata nodeType
    ) public whenNotPaused onlyProcessors {
        require(user != address(0), "Invalid user");
        require(usdAmount > 0, "Zero amount");

        uint256 currentMAPrice = _getMAPrice();
        require(currentMAPrice > 0, "MA price unavailable");

        // maAmount = usdAmount(18dec) × 1e6 / maPrice(6dec) = MA(18dec)
        uint256 maAmount = (usdAmount * 1e6) / currentMAPrice;
        require(maAmount > 0, "MA amount zero");

        // 1. Mint MA to Release contract
        maToken.mintTo(address(releaseContract), maAmount);

        // 2. Credit user's accumulated balance in Release
        releaseContract.addAccumulated(user, maAmount);

        totalNodeRewardsMinted += maAmount;

        emit NodeRewardMinted(user, usdAmount, maAmount, currentMAPrice, nodeType);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: BATCH MINT NODE REWARDS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Batch mint MA for multiple node daily rewards.
    ///         Called daily by Edge Function via Server Wallet after DB settlement.
    /// @param users Array of user wallet addresses
    /// @param usdAmounts Array of USD reward amounts (18 decimals each)
    /// @param nodeTypes Array of node types ("MINI" or "MAX")
    function batchMintNodeRewards(
        address[] calldata users,
        uint256[] calldata usdAmounts,
        string[] calldata nodeTypes
    ) external whenNotPaused onlyProcessors {
        require(users.length == usdAmounts.length, "Length mismatch");
        require(users.length == nodeTypes.length, "Length mismatch");
        require(users.length > 0, "Empty batch");

        uint256 currentMAPrice = _getMAPrice();
        require(currentMAPrice > 0, "MA price unavailable");

        uint256 totalMinted;
        uint256 processed;

        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0) || usdAmounts[i] == 0) continue;

            uint256 maAmount = (usdAmounts[i] * 1e6) / currentMAPrice;
            if (maAmount == 0) continue;

            maToken.mintTo(address(releaseContract), maAmount);
            releaseContract.addAccumulated(users[i], maAmount);

            totalMinted += maAmount;
            processed++;

            emit NodeRewardMinted(
                users[i], usdAmounts[i], maAmount, currentMAPrice, nodeTypes[i]
            );
        }

        lastBatchTime = block.timestamp;
        totalNodeRewardsMinted += totalMinted;

        emit NodeBatchCompleted(processed, totalMinted, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Preview: how much MA would be minted for a given USD amount
    function previewNodeReward(uint256 usdAmount) external view returns (
        uint256 maAmount,
        uint256 currentMAPrice
    ) {
        currentMAPrice = _getMAPrice();
        if (currentMAPrice > 0 && usdAmount > 0) {
            maAmount = (usdAmount * 1e6) / currentMAPrice;
        }
    }

    function getMAPrice() external view returns (uint256) {
        return _getMAPrice();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setMAToken(address _maToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maToken != address(0), "Invalid");
        maToken = IMATokenNode(_maToken);
    }

    function setReleaseContract(address _release) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_release != address(0), "Invalid");
        releaseContract = ICoinMaxReleaseNode(_release);
    }

    function setPriceOracle(address _oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceOracle = IMAPriceOracleNode(_oracle);
    }

    function setFallbackMAPrice(uint256 _price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_price > 0, "Invalid price");
        fallbackMAPrice = _price;
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

    /// @dev Get current MA price from oracle, fallback to stored price
    function _getMAPrice() internal view returns (uint256) {
        if (address(priceOracle) != address(0)) {
            try priceOracle.getPrice() returns (uint256 price) {
                if (price > 0) return price;
            } catch {}
        }
        return fallbackMAPrice;
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
