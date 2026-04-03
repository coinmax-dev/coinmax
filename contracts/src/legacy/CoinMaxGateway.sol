// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice cUSD token interface (mintTo)
interface ICUSDGateway {
    function mintTo(address to, uint256 amount) external;
}

/// @notice CoinMaxVault interface (depositFor)
interface ICoinMaxVaultGateway {
    function depositFor(address user, uint256 cUsdAmount, uint256 planIndex) external;
}

/// @notice Generic DEX router (PancakeSwap V3 / Uniswap V3 / Camelot)
interface IDEXRouter {
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

/// @notice Cross-chain bridge adapter interface
interface IBridgeAdapter {
    function sendMessage(
        uint32 dstChainId,
        bytes calldata payload,
        bytes calldata options
    ) external payable returns (bytes32 messageId);

    function estimateFee(
        uint32 dstChainId,
        bytes calldata payload,
        bytes calldata options
    ) external view returns (uint256 nativeFee);
}

/// @title CoinMax Gateway (Clone-Ready, Multi-Chain)
/// @notice Entry point for deposits on any chain. Deployed as minimal clone
///         via CoinMaxFactory for each chain (BSC, ARB, Base).
///
///  On SOURCE chains (BSC, Base):
///    User USDT → DEX swap → USDC → treasury → cross-chain msg to ARB
///
///  On VAULT chain (ARB):
///    Receives cross-chain msg → mint cUSD → Vault.depositFor()
///    Also accepts direct deposits on ARB
///
///  Roles:
///    DEFAULT_ADMIN_ROLE — owner / multisig
///    SERVER_ROLE        — thirdweb Engine wallet (relay cross-chain messages)
///    RELAYER_ROLE       — bridge adapter callback
///
///  Clone deployment (per chain):
///    impl = new CoinMaxGateway();
///    clone = Clones.clone(impl);
///    CoinMaxGateway(clone).initialize(...);
contract CoinMaxGateway is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice thirdweb Engine Server Wallet (cross-chain relay, emergency)
    bytes32 public constant SERVER_ROLE = keccak256("SERVER_ROLE");

    /// @notice Bridge adapter callback role
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Whether this gateway is on the vault chain (ARB)
    bool public isVaultChain;

    IERC20 public usdt;
    IERC20 public usdc;
    IDEXRouter public dexRouter;
    uint24 public poolFee;

    /// @notice Treasury wallet on THIS chain — receives USDC
    address public treasury;

    // ─── Vault Chain Only ───────────────────────────────────────────
    ICUSDGateway public cUsd;
    ICoinMaxVaultGateway public vault;

    // ─── Source Chain Only ──────────────────────────────────────────
    IBridgeAdapter public bridgeAdapter;
    uint32 public vaultChainId;

    // ─── Protection ─────────────────────────────────────────────────
    uint256 public maxSlippageBps;
    uint256 public maxDepositAmount;
    uint256 public cooldownPeriod;
    mapping(address => uint256) public lastDepositTime;

    /// @notice Trusted remote gateway addresses (source chain → bytes32)
    mapping(bytes32 => bool) public trustedRemotes;

    address public trustedForwarder;

    // ─── Gap ────────────────────────────────────────────────────────
    uint256[29] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event DepositInitiated(
        address indexed user,
        uint256 usdtIn,
        uint256 usdcOut,
        uint256 planIndex,
        bool crossChain,
        uint256 timestamp
    );
    event CrossChainDepositReceived(
        address indexed user,
        uint256 usdcAmount,
        uint256 planIndex,
        uint32 srcChainId,
        uint256 timestamp
    );
    event ConfigUpdated(string param);

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _isVaultChain true if ARB (vault chain)
    /// @param _usdt USDT address on this chain
    /// @param _usdc USDC address on this chain
    /// @param _dexRouter DEX router address
    /// @param _poolFee DEX pool fee tier
    /// @param _treasury Treasury wallet on this chain
    /// @param _admin Admin address
    /// @param _serverWallet thirdweb Engine wallet
    function initialize(
        bool _isVaultChain,
        address _usdt,
        address _usdc,
        address _dexRouter,
        uint24 _poolFee,
        address _treasury,
        address _admin,
        address _serverWallet
    ) external initializer {
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");
        require(_dexRouter != address(0), "Invalid DEX");
        require(_treasury != address(0), "Invalid treasury");
        require(_admin != address(0), "Invalid admin");

        __AccessControl_init();
        // ReentrancyGuard (OZ5) does not need init
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_serverWallet != address(0)) {
            _grantRole(SERVER_ROLE, _serverWallet);
            _grantRole(RELAYER_ROLE, _serverWallet);
        }

        isVaultChain = _isVaultChain;
        usdt = IERC20(_usdt);
        usdc = IERC20(_usdc);
        dexRouter = IDEXRouter(_dexRouter);
        poolFee = _poolFee;
        treasury = _treasury;

        maxSlippageBps = 10;              // 0.1% for stables
        maxDepositAmount = 100_000e18;
        cooldownPeriod = 30;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: DEPOSIT TO VAULT
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Deposit USDT → swap → route to vault
    /// @param usdtAmount USDT amount
    /// @param planIndex Staking plan index
    /// @param minUsdcOut Min USDC from swap (slippage)
    /// @param bridgeOptions Cross-chain options (ignored on vault chain)
    function depositVault(
        uint256 usdtAmount,
        uint256 planIndex,
        uint256 minUsdcOut,
        bytes calldata bridgeOptions
    ) external payable nonReentrant whenNotPaused {
        require(usdtAmount > 0, "Zero amount");
        require(usdtAmount <= maxDepositAmount, "Exceeds max");
        require(
            block.timestamp >= lastDepositTime[msg.sender] + cooldownPeriod,
            "Cooldown active"
        );

        uint256 floor = (usdtAmount * (10000 - maxSlippageBps)) / 10000;
        require(minUsdcOut >= floor, "Slippage too high");

        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);
        uint256 usdcReceived = _swapToUsdc(usdtAmount, minUsdcOut);

        usdc.safeTransfer(treasury, usdcReceived);
        lastDepositTime[msg.sender] = block.timestamp;

        if (isVaultChain) {
            _mintAndDeposit(msg.sender, usdcReceived, planIndex);
        } else {
            _sendCrossChainDeposit(msg.sender, usdcReceived, planIndex, bridgeOptions);
        }

        emit DepositInitiated(
            msg.sender, usdtAmount, usdcReceived, planIndex, !isVaultChain, block.timestamp
        );
    }

    /// @notice Deposit USDC directly (no swap)
    function depositVaultUsdc(
        uint256 usdcAmount,
        uint256 planIndex,
        bytes calldata bridgeOptions
    ) external payable nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Zero amount");
        require(usdcAmount <= maxDepositAmount, "Exceeds max");

        usdc.safeTransferFrom(msg.sender, treasury, usdcAmount);
        lastDepositTime[msg.sender] = block.timestamp;

        if (isVaultChain) {
            _mintAndDeposit(msg.sender, usdcAmount, planIndex);
        } else {
            _sendCrossChainDeposit(msg.sender, usdcAmount, planIndex, bridgeOptions);
        }

        emit DepositInitiated(
            msg.sender, 0, usdcAmount, planIndex, !isVaultChain, block.timestamp
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CROSS-CHAIN: RECEIVE (vault chain only)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Receive cross-chain deposit from source chain.
    ///         Called by bridge adapter or Server Wallet relay.
    function receiveCrossChainDeposit(
        uint32 srcChainId,
        bytes32 srcSender,
        bytes calldata payload
    ) external whenNotPaused {
        require(isVaultChain, "Only vault chain");
        require(
            hasRole(RELAYER_ROLE, msg.sender) || hasRole(SERVER_ROLE, msg.sender),
            "Unauthorized"
        );
        require(trustedRemotes[srcSender], "Untrusted remote");

        (address user, uint256 usdcAmount, uint256 planIndex) = abi.decode(
            payload, (address, uint256, uint256)
        );
        require(user != address(0) && usdcAmount > 0, "Invalid payload");

        _mintAndDeposit(user, usdcAmount, planIndex);

        emit CrossChainDepositReceived(
            user, usdcAmount, planIndex, srcChainId, block.timestamp
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW
    // ═══════════════════════════════════════════════════════════════════

    function estimateDepositFee(
        uint256 usdcAmount,
        uint256 planIndex,
        bytes calldata bridgeOptions
    ) external view returns (uint256) {
        require(!isVaultChain, "No fee on vault chain");
        bytes memory payload = abi.encode(msg.sender, usdcAmount, planIndex);
        return bridgeAdapter.estimateFee(vaultChainId, payload, bridgeOptions);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════════

    function _swapToUsdc(uint256 amountIn, uint256 amountOutMin) internal returns (uint256) {
        usdt.safeIncreaseAllowance(address(dexRouter), amountIn);
        return dexRouter.exactInputSingle(
            IDEXRouter.ExactInputSingleParams({
                tokenIn: address(usdt),
                tokenOut: address(usdc),
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMin,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _mintAndDeposit(address user, uint256 usdcAmount, uint256 planIndex) internal {
        cUsd.mintTo(address(this), usdcAmount);
        SafeERC20.forceApprove(IERC20(address(cUsd)), address(vault), usdcAmount);
        vault.depositFor(user, usdcAmount, planIndex);
    }

    function _sendCrossChainDeposit(
        address user,
        uint256 usdcAmount,
        uint256 planIndex,
        bytes calldata bridgeOptions
    ) internal {
        require(address(bridgeAdapter) != address(0), "Bridge not set");
        bytes memory payload = abi.encode(user, usdcAmount, planIndex);
        bridgeAdapter.sendMessage{value: msg.value}(vaultChainId, payload, bridgeOptions);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setCUsd(address _cUsd) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_cUsd != address(0), "Invalid");
        cUsd = ICUSDGateway(_cUsd);
        emit ConfigUpdated("cUsd");
    }

    function setVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "Invalid");
        vault = ICoinMaxVaultGateway(_vault);
        emit ConfigUpdated("vault");
    }

    function setBridgeAdapter(address _bridge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bridge != address(0), "Invalid");
        bridgeAdapter = IBridgeAdapter(_bridge);
        emit ConfigUpdated("bridgeAdapter");
    }

    function setVaultChainId(uint32 _chainId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vaultChainId = _chainId;
        emit ConfigUpdated("vaultChainId");
    }

    function setTrustedRemote(bytes32 remote, bool trusted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedRemotes[remote] = trusted;
        emit ConfigUpdated("trustedRemote");
    }

    function setTreasury(address _t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_t != address(0), "Invalid");
        treasury = _t;
        emit ConfigUpdated("treasury");
    }

    function setDexRouter(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_r != address(0), "Invalid");
        dexRouter = IDEXRouter(_r);
        emit ConfigUpdated("dexRouter");
    }

    function setPoolFee(uint24 _fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poolFee = _fee;
        emit ConfigUpdated("poolFee");
    }

    function setMaxSlippageBps(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_bps > 0 && _bps <= 100, "1-100");
        maxSlippageBps = _bps;
    }

    function setMaxDepositAmount(uint256 _amt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amt > 0, "Invalid");
        maxDepositAmount = _amt;
    }

    function setCooldownPeriod(uint256 _s) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_s <= 300, "Max 5 min");
        cooldownPeriod = _s;
    }

    function setUsdt(address _t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_t != address(0), "Invalid");
        usdt = IERC20(_t);
    }

    function setUsdc(address _t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_t != address(0), "Invalid");
        usdc = IERC20(_t);
    }

    function setTrustedForwarder(address _forwarder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        trustedForwarder = _forwarder;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amt);
    }

    function emergencyWithdrawNative(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid");
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "Failed");
    }

    receive() external payable {}

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
}
