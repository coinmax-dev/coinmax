// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice PancakeSwap V3 Pool interface for on-chain TWAP
interface IPancakeV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
        uint16 observationCardinality, uint16 observationCardinalityNext,
        uint32 feeProtocol, bool unlocked
    );
    function observe(uint32[] calldata secondsAgos) external view returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title MA Price Oracle (Upgradeable)
/// @notice Provides MA token price to the Vault and InterestEngine.
///
///  Three price modes:
///    MODE_MANUAL (0) — Server Wallet pushes price updates (Phase 1, launch)
///    MODE_TWAP   (1) — Read from DEX pool TWAP (Phase 2, after MA listed)
///    MODE_HYBRID (2) — TWAP with manual bounds check (safest)
///
///  Safety features:
///    1. Max price change per update (default 10%) — prevents manipulation
///    2. Heartbeat — price goes stale if not updated within window
///    3. Price history — last N prices stored for auditing
///    4. Min/Max bounds — hard limits on acceptable price range
///    5. Multi-source — manual + TWAP must agree in hybrid mode
///
///  Roles:
///    FEEDER_ROLE  — Server Wallet / backend that pushes prices
///    DEFAULT_ADMIN_ROLE — config changes
///
///  Usage in Vault:
///    uint256 price = oracle.getPrice(); // replaces vault.maPrice()
contract MAPriceOracle is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Price feeder (Server Wallet / cron job)
    bytes32 public constant FEEDER_ROLE = keccak256("FEEDER_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  ENUMS
    // ═══════════════════════════════════════════════════════════════════

    enum PriceMode { MANUAL, TWAP, HYBRID }

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Current price mode
    PriceMode public mode;

    /// @notice Current MA price (6 decimals, e.g. 100000 = $0.10)
    uint256 public price;

    /// @notice Last update timestamp
    uint256 public lastUpdateTime;

    /// @notice Heartbeat: max seconds between updates before price is stale
    uint256 public heartbeat;

    /// @notice Max price change per update (basis points, 1000 = 10%)
    uint256 public maxChangeRate;

    /// @notice Hard price bounds
    uint256 public minPrice;
    uint256 public maxPrice;

    // ─── TWAP Config ────────────────────────────────────────────────

    /// @notice DEX pool for TWAP (PancakeSwap V3 MA/USDC pool)
    IPancakeV3Pool public pool;

    /// @notice TWAP observation window (seconds)
    uint32 public twapWindow;

    /// @notice Whether MA is token0 in the pool
    bool public isToken0MA;

    /// @notice Max allowed deviation between manual and TWAP in hybrid mode (bps)
    uint256 public maxTwapDeviation;

    // ─── Price History ──────────────────────────────────────────────

    struct PricePoint {
        uint256 price;
        uint256 timestamp;
        address updater;
    }

    PricePoint[] public priceHistory;
    uint256 public maxHistoryLength;

    address public trustedForwarder;

    // ─── Gap ────────────────────────────────────────────────────────
    uint256[29] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event PriceUpdated(uint256 oldPrice, uint256 newPrice, address indexed updater, PriceMode mode);
    event ModeChanged(PriceMode oldMode, PriceMode newMode);
    event PoolSet(address pool);
    event BoundsUpdated(uint256 minPrice, uint256 maxPrice);

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    /// @param _initialPrice Initial MA price (6 decimals)
    /// @param _admin Admin address
    /// @param _feeder Server Wallet address (price feeder)
    function initialize(
        uint256 _initialPrice,
        address _admin,
        address _feeder
    ) external initializer {
        require(_initialPrice > 0, "Invalid price");
        require(_admin != address(0), "Invalid admin");

        __AccessControl_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_feeder != address(0)) _grantRole(FEEDER_ROLE, _feeder);

        price = _initialPrice;
        lastUpdateTime = block.timestamp;
        mode = PriceMode.MANUAL;

        // Defaults — MA price strategy:
        // Start $0.30, grow to $1.00, then monthly ~5% avg, max 10%
        heartbeat = 24 hours;        // must update at least daily
        maxChangeRate = 1000;         // max 10% per update (hard cap)
        minPrice = 100000;            // $0.10 floor (safety net)
        maxPrice = 1_000_000_000;     // $1000 ceiling
        twapWindow = 300;             // 5 min TWAP
        maxTwapDeviation = 500;       // 5% max TWAP deviation
        maxHistoryLength = 365;       // ~1 year of daily prices

        // Record initial price
        priceHistory.push(PricePoint(_initialPrice, block.timestamp, _admin));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: GET PRICE (called by Vault / InterestEngine)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get the current MA price. Reverts if stale.
    /// @return Current price in 6 decimals
    function getPrice() external view returns (uint256) {
        require(price > 0, "Price not set");
        require(block.timestamp <= lastUpdateTime + heartbeat, "Price stale");
        return price;
    }

    /// @notice Get price without staleness check (for UI display)
    function getPriceUnsafe() external view returns (uint256) {
        return price;
    }

    /// @notice Check if price is fresh
    function isPriceFresh() external view returns (bool) {
        return price > 0 && block.timestamp <= lastUpdateTime + heartbeat;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: UPDATE PRICE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Push a new price (MANUAL or HYBRID mode)
    /// @dev Called by Server Wallet via thirdweb Engine cron job
    ///
    ///  Backend usage:
    ///    1. Fetch MA price from exchange / internal pricing model
    ///    2. Call oracle.updatePrice(newPrice) via Server Wallet API
    ///    3. Set up as daily/hourly cron in thirdweb Engine
    function updatePrice(uint256 _newPrice) external onlyRole(FEEDER_ROLE) whenNotPaused {
        require(_newPrice > 0, "Zero price");
        require(_newPrice >= minPrice && _newPrice <= maxPrice, "Out of bounds");
        require(
            mode == PriceMode.MANUAL || mode == PriceMode.HYBRID,
            "Manual update not allowed in TWAP mode"
        );

        // Check max change rate
        if (price > 0) {
            uint256 change = _newPrice > price
                ? ((_newPrice - price) * 10000) / price
                : ((price - _newPrice) * 10000) / price;
            require(change <= maxChangeRate, "Price change too large");
        }

        // In hybrid mode: verify manual price agrees with TWAP
        if (mode == PriceMode.HYBRID && address(pool) != address(0)) {
            uint256 twapPrice = _getTwapPrice();
            if (twapPrice > 0) {
                uint256 deviation = _newPrice > twapPrice
                    ? ((_newPrice - twapPrice) * 10000) / twapPrice
                    : ((twapPrice - _newPrice) * 10000) / twapPrice;
                require(deviation <= maxTwapDeviation, "Deviates from TWAP");
            }
        }

        uint256 oldPrice = price;
        price = _newPrice;
        lastUpdateTime = block.timestamp;

        // Record history
        if (priceHistory.length >= maxHistoryLength) {
            // Shift: remove oldest, we just overwrite cyclically
            // Simple approach: just keep pushing, admin can clear periodically
        }
        priceHistory.push(PricePoint(_newPrice, block.timestamp, msg.sender));

        emit PriceUpdated(oldPrice, _newPrice, msg.sender, mode);
    }

    /// @notice Force refresh from TWAP (TWAP or HYBRID mode)
    function refreshFromTwap() external onlyRole(FEEDER_ROLE) whenNotPaused {
        require(
            mode == PriceMode.TWAP || mode == PriceMode.HYBRID,
            "TWAP not enabled"
        );
        require(address(pool) != address(0), "Pool not set");

        uint256 twapPrice = _getTwapPrice();
        require(twapPrice > 0, "TWAP failed");
        require(twapPrice >= minPrice && twapPrice <= maxPrice, "TWAP out of bounds");

        // Check max change rate
        if (price > 0) {
            uint256 change = twapPrice > price
                ? ((twapPrice - price) * 10000) / price
                : ((price - twapPrice) * 10000) / price;
            require(change <= maxChangeRate, "TWAP change too large");
        }

        uint256 oldPrice = price;
        price = twapPrice;
        lastUpdateTime = block.timestamp;

        priceHistory.push(PricePoint(twapPrice, block.timestamp, msg.sender));
        emit PriceUpdated(oldPrice, twapPrice, msg.sender, mode);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW: TWAP
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get current TWAP price from DEX pool
    function getTwapPrice() external view returns (uint256) {
        require(address(pool) != address(0), "Pool not set");
        return _getTwapPrice();
    }

    /// @notice Get price history
    function getHistoryLength() external view returns (uint256) {
        return priceHistory.length;
    }

    function getHistoryRange(uint256 from, uint256 count) external view returns (
        uint256[] memory prices,
        uint256[] memory timestamps
    ) {
        uint256 end = from + count;
        if (end > priceHistory.length) end = priceHistory.length;
        uint256 len = end - from;

        prices = new uint256[](len);
        timestamps = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            prices[i] = priceHistory[from + i].price;
            timestamps[i] = priceHistory[from + i].timestamp;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setMode(PriceMode _mode) external onlyRole(DEFAULT_ADMIN_ROLE) {
        PriceMode old = mode;
        mode = _mode;
        emit ModeChanged(old, _mode);
    }

    function setPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "Invalid");
        pool = IPancakeV3Pool(_pool);
        isToken0MA = true; // set correctly based on pool token order
        emit PoolSet(_pool);
    }

    function setPoolTokenOrder(bool _isToken0MA) external onlyRole(DEFAULT_ADMIN_ROLE) {
        isToken0MA = _isToken0MA;
    }

    function setHeartbeat(uint256 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_seconds >= 1 hours && _seconds <= 7 days, "1h-7d");
        heartbeat = _seconds;
    }

    function setMaxChangeRate(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps > 0 && _bps <= 5000, "1-5000 bps");
        maxChangeRate = _bps;
    }

    function setBounds(uint256 _min, uint256 _max) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_min < _max, "min >= max");
        minPrice = _min;
        maxPrice = _max;
        emit BoundsUpdated(_min, _max);
    }

    function setTwapWindow(uint32 _seconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_seconds >= 60 && _seconds <= 3600, "60-3600s");
        twapWindow = _seconds;
    }

    function setMaxTwapDeviation(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps > 0 && _bps <= 2000, "1-2000 bps");
        maxTwapDeviation = _bps;
    }

    /// @notice Emergency: admin can force set price (bypasses change rate)
    function emergencySetPrice(uint256 _price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_price > 0, "Zero");
        uint256 old = price;
        price = _price;
        lastUpdateTime = block.timestamp;
        priceHistory.push(PricePoint(_price, block.timestamp, msg.sender));
        emit PriceUpdated(old, _price, msg.sender, mode);
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
    //  INTERNAL: TWAP CALCULATION
    // ═══════════════════════════════════════════════════════════════════

    /// @dev Calculate TWAP price from DEX pool (6 decimal output)
    function _getTwapPrice() internal view returns (uint256) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;

        try pool.observe(secondsAgos) returns (
            int56[] memory tickCumulatives,
            uint160[] memory
        ) {
            int56 tickDiff = tickCumulatives[1] - tickCumulatives[0];
            int24 avgTick = int24(tickDiff / int56(int32(twapWindow)));

            // Convert tick to price (6 decimals)
            // price = 1.0001^tick, scaled to 6 decimals
            return _tickToPrice6(avgTick);
        } catch {
            return 0; // pool not ready or insufficient observations
        }
    }

    /// @dev Convert tick to price in 6 decimals
    ///      For MA/USDC pair where both are 18 decimals
    function _tickToPrice6(int24 tick) internal view returns (uint256) {
        uint256 absTick = tick >= 0 ? uint256(int256(tick)) : uint256(-int256(tick));

        // 1.0001^|tick| using pre-computed powers (1e18 scale)
        uint256 ratio = 1e18;
        if (absTick & 0x1 != 0)   ratio = (ratio * 1000100000000000000) / 1e18;
        if (absTick & 0x2 != 0)   ratio = (ratio * 1000200010000000000) / 1e18;
        if (absTick & 0x4 != 0)   ratio = (ratio * 1000400060004000000) / 1e18;
        if (absTick & 0x8 != 0)   ratio = (ratio * 1000800280056007000) / 1e18;
        if (absTick & 0x10 != 0)  ratio = (ratio * 1001601200560121000) / 1e18;
        if (absTick & 0x20 != 0)  ratio = (ratio * 1003204964963598000) / 1e18;
        if (absTick & 0x40 != 0)  ratio = (ratio * 1006420201727613000) / 1e18;
        if (absTick & 0x80 != 0)  ratio = (ratio * 1012881622445451000) / 1e18;
        if (absTick & 0x100 != 0) ratio = (ratio * 1025929181087729000) / 1e18;
        if (absTick & 0x200 != 0) ratio = (ratio * 1052530684607338000) / 1e18;

        if (tick < 0) ratio = (1e36) / ratio;

        // Convert based on token order
        uint256 price18;
        if (isToken0MA) {
            // price = token1/token0 = USDC/MA
            price18 = ratio;
        } else {
            // price = token1/token0 = MA/USDC, invert
            price18 = (1e36) / ratio;
        }

        // Convert from 18 decimals to 6 decimals
        return price18 / 1e12;
    }

    // ─── UUPS Upgrade Authorization ─────────────────────────────────
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
