// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice PancakeSwap V3 SmartRouter interface
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
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @notice Stargate V2 Router interface
interface IStargateRouter {
    struct SendParam {
        uint32 dstEid;
        bytes32 to;
        uint256 amountLD;
        uint256 minAmountLD;
        bytes extraOptions;
        bytes composeMsg;
        bytes oftCmd;
    }
    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }
    function send(SendParam calldata _sendParam, MessagingFee calldata _fee, address _refundAddress) external payable returns (bytes32);
    function quoteSend(SendParam calldata _sendParam, bool _payInLzToken) external view returns (MessagingFee memory);
}

/// @title CoinMax Batch Bridge V2 (BSC → ARB)
/// @notice Receives USDT from Vault → batch swap USDT→USDC via PancakeSwap → bridge USDC to ARB
///
///  Flow:
///    Vault.depositPublic/purchaseNodePublic → USDT → this contract (accumulates)
///    Every 4h cron → swapAndBridge() → PancakeSwap swap → Stargate → ARB FundRouter
contract CoinMaxBatchBridgeV2 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    IERC20 public immutable usdc;
    IPancakeV3Router public pancakeRouter;
    IStargateRouter public stargateRouter;

    /// @notice PancakeSwap pool fee (100 = 0.01%)
    uint24 public poolFee;

    /// @notice Max slippage for USDT→USDC swap (50 = 0.5%)
    uint256 public maxSlippageBps;

    /// @notice ARB FundRouter address
    address public arbReceiver;

    /// @notice Stargate destination endpoint ID for ARB
    uint32 public dstEid;

    /// @notice Minimum amount to trigger bridge
    uint256 public minBridgeAmount;

    /// @notice Last bridge timestamp
    uint256 public lastBridgeTime;

    /// @notice Minimum interval between bridges
    uint256 public bridgeInterval;

    /// @notice Stats
    uint256 public totalBridged;
    uint256 public totalSwapped;
    uint256 public bridgeCount;

    event SwappedAndBridged(uint256 usdtIn, uint256 usdcOut, uint256 bridgeFee, uint256 timestamp);
    event ConfigUpdated(string param);

    constructor(
        address _usdt,
        address _usdc,
        address _pancakeRouter,
        address _stargateRouter,
        address _arbReceiver,
        uint32 _dstEid
    ) Ownable(msg.sender) {
        require(_usdt != address(0) && _usdc != address(0), "Invalid tokens");
        require(_pancakeRouter != address(0) && _stargateRouter != address(0), "Invalid routers");
        require(_arbReceiver != address(0), "Invalid receiver");

        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        pancakeRouter = IPancakeV3Router(_pancakeRouter);
        stargateRouter = IStargateRouter(_stargateRouter);
        arbReceiver = _arbReceiver;
        dstEid = _dstEid;

        poolFee = 100;              // 0.01% (USDT/USDC stable pair)
        maxSlippageBps = 50;        // 0.5%
        minBridgeAmount = 50 * 1e18;  // min $50
        bridgeInterval = 4 hours;
    }

    /// @notice Swap accumulated USDT → USDC via PancakeSwap, then bridge to ARB
    function swapAndBridge() external onlyOwner nonReentrant whenNotPaused {
        require(block.timestamp >= lastBridgeTime + bridgeInterval, "Too soon");

        uint256 usdtBalance = usdt.balanceOf(address(this));
        require(usdtBalance >= minBridgeAmount, "Below min bridge amount");

        // 1. Swap USDT → USDC via PancakeSwap V3
        usdt.safeIncreaseAllowance(address(pancakeRouter), usdtBalance);
        uint256 minOut = usdtBalance * (10000 - maxSlippageBps) / 10000;

        uint256 usdcReceived = pancakeRouter.exactInputSingle(
            IPancakeV3Router.ExactInputSingleParams({
                tokenIn: address(usdt),
                tokenOut: address(usdc),
                fee: poolFee,
                recipient: address(this),
                amountIn: usdtBalance,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );

        totalSwapped += usdtBalance;

        // 2. Bridge USDC to ARB via Stargate
        usdc.safeIncreaseAllowance(address(stargateRouter), usdcReceived);

        bytes32 toBytes = bytes32(uint256(uint160(arbReceiver)));
        IStargateRouter.SendParam memory params = IStargateRouter.SendParam({
            dstEid: dstEid,
            to: toBytes,
            amountLD: usdcReceived,
            minAmountLD: usdcReceived * 9990 / 10000,
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });

        IStargateRouter.MessagingFee memory fee = stargateRouter.quoteSend(params, false);
        require(address(this).balance >= fee.nativeFee, "Insufficient BNB for bridge fee");

        stargateRouter.send{value: fee.nativeFee}(params, fee, address(this));

        lastBridgeTime = block.timestamp;
        totalBridged += usdcReceived;
        bridgeCount++;

        emit SwappedAndBridged(usdtBalance, usdcReceived, fee.nativeFee, block.timestamp);
    }

    /// @notice Get quote and readiness
    function canBridge() external view returns (bool ready, uint256 usdtBalance, uint256 nextBridgeAt) {
        usdtBalance = usdt.balanceOf(address(this));
        nextBridgeAt = lastBridgeTime + bridgeInterval;
        ready = block.timestamp >= nextBridgeAt && usdtBalance >= minBridgeAmount;
    }

    // ─── Admin ──────────────────────────────────────────────

    function setArbReceiver(address _r) external onlyOwner { require(_r != address(0)); arbReceiver = _r; emit ConfigUpdated("arbReceiver"); }
    function setDstEid(uint32 _eid) external onlyOwner { dstEid = _eid; emit ConfigUpdated("dstEid"); }
    function setMinBridgeAmount(uint256 _min) external onlyOwner { minBridgeAmount = _min; emit ConfigUpdated("minBridgeAmount"); }
    function setBridgeInterval(uint256 _s) external onlyOwner { require(_s >= 1 hours); bridgeInterval = _s; emit ConfigUpdated("bridgeInterval"); }
    function setMaxSlippageBps(uint256 _bps) external onlyOwner { require(_bps <= 500); maxSlippageBps = _bps; emit ConfigUpdated("maxSlippageBps"); }
    function setPoolFee(uint24 _fee) external onlyOwner { poolFee = _fee; emit ConfigUpdated("poolFee"); }
    function setPancakeRouter(address _r) external onlyOwner { require(_r != address(0)); pancakeRouter = IPancakeV3Router(_r); emit ConfigUpdated("pancakeRouter"); }
    function setStargateRouter(address _r) external onlyOwner { require(_r != address(0)); stargateRouter = IStargateRouter(_r); emit ConfigUpdated("stargateRouter"); }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0));
        IERC20(token).safeTransfer(to, amount);
    }

    function emergencyWithdrawNative(address payable to) external onlyOwner {
        require(to != address(0));
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok);
    }

    receive() external payable {}
}
