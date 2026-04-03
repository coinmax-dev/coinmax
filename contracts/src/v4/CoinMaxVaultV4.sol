// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICUSD { function mint(address to, uint256 amount) external; function burnFrom(address from, uint256 amount) external; function balanceOf(address) external view returns (uint256); }
interface IMATokenV4 { function mint(address to, uint256 amount) external; }
interface IPriceOracle { function getPrice() external view returns (uint256); }

contract CoinMaxVaultV4 is Initializable, ERC4626Upgradeable, AccessControlUpgradeable, PausableUpgradeable, UUPSUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");
    bytes32 public constant SERVER_ROLE = keccak256("SERVER_ROLE");

    ICUSD public cusd; IMATokenV4 public maToken; IPriceOracle public oracle; IERC20 public usdc;
    address public usdcReceiver; address public maReceiver;

    struct StakePosition { uint256 cusdAmount; uint256 shares; string planType; uint256 dailyRate; uint256 startTime; uint256 duration; bool isBonus; bool yieldLocked; bool principalClaimed; }
    mapping(address => StakePosition[]) public userStakes;

    struct NodePosition { string nodeType; uint256 contributionUSDC; uint256 cusdLeverage; uint256 dailyRate; uint256 startTime; uint256 duration; bool active; }
    mapping(address => NodePosition[]) public userNodes;

    uint256 public totalCUSDDeposited; uint256 public totalYieldMinted; uint256 public totalMAMinted;

    event Deposited(address indexed user, uint256 usdcAmount, uint256 cusdMinted, uint256 shares, string planType);
    event NodePurchased(address indexed user, string nodeType, uint256 usdcAmount, uint256 cusdLeverage);
    event YieldSettled(uint256 totalCUSDYield, uint256 totalMAMinted, uint256 maPrice, uint256 positionsProcessed);

    function initialize(address _cusd, address _usdc, address _maToken, address _oracle, address _usdcReceiver, address _maReceiver) public initializer {
        __ERC4626_init(IERC20(_cusd)); __ERC20_init("CoinMax Vault V4", "cmVAULT"); __AccessControl_init(); __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        cusd = ICUSD(_cusd); usdc = IERC20(_usdc); maToken = IMATokenV4(_maToken); oracle = IPriceOracle(_oracle); usdcReceiver = _usdcReceiver; maReceiver = _maReceiver;
    }

    function depositPublic(uint256 usdcAmount, string calldata planType) external nonReentrant whenNotPaused returns (uint256 shares) {
        require(usdcAmount > 0, "Zero"); address user = msg.sender;
        usdc.safeTransferFrom(user, address(this), usdcAmount);
        if (usdcReceiver != address(0)) usdc.safeTransfer(usdcReceiver, usdcAmount);
        cusd.mint(address(this), usdcAmount);
        // Mint shares directly (bypass ERC4626.deposit which does transferFrom on msg.sender)
        shares = previewDeposit(usdcAmount);
        _mint(user, shares);
        uint256 duration = _parseDuration(planType); uint256 rate = _parseRate(planType);
        userStakes[user].push(StakePosition(usdcAmount, shares, planType, rate, block.timestamp, duration, false, false, false));
        totalCUSDDeposited += usdcAmount;
        emit Deposited(user, usdcAmount, usdcAmount, shares, planType);
    }

    function purchaseNode(string calldata nodeType, uint256 usdcAmount) external nonReentrant whenNotPaused {
        require(usdcAmount > 0, "Zero"); address user = msg.sender;
        usdc.safeTransferFrom(user, address(this), usdcAmount);
        if (usdcReceiver != address(0)) usdc.safeTransfer(usdcReceiver, usdcAmount);
        (uint256 leverage, uint256 duration, uint256 rate) = _nodeConfig(nodeType);
        uint256 cusdLeverage = usdcAmount * leverage / 100;
        cusd.mint(address(this), cusdLeverage);
        userNodes[user].push(NodePosition(nodeType, usdcAmount, cusdLeverage, rate, block.timestamp, duration, true));
        emit NodePurchased(user, nodeType, usdcAmount, cusdLeverage);
    }

    function settleYield(address[] calldata users, uint256[] calldata cusdYields, uint256[] calldata maAmounts) external onlyRole(ENGINE_ROLE) nonReentrant {
        require(users.length == cusdYields.length && users.length == maAmounts.length, "Mismatch");
        uint256 tCUSD = 0; uint256 tMA = 0; uint256 maPrice = oracle.getPrice();
        for (uint256 i = 0; i < users.length; i++) {
            if (cusdYields[i] == 0) continue;
            cusd.mint(address(this), cusdYields[i]);
            IERC20(address(cusd)).approve(address(this), cusdYields[i]);
            tCUSD += cusdYields[i];
            if (maAmounts[i] > 0) { maToken.mint(maReceiver, maAmounts[i]); tMA += maAmounts[i]; }
        }
        totalYieldMinted += tCUSD; totalMAMinted += tMA;
        emit YieldSettled(tCUSD, tMA, maPrice, users.length);
    }

    function getUserStakes(address user) external view returns (StakePosition[] memory) { return userStakes[user]; }
    function getUserNodes(address user) external view returns (NodePosition[] memory) { return userNodes[user]; }

    function _parseDuration(string calldata p) internal pure returns (uint256) {
        if (_eq(p,"5_DAYS")) return 5 days; if (_eq(p,"45_DAYS")) return 45 days; if (_eq(p,"90_DAYS")) return 90 days; if (_eq(p,"180_DAYS")) return 180 days; revert("Invalid");
    }
    function _parseRate(string calldata p) internal pure returns (uint256) {
        if (_eq(p,"5_DAYS")) return 50; if (_eq(p,"45_DAYS")) return 70; if (_eq(p,"90_DAYS")) return 90; if (_eq(p,"180_DAYS")) return 100; revert("Invalid");
    }
    function _nodeConfig(string calldata n) internal pure returns (uint256, uint256, uint256) {
        if (_eq(n,"MAX")) return (1100, 120 days, 90); if (_eq(n,"MINI")) return (1100, 90 days, 90); revert("Invalid");
    }
    function _eq(string calldata a, string memory b) internal pure returns (bool) { return keccak256(bytes(a)) == keccak256(bytes(b)); }

    function setUsdcReceiver(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) { usdcReceiver = _r; }
    function setMaReceiver(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) { maReceiver = _r; }
    function setOracle(address _o) external onlyRole(DEFAULT_ADMIN_ROLE) { oracle = IPriceOracle(_o); }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
