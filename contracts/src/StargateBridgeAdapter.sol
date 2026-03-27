// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Stargate Router interface (V1 — proven, high liquidity on BSC)
interface IStargateRouter {
    struct lzTxObj {
        uint256 dstGasForCall;
        uint256 dstNativeAmount;
        bytes dstNativeAddr;
    }

    function swap(
        uint16 _dstChainId,
        uint256 _srcPoolId,
        uint256 _dstPoolId,
        address payable _refundAddress,
        uint256 _amountLD,
        uint256 _minAmountLD,
        lzTxObj memory _lzTxParams,
        bytes calldata _to,
        bytes calldata _payload
    ) external payable;

    function quoteLayerZeroFee(
        uint16 _dstChainId,
        uint8 _functionType,
        bytes calldata _toAddress,
        bytes calldata _transferAndCallPayload,
        lzTxObj memory _lzTxParams
    ) external view returns (uint256 nativeFee, uint256 zroFee);
}

/// @title Stargate Bridge Adapter
/// @notice Bridges USDC from BSC to Arbitrum via Stargate/LayerZero
///
///  Used by:
///    - CoinMaxVault.bridgeToRemoteVault() → sendTokens()
///    - Admin manual bridge operations
///
///  Flow:
///    BSC USDC → approve this adapter → adapter calls Stargate Router →
///    LayerZero cross-chain message → USDC arrives on Arbitrum at recipient
///
///  Stargate V1 Addresses (BSC):
///    Router: 0x4a364f8c717cAAD9A442737Eb7b8A55cc6cf18D8
///    USDC Pool ID: 1 (USDT pool on BSC Stargate)
///    ARB Chain ID: 110 (LayerZero chain ID for Arbitrum)
///    ARB USDC Pool ID: 1
contract StargateBridgeAdapter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Config ──

    IStargateRouter public stargateRouter;
    IERC20 public usdc;

    uint16 public dstChainId;       // LayerZero chain ID (110 = Arbitrum)
    uint256 public srcPoolId;       // Source pool (1 = USDT on BSC Stargate)
    uint256 public dstPoolId;       // Dest pool (1 = USDT on ARB Stargate)
    uint256 public slippageBps;     // Min receive slippage (50 = 0.5%)

    address public defaultRecipient; // Default ARB recipient (Server Wallet)

    // ── Stats ──

    uint256 public totalBridged;
    uint256 public bridgeCount;

    // ── Events ──

    event Bridged(
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 minReceive,
        uint16 dstChainId,
        uint256 timestamp
    );
    event ConfigUpdated(uint16 dstChainId, uint256 srcPoolId, uint256 dstPoolId, uint256 slippageBps);

    // ── Constructor ──

    constructor(
        address _router,
        address _usdc,
        uint16 _dstChainId,
        uint256 _srcPoolId,
        uint256 _dstPoolId,
        uint256 _slippageBps,
        address _defaultRecipient
    ) Ownable(msg.sender) {
        require(_router != address(0) && _usdc != address(0), "Invalid address");
        stargateRouter = IStargateRouter(_router);
        usdc = IERC20(_usdc);
        dstChainId = _dstChainId;
        srcPoolId = _srcPoolId;
        dstPoolId = _dstPoolId;
        slippageBps = _slippageBps;
        defaultRecipient = _defaultRecipient;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: Send tokens cross-chain (called by CoinMaxVault)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Bridge USDC to Arbitrum via Stargate
    /// @dev Implements IBridgeAdapterVault.sendTokens interface
    /// @param _dstChainId Destination chain (ignored, uses configured dstChainId)
    /// @param recipient Recipient address on Arbitrum
    /// @param amount USDC amount to bridge
    /// @param options Unused (reserved for future options)
    function sendTokens(
        uint32 _dstChainId,
        address recipient,
        uint256 amount,
        bytes calldata options
    ) external payable nonReentrant returns (bytes32) {
        require(amount > 0, "Zero amount");
        address to = recipient != address(0) ? recipient : defaultRecipient;
        require(to != address(0), "No recipient");

        // Pull USDC from caller
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Approve Stargate Router
        usdc.approve(address(stargateRouter), amount);

        // Calculate min receive
        uint256 minReceive = (amount * (10000 - slippageBps)) / 10000;

        // Execute Stargate swap
        stargateRouter.swap{value: msg.value}(
            dstChainId,
            srcPoolId,
            dstPoolId,
            payable(msg.sender),  // refund excess gas to caller
            amount,
            minReceive,
            IStargateRouter.lzTxObj(0, 0, "0x"),
            abi.encodePacked(to),
            bytes("")             // no payload (simple transfer)
        );

        totalBridged += amount;
        bridgeCount++;

        emit Bridged(msg.sender, to, amount, minReceive, dstChainId, block.timestamp);

        return bytes32(bridgeCount); // pseudo message ID
    }

    // ═══════════════════════════════════════════════════════════════════
    //  QUOTE: Estimate bridge fee
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Get estimated LayerZero fee for bridging
    function estimateBridgeFee(
        address recipient,
        uint256 amount
    ) external view returns (uint256 nativeFee) {
        address to = recipient != address(0) ? recipient : defaultRecipient;
        (nativeFee,) = stargateRouter.quoteLayerZeroFee(
            dstChainId,
            1, // TYPE_SWAP_REMOTE
            abi.encodePacked(to),
            bytes(""),
            IStargateRouter.lzTxObj(0, 0, "0x")
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setConfig(
        uint16 _dstChainId,
        uint256 _srcPoolId,
        uint256 _dstPoolId,
        uint256 _slippageBps
    ) external onlyOwner {
        require(_slippageBps <= 1000, "Max 10% slippage");
        dstChainId = _dstChainId;
        srcPoolId = _srcPoolId;
        dstPoolId = _dstPoolId;
        slippageBps = _slippageBps;
        emit ConfigUpdated(_dstChainId, _srcPoolId, _dstPoolId, _slippageBps);
    }

    function setDefaultRecipient(address _r) external onlyOwner {
        require(_r != address(0), "Invalid");
        defaultRecipient = _r;
    }

    function setRouter(address _r) external onlyOwner {
        require(_r != address(0), "Invalid");
        stargateRouter = IStargateRouter(_r);
    }

    /// @notice Rescue stuck tokens
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue stuck BNB
    function rescueNative(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "Transfer failed");
    }

    // Accept BNB for LayerZero fees
    receive() external payable {}
}
