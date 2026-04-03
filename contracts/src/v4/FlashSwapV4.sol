// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FlashSwap V4 — Server-Assisted MA → USDT via PancakeSwap (UUPS Upgradeable)
/// @notice Two-step flash swap:
///   Step 1 (on-chain): User calls requestSwap() → MA burned, SwapRequested event emitted
///   Step 2 (server):   Engine listens → USDC swap via PancakeSwap (0x92b7) → USDT to user
///
///  On-chain visible:
///    TX1: MA Transfer user→0x0 (burn)
///    TX2: USDC Engine→Pool(0x92b7), USDT Pool→Engine→User

interface IMATokenBurnable {
    function burnFrom(address from, uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
}

interface IPriceOracle {
    function getPrice() external view returns (uint256); // 6 decimals
}

contract FlashSwapV4 is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    IMATokenBurnable public maToken;
    IPriceOracle public oracle;

    uint256 public minSwapAmount;
    uint256 public feeBps;

    // ─── Tracking ────────────────────────────────────────────

    uint256 public totalBurned;
    uint256 public totalUSDTPaid;
    uint256 public swapCount;
    uint256 public pendingCount;

    mapping(address => uint256) public lastSwapDay;
    mapping(address => uint256) public dailySwapped;
    uint256 public dailyUserLimit;
    uint256 public dailyGlobalLimit;
    uint256 public globalLastDay;
    uint256 public globalDailySwapped;

    // ─── Swap Request ────────────────────────────────────────

    struct SwapRequest {
        address user;
        uint256 maAmount;
        uint256 usdtOut;
        uint256 maPrice;
        uint256 fee;
        uint256 timestamp;
        bool fulfilled;
    }

    mapping(uint256 => SwapRequest) public requests;
    uint256 public nextRequestId;

    // ─── Events ──────────────────────────────────────────────

    event SwapRequested(
        uint256 indexed requestId,
        address indexed user,
        uint256 maAmount,
        uint256 usdtOut,
        uint256 maPrice,
        uint256 fee
    );

    event SwapFulfilled(
        uint256 indexed requestId,
        address indexed user,
        uint256 usdtOut,
        bytes32 txHash
    );

    // ─── Initialize (replaces constructor) ───────────────────

    function initialize(
        address _maToken,
        address _oracle
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        maToken = IMATokenBurnable(_maToken);
        oracle = IPriceOracle(_oracle);
        minSwapAmount = 1e18;
        dailyUserLimit = 0;
        dailyGlobalLimit = 0;
        feeBps = 0;
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 1: User requests swap (burns MA on-chain)
    // ═══════════════════════════════════════════════════════════

    function requestSwap(uint256 maAmount) external nonReentrant whenNotPaused returns (uint256 requestId) {
        require(maAmount >= minSwapAmount, "Below minimum");
        address user = msg.sender;

        _checkLimits(user, maAmount);

        uint256 maPrice = oracle.getPrice();
        require(maPrice > 0, "Oracle price zero");

        uint256 usdtOut = (maAmount * maPrice) / 1e6;

        uint256 fee = 0;
        if (feeBps > 0) {
            fee = (usdtOut * feeBps) / 10000;
            usdtOut -= fee;
        }

        maToken.burnFrom(user, maAmount);

        requestId = nextRequestId++;
        requests[requestId] = SwapRequest({
            user: user,
            maAmount: maAmount,
            usdtOut: usdtOut,
            maPrice: maPrice,
            fee: fee,
            timestamp: block.timestamp,
            fulfilled: false
        });

        totalBurned += maAmount;
        swapCount++;
        pendingCount++;

        emit SwapRequested(requestId, user, maAmount, usdtOut, maPrice, fee);
    }

    // ═══════════════════════════════════════════════════════════
    //  STEP 2: Engine fulfills swap
    // ═══════════════════════════════════════════════════════════

    function fulfillSwap(uint256 requestId, bytes32 txHash) external onlyRole(ENGINE_ROLE) {
        SwapRequest storage req = requests[requestId];
        require(req.user != address(0), "Invalid request");
        require(!req.fulfilled, "Already fulfilled");

        req.fulfilled = true;
        totalUSDTPaid += req.usdtOut;
        pendingCount--;

        emit SwapFulfilled(requestId, req.user, req.usdtOut, txHash);
    }

    function batchFulfill(uint256[] calldata requestIds, bytes32[] calldata txHashes) external onlyRole(ENGINE_ROLE) {
        require(requestIds.length == txHashes.length, "Length mismatch");
        for (uint256 i = 0; i < requestIds.length; i++) {
            SwapRequest storage req = requests[requestIds[i]];
            if (req.user == address(0) || req.fulfilled) continue;
            req.fulfilled = true;
            totalUSDTPaid += req.usdtOut;
            pendingCount--;
            emit SwapFulfilled(requestIds[i], req.user, req.usdtOut, txHashes[i]);
        }
    }

    // ─── View ────────────────────────────────────────────────

    function quoteSwap(uint256 maAmount) external view returns (uint256 usdtOut, uint256 fee, uint256 maPrice) {
        maPrice = oracle.getPrice();
        uint256 gross = (maAmount * maPrice) / 1e6;
        fee = feeBps > 0 ? (gross * feeBps) / 10000 : 0;
        usdtOut = gross - fee;
    }

    function getRequest(uint256 requestId) external view returns (SwapRequest memory) {
        return requests[requestId];
    }

    function getPendingRequests(uint256 fromId, uint256 limit) external view returns (SwapRequest[] memory, uint256[] memory ids) {
        uint256 count = 0;
        for (uint256 i = fromId; i < nextRequestId && count < limit; i++) {
            if (!requests[i].fulfilled && requests[i].user != address(0)) count++;
        }
        SwapRequest[] memory pending = new SwapRequest[](count);
        ids = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = fromId; i < nextRequestId && idx < count; i++) {
            if (!requests[i].fulfilled && requests[i].user != address(0)) {
                pending[idx] = requests[i];
                ids[idx] = i;
                idx++;
            }
        }
        return (pending, ids);
    }

    // ─── Limits ──────────────────────────────────────────────

    function _checkLimits(address user, uint256 amount) internal {
        uint256 today = block.timestamp / 1 days;
        if (dailyUserLimit > 0) {
            if (lastSwapDay[user] != today) { lastSwapDay[user] = today; dailySwapped[user] = 0; }
            require(dailySwapped[user] + amount <= dailyUserLimit, "User daily limit");
            dailySwapped[user] += amount;
        }
        if (dailyGlobalLimit > 0) {
            if (globalLastDay != today) { globalLastDay = today; globalDailySwapped = 0; }
            require(globalDailySwapped + amount <= dailyGlobalLimit, "Global daily limit");
            globalDailySwapped += amount;
        }
    }

    // ─── Admin ───────────────────────────────────────────────

    function setDailyUserLimit(uint256 _limit) external onlyRole(DEFAULT_ADMIN_ROLE) { dailyUserLimit = _limit; }
    function setDailyGlobalLimit(uint256 _limit) external onlyRole(DEFAULT_ADMIN_ROLE) { dailyGlobalLimit = _limit; }
    function setMinSwapAmount(uint256 _min) external onlyRole(DEFAULT_ADMIN_ROLE) { minSwapAmount = _min; }
    function setFeeBps(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_bps <= 1000); feeBps = _bps; }
    function setOracle(address _o) external onlyRole(DEFAULT_ADMIN_ROLE) { oracle = IPriceOracle(_o); }
    function setMAToken(address _ma) external onlyRole(DEFAULT_ADMIN_ROLE) { maToken = IMATokenBurnable(_ma); }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
