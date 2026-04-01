// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice PancakeSwap V3 Router interface
interface IPancakeRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
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

/// @title CoinMax Batch Bridge V2 (Swap + Bridge)
/// @notice Accumulates USDT from Vault → swaps to USDC → bridges to ARB via Stargate.
///         Uses contract's BNB balance for Stargate fee (no payable needed).
///
///  Flow:
///    Vault.depositPublic → USDT → this contract (accumulates)
///    Cron/Admin → swapAndBridge() → PancakeSwap USDT→USDC → Stargate → ARB FundRouter
contract CoinMaxBatchBridgeV2 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdt;
    IERC20 public immutable usdc;
    IPancakeRouter public pancakeRouter;
    IStargateRouter public stargateRouter;

    address public arbReceiver;
    uint32 public dstEid;
    uint24 public poolFee;
    uint256 public minBridgeAmount;
    uint256 public bridgeInterval;
    uint256 public lastBridgeTime;
    uint256 public totalSwapped;
    uint256 public totalBridged;
    uint256 public bridgeCount;

    mapping(address => bool) public keepers;

    event SwappedAndBridged(uint256 usdtIn, uint256 usdcOut, uint256 stargeFee, uint256 timestamp);
    event ConfigUpdated(string param);
    event Withdrawn(address indexed to, uint256 amount);
    event KeeperUpdated(address indexed keeper, bool active);

    modifier onlyKeeper() {
        require(msg.sender == owner() || keepers[msg.sender], "Not keeper");
        _;
    }

    constructor(
        address _usdt,
        address _usdc,
        address _pancakeRouter,
        address _stargateRouter,
        address _arbReceiver,
        uint32 _dstEid,
        uint24 _poolFee
    ) Ownable(msg.sender) {
        require(_usdt != address(0) && _usdc != address(0), "Invalid tokens");
        require(_pancakeRouter != address(0) && _stargateRouter != address(0), "Invalid routers");
        require(_arbReceiver != address(0), "Invalid receiver");

        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        pancakeRouter = IPancakeRouter(_pancakeRouter);
        stargateRouter = IStargateRouter(_stargateRouter);
        arbReceiver = _arbReceiver;
        dstEid = _dstEid;
        poolFee = _poolFee;
        minBridgeAmount = 50 * 1e18;
        bridgeInterval = 10 minutes;
    }

    /// @notice Swap all USDT → USDC via PancakeSwap, then bridge to ARB via Stargate
    ///         Uses contract's BNB balance for Stargate gas fee
    function swapAndBridge() external onlyKeeper nonReentrant whenNotPaused {
        require(block.timestamp >= lastBridgeTime + bridgeInterval, "Too soon");

        uint256 usdtBalance = usdt.balanceOf(address(this));
        require(usdtBalance >= minBridgeAmount, "Below min amount");

        // Step 1: Swap USDT → USDC via PancakeSwap V3
        usdt.safeIncreaseAllowance(address(pancakeRouter), usdtBalance);
        uint256 usdcOut = pancakeRouter.exactInputSingle(IPancakeRouter.ExactInputSingleParams({
            tokenIn: address(usdt),
            tokenOut: address(usdc),
            fee: poolFee,
            recipient: address(this),
            amountIn: usdtBalance,
            amountOutMinimum: usdtBalance * 995 / 1000, // 0.5% slippage
            sqrtPriceLimitX96: 0
        }));
        totalSwapped += usdtBalance;

        // Step 2: Bridge USDC → ARB via Stargate
        usdc.safeIncreaseAllowance(address(stargateRouter), usdcOut);

        bytes32 toBytes = bytes32(uint256(uint160(arbReceiver)));
        IStargateRouter.SendParam memory params = IStargateRouter.SendParam({
            dstEid: dstEid,
            to: toBytes,
            amountLD: usdcOut,
            minAmountLD: usdcOut * 9990 / 10000, // 0.1% slippage
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });

        IStargateRouter.MessagingFee memory fee = stargateRouter.quoteSend(params, false);
        require(address(this).balance >= fee.nativeFee, "Insufficient BNB for Stargate fee");

        stargateRouter.send{value: fee.nativeFee}(params, fee, address(this));

        lastBridgeTime = block.timestamp;
        totalBridged += usdcOut;
        bridgeCount++;

        emit SwappedAndBridged(usdtBalance, usdcOut, fee.nativeFee, block.timestamp);
    }

    /// @notice Check if bridge is ready
    function canBridge() external view returns (bool ready, uint256 balance, uint256 nextBridgeAt) {
        balance = usdt.balanceOf(address(this));
        nextBridgeAt = lastBridgeTime + bridgeInterval;
        ready = block.timestamp >= nextBridgeAt && balance >= minBridgeAmount;
    }

    /// @notice Get quote for bridging current balance
    function quoteBridge() external view returns (uint256 nativeFee, uint256 usdtBalance) {
        usdtBalance = usdt.balanceOf(address(this));
        if (usdtBalance < minBridgeAmount) return (0, usdtBalance);

        bytes32 toBytes = bytes32(uint256(uint160(arbReceiver)));
        IStargateRouter.SendParam memory params = IStargateRouter.SendParam({
            dstEid: dstEid, to: toBytes, amountLD: usdtBalance,
            minAmountLD: usdtBalance * 9990 / 10000,
            extraOptions: "", composeMsg: "", oftCmd: ""
        });
        IStargateRouter.MessagingFee memory fee = stargateRouter.quoteSend(params, false);
        return (fee.nativeFee, usdtBalance);
    }

    // ─── Keeper ─────────────────────────────────────────────
    function setKeeper(address _k, bool _active) external onlyOwner { keepers[_k] = _active; emit KeeperUpdated(_k, _active); }

    // ─── Admin ──────────────────────────────────────────────
    function pendingBalance() external view returns (uint256) { return usdt.balanceOf(address(this)); }
    function setArbReceiver(address _r) external onlyOwner { require(_r != address(0)); arbReceiver = _r; emit ConfigUpdated("arbReceiver"); }
    function setDstEid(uint32 _eid) external onlyOwner { dstEid = _eid; emit ConfigUpdated("dstEid"); }
    function setMinBridgeAmount(uint256 _min) external onlyOwner { minBridgeAmount = _min; emit ConfigUpdated("minBridgeAmount"); }
    function setBridgeInterval(uint256 _sec) external onlyOwner { bridgeInterval = _sec; emit ConfigUpdated("bridgeInterval"); }
    function setPoolFee(uint24 _fee) external onlyOwner { poolFee = _fee; emit ConfigUpdated("poolFee"); }
    function setPancakeRouter(address _r) external onlyOwner { require(_r != address(0)); pancakeRouter = IPancakeRouter(_r); emit ConfigUpdated("pancakeRouter"); }
    function setStargateRouter(address _r) external onlyOwner { require(_r != address(0)); stargateRouter = IStargateRouter(_r); emit ConfigUpdated("stargateRouter"); }

    function withdraw(address to, uint256 amount) external onlyOwner { require(to != address(0)); usdt.safeTransfer(to, amount); emit Withdrawn(to, amount); }
    function withdrawAll(address to) external onlyOwner { uint256 b = usdt.balanceOf(address(this)); require(b > 0); usdt.safeTransfer(to, b); emit Withdrawn(to, b); }
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner { require(to != address(0)); IERC20(token).safeTransfer(to, amount); }
    function emergencyWithdrawNative(address payable to) external onlyOwner { (bool ok,) = to.call{value: address(this).balance}(""); require(ok); }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}
}
