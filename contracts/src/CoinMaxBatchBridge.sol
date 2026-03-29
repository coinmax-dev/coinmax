// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Stargate V2 Router interface (OFT pattern)
interface IStargateRouter {
    struct SendParam {
        uint32 dstEid;       // destination endpoint ID
        bytes32 to;          // recipient (bytes32 encoded address)
        uint256 amountLD;    // amount in local decimals
        uint256 minAmountLD; // min amount after fees
        bytes extraOptions;
        bytes composeMsg;
        bytes oftCmd;
    }

    function send(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable returns (bytes32 msgReceipt);

    function quoteSend(
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory);

    struct MessagingFee {
        uint256 nativeFee;
        uint256 lzTokenFee;
    }
}

/// @title CoinMax Batch Bridge (BSC → ARB)
/// @notice Accumulates USDC from Vault/Gateway deposits, bridges to ARB every 4 hours.
///         Deployed on BSC. Admin (deployer or cron) calls `bridgeToARB()`.
///
///  Flow:
///    Vault/Gateway → safeTransfer USDC → this contract (accumulates)
///    Every 4h cron → bridgeToARB() → Stargate → ARB FundRouter
///
///  Privacy: observers only see "contract → Stargate" once every 4h.
///    They don't see individual user deposits going cross-chain.
contract CoinMaxBatchBridge is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IStargateRouter public stargateRouter;

    /// @notice ARB FundRouter address (receives USDC on ARB)
    address public arbReceiver;

    /// @notice Stargate destination endpoint ID for ARB
    uint32 public dstEid;

    /// @notice Minimum USDC to trigger bridge (avoid tiny bridges)
    uint256 public minBridgeAmount;

    /// @notice Last bridge timestamp
    uint256 public lastBridgeTime;

    /// @notice Minimum interval between bridges (4 hours default)
    uint256 public bridgeInterval;

    /// @notice Cumulative stats
    uint256 public totalBridged;
    uint256 public bridgeCount;

    event Bridged(uint256 amount, uint256 fee, uint32 dstEid, uint256 timestamp);
    event ConfigUpdated(string param);

    constructor(
        address _usdc,
        address _stargateRouter,
        address _arbReceiver,
        uint32 _dstEid
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_stargateRouter != address(0), "Invalid router");
        require(_arbReceiver != address(0), "Invalid receiver");

        usdc = IERC20(_usdc);
        stargateRouter = IStargateRouter(_stargateRouter);
        arbReceiver = _arbReceiver;
        dstEid = _dstEid;
        minBridgeAmount = 100 * 1e18; // min $100 to bridge
        bridgeInterval = 4 hours;
    }

    /// @notice Bridge accumulated USDC to ARB via Stargate
    /// @dev Called by cron every 4 hours. Sends ALL accumulated USDC.
    ///      Uses contract's BNB balance for Stargate fee (no msg.value needed).
    ///      Pre-fund with BNB via receive() or direct transfer.
    function bridgeToARB() external onlyOwner nonReentrant whenNotPaused {
        require(block.timestamp >= lastBridgeTime + bridgeInterval, "Too soon");

        uint256 balance = usdc.balanceOf(address(this));
        require(balance >= minBridgeAmount, "Below min bridge amount");

        // Approve Stargate
        usdc.safeIncreaseAllowance(address(stargateRouter), balance);

        // Encode receiver as bytes32
        bytes32 toBytes = bytes32(uint256(uint160(arbReceiver)));

        // Build send params
        IStargateRouter.SendParam memory params = IStargateRouter.SendParam({
            dstEid: dstEid,
            to: toBytes,
            amountLD: balance,
            minAmountLD: balance * 9990 / 10000, // 0.1% slippage
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });

        // Quote fee
        IStargateRouter.MessagingFee memory fee = stargateRouter.quoteSend(params, false);
        require(address(this).balance >= fee.nativeFee, "Insufficient BNB for fee");

        // Send using contract's BNB balance (not msg.value)
        stargateRouter.send{value: fee.nativeFee}(params, fee, address(this));

        lastBridgeTime = block.timestamp;
        totalBridged += balance;
        bridgeCount++;

        emit Bridged(balance, fee.nativeFee, dstEid, block.timestamp);
    }

    /// @notice Get quote for bridging current balance
    function quoteBridge() external view returns (uint256 nativeFee, uint256 balance) {
        balance = usdc.balanceOf(address(this));
        if (balance < minBridgeAmount) return (0, balance);

        bytes32 toBytes = bytes32(uint256(uint160(arbReceiver)));
        IStargateRouter.SendParam memory params = IStargateRouter.SendParam({
            dstEid: dstEid, to: toBytes, amountLD: balance,
            minAmountLD: balance * 9990 / 10000,
            extraOptions: "", composeMsg: "", oftCmd: ""
        });

        IStargateRouter.MessagingFee memory fee = stargateRouter.quoteSend(params, false);
        return (fee.nativeFee, balance);
    }

    /// @notice Check if bridge is ready
    function canBridge() external view returns (bool ready, uint256 balance, uint256 nextBridgeAt) {
        balance = usdc.balanceOf(address(this));
        nextBridgeAt = lastBridgeTime + bridgeInterval;
        ready = block.timestamp >= nextBridgeAt && balance >= minBridgeAmount;
    }

    // ─── Admin ──────────────────────────────────────────────

    function setArbReceiver(address _r) external onlyOwner {
        require(_r != address(0), "Invalid");
        arbReceiver = _r;
        emit ConfigUpdated("arbReceiver");
    }

    function setStargateRouter(address _r) external onlyOwner {
        require(_r != address(0), "Invalid");
        stargateRouter = IStargateRouter(_r);
        emit ConfigUpdated("stargateRouter");
    }

    function setDstEid(uint32 _eid) external onlyOwner {
        dstEid = _eid;
        emit ConfigUpdated("dstEid");
    }

    function setMinBridgeAmount(uint256 _min) external onlyOwner {
        minBridgeAmount = _min;
        emit ConfigUpdated("minBridgeAmount");
    }

    function setBridgeInterval(uint256 _seconds) external onlyOwner {
        require(_seconds >= 1 hours, "Min 1 hour");
        bridgeInterval = _seconds;
        emit ConfigUpdated("bridgeInterval");
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }

    function emergencyWithdrawNative(address payable to) external onlyOwner {
        require(to != address(0), "Invalid");
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "Failed");
    }

    receive() external payable {}
}
