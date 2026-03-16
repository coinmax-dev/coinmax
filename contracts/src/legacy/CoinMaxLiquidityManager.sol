// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice cUSDT token interface (thirdweb Token with mintTo)
interface ICUSDTMintable {
    function mintTo(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice PancakeSwap V3 NonfungiblePositionManager interface
interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct IncreaseLiquidityParams {
        uint256 tokenId;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        payable
        returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        payable
        returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

/// @notice PancakeSwap V3 Pool interface
interface IPoolSlot0 {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint32 feeProtocol,
        bool unlocked
    );

    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title CoinMax Liquidity Manager
/// @notice Manages cUSDT/USDT liquidity in PancakeSwap V3 pool.
///
///  Responsibilities:
///    1. Mint cUSDT (has MINTER_ROLE on thirdweb cUSDT token)
///    2. Add cUSDT + USDT liquidity to V3 pool at tight 1:1 range
///    3. Replenish cUSDT when pool supply gets low
///    4. Collect swap fees
///    5. Remove liquidity when needed
///
///  How it works:
///    - Owner deposits USDT to this contract
///    - Owner calls `mintAndAddLiquidity` → mints cUSDT 1:1 → adds both to pool
///    - Or calls `mintCUsdtOnly` → mints cUSDT → adds single-sided to pool
///    - Users swap USDT→cUSDT through the pool normally
///    - Owner calls `replenish` to mint more cUSDT when pool is running low
contract CoinMaxLiquidityManager is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice PancakeSwap V3 NonfungiblePositionManager
    INonfungiblePositionManager public positionManager;

    /// @notice PancakeSwap V3 Pool (USDT/cUSDT)
    IPoolSlot0 public pool;

    /// @notice USDT token
    IERC20 public usdt;

    /// @notice cUSDT token (this contract needs MINTER_ROLE)
    ICUSDTMintable public cUsdt;

    /// @notice Pool fee tier
    uint24 public poolFee;

    /// @notice Whether USDT is token0 in the pool
    bool public isToken0Usdt;

    /// @notice Active liquidity position NFT token IDs
    uint256[] public positionIds;

    /// @notice Total cUSDT minted by this contract
    uint256 public totalCUsdtMinted;

    // ─── Events ─────────────────────────────────────────────────────────

    event LiquidityAdded(
        uint256 indexed tokenId,
        uint256 usdtAmount,
        uint256 cUsdtAmount,
        uint128 liquidity
    );

    event LiquidityIncreased(
        uint256 indexed tokenId,
        uint256 usdtAmount,
        uint256 cUsdtAmount,
        uint128 liquidity
    );

    event LiquidityRemoved(
        uint256 indexed tokenId,
        uint256 usdtAmount,
        uint256 cUsdtAmount
    );

    event FeesCollected(
        uint256 indexed tokenId,
        uint256 usdtFees,
        uint256 cUsdtFees
    );

    event CUsdtMinted(uint256 amount);
    event Replenished(uint256 indexed tokenId, uint256 cUsdtMinted, uint128 liquidity);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _positionManager PancakeSwap V3 NonfungiblePositionManager
    /// @param _pool PancakeSwap V3 Pool address (USDT/cUSDT)
    /// @param _usdt USDT token address
    /// @param _cUsdt cUSDT token address (this contract needs MINTER_ROLE)
    /// @param _poolFee Pool fee tier
    constructor(
        address _positionManager,
        address _pool,
        address _usdt,
        address _cUsdt,
        uint24 _poolFee
    ) Ownable(msg.sender) {
        require(_positionManager != address(0), "Invalid PM");
        require(_pool != address(0), "Invalid pool");
        require(_usdt != address(0), "Invalid USDT");
        require(_cUsdt != address(0), "Invalid cUSDT");

        positionManager = INonfungiblePositionManager(_positionManager);
        pool = IPoolSlot0(_pool);
        usdt = IERC20(_usdt);
        cUsdt = ICUSDTMintable(_cUsdt);
        poolFee = _poolFee;

        isToken0Usdt = (IPoolSlot0(_pool).token0() == _usdt);
    }

    // ─── Core: Add Liquidity ────────────────────────────────────────────

    /// @notice Mint cUSDT + pair with USDT → add liquidity to V3 pool at 1:1 range
    /// @param usdtAmount USDT amount to pair (must be pre-deposited to this contract)
    /// @param tickLower Lower tick bound (use tight range around 1:1, e.g. -10)
    /// @param tickUpper Upper tick bound (e.g. +10)
    /// @dev For 1:1 stable pair: tickLower=-10, tickUpper=10 gives ~0.1% range
    function mintAndAddLiquidity(
        uint256 usdtAmount,
        int24 tickLower,
        int24 tickUpper
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256 tokenId) {
        require(usdtAmount > 0, "Zero amount");
        require(usdt.balanceOf(address(this)) >= usdtAmount, "Insufficient USDT");

        // Mint equal cUSDT
        uint256 cUsdtAmount = usdtAmount;
        cUsdt.mintTo(address(this), cUsdtAmount);
        totalCUsdtMinted += cUsdtAmount;

        // Approve both tokens to position manager
        usdt.safeIncreaseAllowance(address(positionManager), usdtAmount);
        cUsdt.approve(address(positionManager), cUsdtAmount);

        // Determine token order
        (uint256 amount0, uint256 amount1) = isToken0Usdt
            ? (usdtAmount, cUsdtAmount)
            : (cUsdtAmount, usdtAmount);

        // Add liquidity
        uint128 liquidity;
        (tokenId, liquidity,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: isToken0Usdt ? address(usdt) : address(cUsdt),
                token1: isToken0Usdt ? address(cUsdt) : address(usdt),
                fee: poolFee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 300
            })
        );

        positionIds.push(tokenId);

        emit CUsdtMinted(cUsdtAmount);
        emit LiquidityAdded(tokenId, usdtAmount, cUsdtAmount, liquidity);
    }

    /// @notice Mint cUSDT only and add as single-sided liquidity
    /// @dev Use tick range ABOVE current price so only cUSDT is deposited.
    ///      When users swap USDT→cUSDT, they push price up into this range.
    /// @param cUsdtAmount Amount of cUSDT to mint and add
    /// @param tickLower Lower tick (should be at or above current tick)
    /// @param tickUpper Upper tick
    function mintCUsdtAndAddLiquidity(
        uint256 cUsdtAmount,
        int24 tickLower,
        int24 tickUpper
    ) external onlyOwner nonReentrant whenNotPaused returns (uint256 tokenId) {
        require(cUsdtAmount > 0, "Zero amount");

        // Mint cUSDT
        cUsdt.mintTo(address(this), cUsdtAmount);
        totalCUsdtMinted += cUsdtAmount;

        cUsdt.approve(address(positionManager), cUsdtAmount);

        // Single-sided: only cUSDT
        (uint256 amount0, uint256 amount1) = isToken0Usdt
            ? (uint256(0), cUsdtAmount)   // cUSDT is token1
            : (cUsdtAmount, uint256(0));   // cUSDT is token0

        uint128 liquidity;
        (tokenId, liquidity,,) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: isToken0Usdt ? address(usdt) : address(cUsdt),
                token1: isToken0Usdt ? address(cUsdt) : address(usdt),
                fee: poolFee,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 300
            })
        );

        positionIds.push(tokenId);

        emit CUsdtMinted(cUsdtAmount);
        emit LiquidityAdded(tokenId, 0, cUsdtAmount, liquidity);
    }

    // ─── Core: Replenish ────────────────────────────────────────────────

    /// @notice Mint more cUSDT and add to an existing position
    /// @param positionIndex Index in positionIds array
    /// @param cUsdtAmount Amount of cUSDT to mint and add
    function replenish(
        uint256 positionIndex,
        uint256 cUsdtAmount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(positionIndex < positionIds.length, "Invalid index");
        require(cUsdtAmount > 0, "Zero amount");

        uint256 tokenId = positionIds[positionIndex];

        // Mint cUSDT
        cUsdt.mintTo(address(this), cUsdtAmount);
        totalCUsdtMinted += cUsdtAmount;

        cUsdt.approve(address(positionManager), cUsdtAmount);

        // Add to existing position (single-sided cUSDT)
        (uint256 amount0, uint256 amount1) = isToken0Usdt
            ? (uint256(0), cUsdtAmount)
            : (cUsdtAmount, uint256(0));

        (uint128 liquidity,,) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            })
        );

        emit Replenished(tokenId, cUsdtAmount, liquidity);
    }

    /// @notice Replenish with both USDT + minted cUSDT to existing position
    /// @param positionIndex Index in positionIds array
    /// @param usdtAmount USDT amount (must be in this contract)
    function replenishBothSides(
        uint256 positionIndex,
        uint256 usdtAmount
    ) external onlyOwner nonReentrant whenNotPaused {
        require(positionIndex < positionIds.length, "Invalid index");
        require(usdtAmount > 0, "Zero amount");
        require(usdt.balanceOf(address(this)) >= usdtAmount, "Insufficient USDT");

        uint256 tokenId = positionIds[positionIndex];
        uint256 cUsdtAmount = usdtAmount;

        cUsdt.mintTo(address(this), cUsdtAmount);
        totalCUsdtMinted += cUsdtAmount;

        usdt.safeIncreaseAllowance(address(positionManager), usdtAmount);
        cUsdt.approve(address(positionManager), cUsdtAmount);

        (uint256 amount0, uint256 amount1) = isToken0Usdt
            ? (usdtAmount, cUsdtAmount)
            : (cUsdtAmount, usdtAmount);

        (uint128 liquidity,,) = positionManager.increaseLiquidity(
            INonfungiblePositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            })
        );

        emit LiquidityIncreased(tokenId, usdtAmount, cUsdtAmount, liquidity);
    }

    // ─── Core: Remove Liquidity & Collect ───────────────────────────────

    /// @notice Remove liquidity from a position
    /// @param positionIndex Index in positionIds array
    /// @param liquidity Amount of liquidity to remove
    function removeLiquidity(
        uint256 positionIndex,
        uint128 liquidity
    ) external onlyOwner nonReentrant {
        require(positionIndex < positionIds.length, "Invalid index");

        uint256 tokenId = positionIds[positionIndex];

        (uint256 amount0, uint256 amount1) = positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            })
        );

        // Collect the tokens
        positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 usdtAmt, uint256 cUsdtAmt) = isToken0Usdt
            ? (amount0, amount1)
            : (amount1, amount0);

        emit LiquidityRemoved(tokenId, usdtAmt, cUsdtAmt);
    }

    /// @notice Collect accumulated swap fees from a position
    /// @param positionIndex Index in positionIds array
    function collectFees(
        uint256 positionIndex
    ) external onlyOwner nonReentrant {
        require(positionIndex < positionIds.length, "Invalid index");

        uint256 tokenId = positionIds[positionIndex];

        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        (uint256 usdtFees, uint256 cUsdtFees) = isToken0Usdt
            ? (amount0, amount1)
            : (amount1, amount0);

        emit FeesCollected(tokenId, usdtFees, cUsdtFees);
    }

    // ─── View ───────────────────────────────────────────────────────────

    /// @notice Get the number of active positions
    function getPositionCount() external view returns (uint256) {
        return positionIds.length;
    }

    /// @notice Get position details
    function getPositionInfo(uint256 positionIndex) external view returns (
        uint256 tokenId,
        int24 tickLower,
        int24 tickUpper,
        uint128 liquidity
    ) {
        require(positionIndex < positionIds.length, "Invalid index");
        tokenId = positionIds[positionIndex];
        (,,,,, tickLower, tickUpper, liquidity,,,,) = positionManager.positions(tokenId);
    }

    /// @notice Get current pool tick (price indicator)
    function getCurrentTick() external view returns (int24 tick) {
        (, tick,,,,,) = pool.slot0();
    }

    /// @notice Get USDT balance held by this contract
    function getUsdtBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /// @notice Get cUSDT balance held by this contract
    function getCUsdtBalance() external view returns (uint256) {
        return cUsdt.balanceOf(address(this));
    }

    // ─── Owner: Deposit USDT ────────────────────────────────────────────

    /// @notice Owner deposits USDT to this contract for pairing with cUSDT
    /// @param amount USDT amount to deposit
    function depositUsdt(uint256 amount) external onlyOwner {
        require(amount > 0, "Zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setPositionManager(address _pm) external onlyOwner {
        require(_pm != address(0), "Invalid address");
        positionManager = INonfungiblePositionManager(_pm);
    }

    function setPool(address _pool) external onlyOwner {
        require(_pool != address(0), "Invalid address");
        pool = IPoolSlot0(_pool);
        isToken0Usdt = (IPoolSlot0(_pool).token0() == address(usdt));
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Withdraw tokens from this contract
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Required to receive ERC721 (NFT position tokens)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
