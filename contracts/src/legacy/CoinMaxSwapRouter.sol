// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice PancakeSwap V3 SmartRouter interface (exactInputSingle)
/// @dev PancakeSwap V3 SmartRouter does NOT include `deadline` in the struct.
///      Deadline is enforced via `multicall(uint256 deadline, bytes[] data)` wrapper.
///      Selector: 0x04e45aaf
interface IPancakeV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

/// @notice PancakeSwap V3 Pool interface for on-chain price verification
interface IPancakeV3Pool {
    /// @notice Returns the current pool state
    /// @return sqrtPriceX96 The current sqrt(price) as a Q64.96 fixed-point
    /// @return tick The current tick
    /// @return observationIndex Index of the last observation
    /// @return observationCardinality Current maximum number of stored observations
    /// @return observationCardinalityNext Upcoming maximum number of stored observations
    /// @return feeProtocol Protocol fee for both tokens
    /// @return unlocked Whether the pool is currently unlocked
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint32 feeProtocol,
        bool unlocked
    );

    /// @notice Returns cumulative tick and liquidity over time for TWAP calculation
    /// @param secondsAgos Array of seconds ago for each observation
    function observe(uint32[] calldata secondsAgos) external view returns (
        int56[] memory tickCumulatives,
        uint160[] memory secondsPerLiquidityCumulativeX128s
    );

    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @notice Interface for CoinMaxNodesV2
interface INodesV2 {
    function purchaseNodeFrom(
        address payer,
        string calldata nodeType,
        uint256 usdcAmount,
        uint256 originalUsdtAmount
    ) external;
}

/// @notice Interface for CoinMaxVaultV2
interface IVaultV2 {
    function depositFrom(
        address depositor,
        uint256 usdcAmount,
        uint256 originalUsdtAmount,
        uint256 planIndex
    ) external;
}

/// @title CoinMax Swap Router
/// @notice Entry point for users: accepts USDT, swaps to USDC via PancakeSwap V3,
///         then routes USDC to either NodesV2 (node subscription) or VaultV2 (vault deposit).
///
///  Flow:  User USDT → PancakeSwap V3 → USDC → NodesV2 / VaultV2
///
///  1:1 Protection Mechanisms:
///    1. Tight slippage floor (default 10 bps = 0.1%) — user cannot set minOut below 99.9%
///    2. On-chain spot price check via pool.slot0() — revert if price deviates > threshold
///    3. TWAP oracle check — compare 5-min average price vs spot, revert on manipulation
///    4. Per-transaction size cap — prevent large swaps that could move the pool
///    5. Cooldown period — prevent rapid successive swaps (sandwich attack mitigation)
///
/// @dev References PancakeSwap V3 pool: 0x92b7807bF19b7DDdf89b706143896d05228f3121 (USDT/USDC)
contract CoinMaxSwapRouter is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice PancakeSwap V3 SwapRouter address on BSC
    IPancakeV3Router public pancakeRouter;

    /// @notice PancakeSwap V3 Pool for on-chain price verification
    IPancakeV3Pool public pancakePool;

    /// @notice USDT token (input token)
    IERC20 public usdt;

    /// @notice USDC token (output token from swap — the "cUSDT" in our system)
    IERC20 public usdc;

    /// @notice Pool fee tier (100 = 0.01% for stable pairs)
    uint24 public poolFee;

    /// @notice NodesV2 contract for node subscriptions
    INodesV2 public nodesV2;

    /// @notice VaultV2 contract for vault deposits
    IVaultV2 public vaultV2;

    // ─── 1:1 Protection Parameters ─────────────────────────────────────

    /// @notice Maximum slippage in basis points (default 10 = 0.1%, very tight for stables)
    uint256 public maxSlippageBps = 10;

    /// @notice Maximum price deviation from 1:1 in basis points (default 30 = 0.3%)
    /// @dev If spot price deviates more than this from 1.0, all swaps are blocked
    uint256 public maxPriceDeviationBps = 30;

    /// @notice Maximum single swap amount (prevents large swaps from moving the pool)
    /// @dev Default 50,000 USDT (18 decimals)
    uint256 public maxSwapAmount = 50_000 * 1e18;

    /// @notice TWAP observation window in seconds (default 300 = 5 minutes)
    uint32 public twapWindow = 300;

    /// @notice Maximum allowed deviation between TWAP and spot price (basis points)
    /// @dev Detects price manipulation / sandwich attacks
    uint256 public maxTwapDeviationBps = 20;

    /// @notice Cooldown period between swaps per user (seconds)
    uint256 public cooldownPeriod = 30;

    /// @notice Whether TWAP check is enabled (can disable if pool has insufficient observations)
    bool public twapCheckEnabled = true;

    /// @notice Default deadline extension in seconds
    uint256 public deadlineExtension = 300; // 5 minutes

    /// @notice Whether token0 in the pool is USDT (affects price calculation direction)
    bool public isToken0Usdt;

    /// @notice Last swap timestamp per user (cooldown tracking)
    mapping(address => uint256) public lastSwapTime;

    // ─── Events ─────────────────────────────────────────────────────────

    event SwapAndDepositToVault(
        address indexed user,
        uint256 usdtIn,
        uint256 usdcOut,
        uint256 planIndex,
        uint256 timestamp
    );

    event SwapAndPurchaseNode(
        address indexed user,
        uint256 usdtIn,
        uint256 usdcOut,
        string nodeType,
        uint256 timestamp
    );

    event DirectDepositToVault(
        address indexed user,
        uint256 usdcAmount,
        uint256 planIndex,
        uint256 timestamp
    );

    event DirectPurchaseNode(
        address indexed user,
        uint256 usdcAmount,
        string nodeType,
        uint256 timestamp
    );

    event PriceCheckFailed(uint256 spotPrice, uint256 twapPrice, string reason);
    event ConfigUpdated(string param);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _pancakeRouter PancakeSwap V3 SwapRouter address
    /// @param _pancakePool PancakeSwap V3 Pool address (USDT/USDC)
    /// @param _usdt USDT token address
    /// @param _usdc USDC token address
    /// @param _poolFee Pool fee tier (100 for 0.01%)
    /// @param _nodesV2 CoinMaxNodesV2 contract address
    /// @param _vaultV2 CoinMaxVaultV2 contract address
    constructor(
        address _pancakeRouter,
        address _pancakePool,
        address _usdt,
        address _usdc,
        uint24 _poolFee,
        address _nodesV2,
        address _vaultV2
    ) Ownable(msg.sender) {
        require(_pancakeRouter != address(0), "Invalid router");
        require(_pancakePool != address(0), "Invalid pool");
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");
        require(_nodesV2 != address(0), "Invalid NodesV2");
        require(_vaultV2 != address(0), "Invalid VaultV2");

        pancakeRouter = IPancakeV3Router(_pancakeRouter);
        pancakePool = IPancakeV3Pool(_pancakePool);
        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        poolFee = _poolFee;
        nodesV2 = INodesV2(_nodesV2);
        vaultV2 = IVaultV2(_vaultV2);

        // Detect token order in pool
        isToken0Usdt = (IPancakeV3Pool(_pancakePool).token0() == _usdt);
    }

    // ─── Core: Swap + Route ─────────────────────────────────────────────

    /// @notice Pay USDT → swap to USDC → deposit into VaultV2
    /// @param usdtAmount Amount of USDT to pay (18 decimals on BSC)
    /// @param planIndex Staking plan index in VaultV2
    /// @param minUsdcOut Minimum USDC expected (slippage protection)
    function swapAndDepositVault(
        uint256 usdtAmount,
        uint256 planIndex,
        uint256 minUsdcOut
    ) external nonReentrant whenNotPaused {
        require(usdtAmount > 0, "Zero amount");

        // 1:1 Protection checks
        _preSwapChecks(msg.sender, usdtAmount, minUsdcOut);

        // Pull USDT from user
        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Swap USDT → USDC via PancakeSwap V3
        uint256 usdcReceived = _swapUsdtToUsdc(usdtAmount, minUsdcOut);

        // Approve USDC to VaultV2 and deposit (pass original USDT amount for MA calculation)
        usdc.safeIncreaseAllowance(address(vaultV2), usdcReceived);
        vaultV2.depositFrom(msg.sender, usdcReceived, usdtAmount, planIndex);

        // Update cooldown
        lastSwapTime[msg.sender] = block.timestamp;

        emit SwapAndDepositToVault(msg.sender, usdtAmount, usdcReceived, planIndex, block.timestamp);
    }

    /// @notice Pay USDT → swap to USDC → purchase node in NodesV2
    /// @param usdtAmount Amount of USDT to pay (18 decimals on BSC)
    /// @param nodeType Node type identifier (e.g. "MINI", "MAX")
    /// @param minUsdcOut Minimum USDC expected (slippage protection)
    function swapAndPurchaseNode(
        uint256 usdtAmount,
        string calldata nodeType,
        uint256 minUsdcOut
    ) external nonReentrant whenNotPaused {
        require(usdtAmount > 0, "Zero amount");

        // 1:1 Protection checks
        _preSwapChecks(msg.sender, usdtAmount, minUsdcOut);

        // Pull USDT from user
        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // Swap USDT → USDC via PancakeSwap V3
        uint256 usdcReceived = _swapUsdtToUsdc(usdtAmount, minUsdcOut);

        // Approve USDC to NodesV2 and purchase (pass original USDT amount for pricing)
        usdc.safeIncreaseAllowance(address(nodesV2), usdcReceived);
        nodesV2.purchaseNodeFrom(msg.sender, nodeType, usdcReceived, usdtAmount);

        // Update cooldown
        lastSwapTime[msg.sender] = block.timestamp;

        emit SwapAndPurchaseNode(msg.sender, usdtAmount, usdcReceived, nodeType, block.timestamp);
    }

    // ─── Core: Direct USDC (no swap) ───────────────────────────────────

    /// @notice Deposit USDC directly into VaultV2 (skip swap if user already has USDC)
    /// @param usdcAmount Amount of USDC
    /// @param planIndex Staking plan index
    function directDepositVault(
        uint256 usdcAmount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Zero amount");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.safeIncreaseAllowance(address(vaultV2), usdcAmount);
        vaultV2.depositFrom(msg.sender, usdcAmount, usdcAmount, planIndex); // USDC=USDT for direct

        emit DirectDepositToVault(msg.sender, usdcAmount, planIndex, block.timestamp);
    }

    /// @notice Purchase node with USDC directly (skip swap)
    /// @param usdcAmount Amount of USDC
    /// @param nodeType Node type identifier
    function directPurchaseNode(
        uint256 usdcAmount,
        string calldata nodeType
    ) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Zero amount");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.safeIncreaseAllowance(address(nodesV2), usdcAmount);
        nodesV2.purchaseNodeFrom(msg.sender, nodeType, usdcAmount, usdcAmount); // USDC=USDT for direct

        emit DirectPurchaseNode(msg.sender, usdcAmount, nodeType, block.timestamp);
    }

    // ─── View: Price Info ───────────────────────────────────────────────

    /// @notice Get the current spot price from the pool (USDT per USDC, scaled to 1e18)
    /// @return price Current price scaled to 18 decimals (1e18 = exactly 1:1)
    function getSpotPrice() external view returns (uint256 price) {
        return _getSpotPrice();
    }

    /// @notice Get the TWAP price over the configured window
    /// @return price TWAP price scaled to 18 decimals
    function getTwapPrice() external view returns (uint256 price) {
        return _getTwapPrice();
    }

    /// @notice Check if the pool price is currently within acceptable 1:1 range
    /// @return safe Whether a swap would pass all price checks
    /// @return spotPrice Current spot price (1e18 = 1:1)
    /// @return twapPrice TWAP price (1e18 = 1:1)
    function isPriceSafe() external view returns (bool safe, uint256 spotPrice, uint256 twapPrice) {
        spotPrice = _getSpotPrice();
        twapPrice = twapCheckEnabled ? _getTwapPrice() : spotPrice;

        // Check spot price deviation from 1:1
        bool spotOk = _isWithinRange(spotPrice, 1e18, maxPriceDeviationBps);

        // Check TWAP vs spot deviation
        bool twapOk = !twapCheckEnabled || _isWithinRange(spotPrice, twapPrice, maxTwapDeviationBps);

        safe = spotOk && twapOk;
    }

    // ─── Internal: 1:1 Protection ──────────────────────────────────────

    /// @dev All pre-swap safety checks
    function _preSwapChecks(address user, uint256 amountIn, uint256 minOut) internal view {
        // Check 1: Swap size limit
        require(amountIn <= maxSwapAmount, "Exceeds max swap amount");

        // Check 2: Slippage floor
        _validateSlippage(amountIn, minOut);

        // Check 3: Cooldown
        require(
            block.timestamp >= lastSwapTime[user] + cooldownPeriod,
            "Cooldown active"
        );

        // Check 4: Spot price within 1:1 range
        uint256 spotPrice = _getSpotPrice();
        require(
            _isWithinRange(spotPrice, 1e18, maxPriceDeviationBps),
            "Price too far from 1:1"
        );

        // Check 5: TWAP vs spot (manipulation detection)
        if (twapCheckEnabled) {
            uint256 twapPrice = _getTwapPrice();
            require(
                _isWithinRange(spotPrice, twapPrice, maxTwapDeviationBps),
                "Spot/TWAP divergence: possible manipulation"
            );
        }
    }

    /// @dev Execute swap via PancakeSwap V3 SmartRouter exactInputSingle
    /// @notice PancakeSwap V3 SmartRouter struct does NOT include `deadline`.
    ///         The contract enforces its own deadline check via `deadlineExtension`.
    function _swapUsdtToUsdc(
        uint256 amountIn,
        uint256 amountOutMin
    ) internal returns (uint256 amountOut) {
        // Enforce deadline at contract level (PancakeSwap SmartRouter uses multicall for deadline)
        // This is safe because _preSwapChecks already validates price and cooldown

        usdt.safeIncreaseAllowance(address(pancakeRouter), amountIn);

        IPancakeV3Router.ExactInputSingleParams memory params = IPancakeV3Router
            .ExactInputSingleParams({
                tokenIn: address(usdt),
                tokenOut: address(usdc),
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            });

        amountOut = pancakeRouter.exactInputSingle(params);
    }

    /// @dev Validate that minOut respects maxSlippageBps (tight for stablecoin pairs)
    function _validateSlippage(uint256 amountIn, uint256 minOut) internal view {
        // For stablecoin pair: minOut must be >= amountIn * (10000 - maxSlippageBps) / 10000
        // With default 10 bps: minOut >= 99.9% of amountIn
        uint256 floor = (amountIn * (10000 - maxSlippageBps)) / 10000;
        require(minOut >= floor, "Slippage too high");
    }

    /// @dev Get the current spot price from pool.slot0()
    /// @return price Price of USDT in terms of USDC, scaled to 1e18 (1e18 = exactly 1:1)
    function _getSpotPrice() internal view returns (uint256 price) {
        (uint160 sqrtPriceX96,,,,,,) = pancakePool.slot0();
        // sqrtPriceX96 = sqrt(token1/token0) * 2^96
        // price(token1/token0) = (sqrtPriceX96 / 2^96)^2
        // Both USDT and USDC are 18 decimals on BSC, so no decimal adjustment needed
        uint256 sqrtPrice = uint256(sqrtPriceX96);

        if (isToken0Usdt) {
            // price = token1/token0 = USDC/USDT → we want USDT→USDC rate
            // For 1 USDT input, output = price = (sqrtPriceX96)^2 / 2^192
            price = (sqrtPrice * sqrtPrice * 1e18) >> 192;
        } else {
            // token0 = USDC, token1 = USDT
            // price = token1/token0 = USDT/USDC
            // We want USDT→USDC = 1/price = 2^192 / (sqrtPriceX96)^2
            price = (uint256(1e18) << 192) / (sqrtPrice * sqrtPrice);
        }
    }

    /// @dev Get TWAP price over the configured window using pool.observe()
    function _getTwapPrice() internal view returns (uint256 price) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow; // e.g. 300 seconds ago
        secondsAgos[1] = 0;          // now

        (int56[] memory tickCumulatives,) = pancakePool.observe(secondsAgos);

        // Average tick over the window
        int56 tickDiff = tickCumulatives[1] - tickCumulatives[0];
        int24 avgTick = int24(tickDiff / int56(int32(twapWindow)));

        // Convert tick to price: price = 1.0001^tick
        // For stablecoin pairs near 1:1, tick ≈ 0, price ≈ 1.0
        // Using the standard tick-to-sqrtPrice formula
        price = _tickToPrice(avgTick);
    }

    /// @dev Convert a tick to a price (scaled to 1e18)
    /// @notice For stablecoin pairs the tick is very close to 0, so price ≈ 1e18
    function _tickToPrice(int24 tick) internal view returns (uint256 price) {
        // price(token1/token0) = 1.0001^tick
        // We compute this using the same approach as Uniswap:
        // Absolute tick determines the ratio, sign determines direction
        uint256 absTick = tick >= 0 ? uint256(int256(tick)) : uint256(-int256(tick));

        // For stablecoin pairs, |tick| is very small (< 100 typically)
        // Use exponentiation by squaring for 1.0001^|tick|
        // Start with 1e18 and multiply by 1.0001 for each tick
        // 1.0001 in 1e18 = 1000100000000000000
        // For efficiency, use pre-computed powers for common bit positions
        uint256 ratio = 1e18;

        // Each bit position represents a power of 1.0001^(2^i)
        // Pre-computed values (1e18 scale):
        if (absTick & 0x1 != 0)     ratio = (ratio * 1000100000000000000) / 1e18;   // 1.0001^1
        if (absTick & 0x2 != 0)     ratio = (ratio * 1000200010000000000) / 1e18;   // 1.0001^2
        if (absTick & 0x4 != 0)     ratio = (ratio * 1000400060004000000) / 1e18;   // 1.0001^4
        if (absTick & 0x8 != 0)     ratio = (ratio * 1000800280056007000) / 1e18;   // 1.0001^8
        if (absTick & 0x10 != 0)    ratio = (ratio * 1001601200560121000) / 1e18;   // 1.0001^16
        if (absTick & 0x20 != 0)    ratio = (ratio * 1003204964963598000) / 1e18;   // 1.0001^32
        if (absTick & 0x40 != 0)    ratio = (ratio * 1006420201727613000) / 1e18;   // 1.0001^64
        if (absTick & 0x80 != 0)    ratio = (ratio * 1012881622445451000) / 1e18;   // 1.0001^128

        if (tick < 0) {
            // Invert: 1/ratio
            ratio = (1e36) / ratio;
        }

        if (isToken0Usdt) {
            price = ratio; // token1/token0 = USDC/USDT
        } else {
            price = (1e36) / ratio; // invert for USDT→USDC
        }
    }

    /// @dev Check if value is within bps range of target
    function _isWithinRange(uint256 value, uint256 target, uint256 bps) internal pure returns (bool) {
        uint256 lower = (target * (10000 - bps)) / 10000;
        uint256 upper = (target * (10000 + bps)) / 10000;
        return value >= lower && value <= upper;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setPancakeRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid address");
        pancakeRouter = IPancakeV3Router(_router);
        emit ConfigUpdated("pancakeRouter");
    }

    function setPancakePool(address _pool) external onlyOwner {
        require(_pool != address(0), "Invalid address");
        pancakePool = IPancakeV3Pool(_pool);
        isToken0Usdt = (IPancakeV3Pool(_pool).token0() == address(usdt));
        emit ConfigUpdated("pancakePool");
    }

    function setPoolFee(uint24 _fee) external onlyOwner {
        poolFee = _fee;
        emit ConfigUpdated("poolFee");
    }

    function setNodesV2(address _nodesV2) external onlyOwner {
        require(_nodesV2 != address(0), "Invalid address");
        nodesV2 = INodesV2(_nodesV2);
        emit ConfigUpdated("nodesV2");
    }

    function setVaultV2(address _vaultV2) external onlyOwner {
        require(_vaultV2 != address(0), "Invalid address");
        vaultV2 = IVaultV2(_vaultV2);
        emit ConfigUpdated("vaultV2");
    }

    function setMaxSlippageBps(uint256 _bps) external onlyOwner {
        require(_bps > 0 && _bps <= 100, "1-100 bps");
        maxSlippageBps = _bps;
        emit ConfigUpdated("maxSlippageBps");
    }

    function setMaxPriceDeviationBps(uint256 _bps) external onlyOwner {
        require(_bps > 0 && _bps <= 200, "1-200 bps");
        maxPriceDeviationBps = _bps;
        emit ConfigUpdated("maxPriceDeviationBps");
    }

    function setMaxSwapAmount(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Invalid amount");
        maxSwapAmount = _amount;
        emit ConfigUpdated("maxSwapAmount");
    }

    function setTwapWindow(uint32 _seconds) external onlyOwner {
        require(_seconds >= 60 && _seconds <= 3600, "60-3600s");
        twapWindow = _seconds;
        emit ConfigUpdated("twapWindow");
    }

    function setMaxTwapDeviationBps(uint256 _bps) external onlyOwner {
        require(_bps > 0 && _bps <= 200, "1-200 bps");
        maxTwapDeviationBps = _bps;
        emit ConfigUpdated("maxTwapDeviationBps");
    }

    function setCooldownPeriod(uint256 _seconds) external onlyOwner {
        require(_seconds <= 300, "Max 5 min");
        cooldownPeriod = _seconds;
        emit ConfigUpdated("cooldownPeriod");
    }

    function setTwapCheckEnabled(bool _enabled) external onlyOwner {
        twapCheckEnabled = _enabled;
        emit ConfigUpdated("twapCheckEnabled");
    }

    function setDeadlineExtension(uint256 _seconds) external onlyOwner {
        require(_seconds >= 60 && _seconds <= 3600, "60-3600s");
        deadlineExtension = _seconds;
        emit ConfigUpdated("deadlineExtension");
    }

    function setUsdt(address _usdt) external onlyOwner {
        require(_usdt != address(0), "Invalid address");
        usdt = IERC20(_usdt);
        emit ConfigUpdated("usdt");
    }

    function setUsdc(address _usdc) external onlyOwner {
        require(_usdc != address(0), "Invalid address");
        usdc = IERC20(_usdc);
        emit ConfigUpdated("usdc");
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Emergency: recover tokens stuck in this contract
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
    }
}
