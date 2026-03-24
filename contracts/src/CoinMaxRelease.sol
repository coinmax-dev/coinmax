// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Interface for MA token
interface IMATokenRelease {
    function transfer(address to, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Cross-chain bridge adapter for sending MA to other chains
interface IBridgeAdapterRelease {
    function sendTokens(
        uint32 dstChainId,
        address recipient,
        uint256 amount,
        bytes calldata options
    ) external payable returns (bytes32 messageId);

    function estimateFee(
        uint32 dstChainId,
        address recipient,
        uint256 amount,
        bytes calldata options
    ) external view returns (uint256 nativeFee);
}

/// @title CoinMax Release (Upgradeable)
/// @notice Manages MA interest release with user-chosen split ratio.
///         Deployed behind ERC1967Proxy via CoinMaxFactory.
///
///  When InterestEngine processes daily interest, MA is minted to this contract
///  and credited to the user's accumulated balance. The user then chooses a
///  "release plan" that determines:
///    - Split ratio: what % of MA is released vs burned
///    - Release period: how long the released portion takes to vest
///
///  Release Plans:
///    Plan 0: 100% release, 0% burn  → 60-day linear release
///    Plan 1: 95% release,  5% burn  → 30-day linear release
///    Plan 2: 90% release, 10% burn  → 15-day linear release
///    Plan 3: 85% release, 15% burn  → 7-day linear release
///    Plan 4: 80% release, 20% burn  → Instant release
///
///  Roles:
///    DEFAULT_ADMIN_ROLE — owner / multisig
///    VAULT_ROLE         — CoinMaxInterestEngine (addAccumulated)
///    SERVER_ROLE        — thirdweb Engine wallet (batch operations)
contract CoinMaxRelease is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════
    //  ROLES
    // ═══════════════════════════════════════════════════════════════════

    /// @notice InterestEngine can add accumulated interest
    bytes32 public constant VAULT_ROLE = keccak256("VAULT_ROLE");

    /// @notice Server Wallet for batch operations
    bytes32 public constant SERVER_ROLE = keccak256("SERVER_ROLE");

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    IMATokenRelease public maToken;

    /// @notice Optional bridge adapter for cross-chain MA release
    IBridgeAdapterRelease public bridgeAdapter;

    /// @notice User's total accumulated interest (not yet scheduled for release)
    mapping(address => uint256) public accumulated;

    // ─── Release Plans ──────────────────────────────────────────────

    struct ReleasePlan {
        uint256 releaseRate;   // bps of MA released (10000 = 100%, 8000 = 80%)
        uint256 duration;      // linear release period in seconds (0 = instant)
        bool active;
    }

    ReleasePlan[] public releasePlans;

    // ─── Release Positions ──────────────────────────────────────────

    struct ReleasePosition {
        uint256 totalAmount;    // original MA amount before split
        uint256 releaseAmount;  // MA to receive (after burn)
        uint256 burnedAmount;   // MA burned
        uint256 startTime;
        uint256 duration;       // 0 = instant (already claimed)
        uint256 claimed;        // amount already claimed
    }

    mapping(address => ReleasePosition[]) public userReleases;

    // ─── Gap for future upgrades ────────────────────────────────────
    uint256[40] private __gap;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event AccumulatedAdded(address indexed user, uint256 amount);
    event ReleaseCreated(
        address indexed user,
        uint256 releaseIndex,
        uint256 planIndex,
        uint256 totalAmount,
        uint256 releaseAmount,
        uint256 burnedAmount,
        uint256 duration
    );
    event ReleaseClaimed(address indexed user, uint256 releaseIndex, uint256 amount);
    event ReleaseBridged(
        address indexed user,
        uint256 releaseIndex,
        uint256 amount,
        uint32 dstChainId
    );
    event ReleasePlanUpdated(uint256 index, uint256 releaseRate, uint256 duration, bool active);

    // ═══════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ═══════════════════════════════════════════════════════════════════

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param _maToken MA token address
    /// @param _admin Admin address
    /// @param _engine CoinMaxInterestEngine address (gets VAULT_ROLE)
    /// @param _serverWallet thirdweb Engine wallet (gets SERVER_ROLE)
    function initialize(
        address _maToken,
        address _admin,
        address _engine,
        address _serverWallet
    ) external initializer {
        require(_maToken != address(0), "Invalid MA");
        require(_admin != address(0), "Invalid admin");

        __AccessControl_init();
        // ReentrancyGuard (OZ5) does not need init
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        if (_engine != address(0)) _grantRole(VAULT_ROLE, _engine);
        if (_serverWallet != address(0)) _grantRole(SERVER_ROLE, _serverWallet);

        maToken = IMATokenRelease(_maToken);

        // Default release plans: split ratio → release period
        releasePlans.push(ReleasePlan(10000, 60 days, true));  // 100% release, 60-day linear
        releasePlans.push(ReleasePlan(9500,  30 days, true));  // 95% release,  30-day linear
        releasePlans.push(ReleasePlan(9000,  15 days, true));  // 90% release,  15-day linear
        releasePlans.push(ReleasePlan(8500,  7 days,  true));  // 85% release,  7-day linear
        releasePlans.push(ReleasePlan(8000,  0,       true));  // 80% release,  instant
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ENGINE INTERFACE — called by CoinMaxInterestEngine
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Add accumulated MA interest for a user.
    ///         Called by InterestEngine after minting MA to this contract.
    function addAccumulated(address user, uint256 amount) external onlyRole(VAULT_ROLE) {
        require(user != address(0), "Invalid user");
        accumulated[user] += amount;
        emit AccumulatedAdded(user, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: CREATE RELEASE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Create a release schedule for accumulated MA interest.
    ///
    /// @param amount MA amount to release from accumulated balance
    /// @param planIndex Release plan index
    ///
    /// Example: 1000 MA accumulated, plan 1 (95%/30d):
    ///   → 950 MA vests linearly over 30 days
    ///   → 50 MA burned immediately
    function createRelease(
        uint256 amount,
        uint256 planIndex
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Zero amount");
        require(accumulated[msg.sender] >= amount, "Insufficient accumulated");
        require(planIndex < releasePlans.length, "Invalid plan");

        ReleasePlan storage plan = releasePlans[planIndex];
        require(plan.active, "Plan not active");

        accumulated[msg.sender] -= amount;

        uint256 releaseAmount = (amount * plan.releaseRate) / 10000;
        uint256 burnAmount = amount - releaseAmount;

        // Burn the non-release portion immediately
        if (burnAmount > 0) {
            maToken.burn(burnAmount);
        }

        uint256 releaseIndex = userReleases[msg.sender].length;

        if (plan.duration == 0) {
            // Instant release
            maToken.transfer(msg.sender, releaseAmount);

            userReleases[msg.sender].push(ReleasePosition({
                totalAmount: amount,
                releaseAmount: releaseAmount,
                burnedAmount: burnAmount,
                startTime: block.timestamp,
                duration: 0,
                claimed: releaseAmount
            }));
        } else {
            // Linear vesting
            userReleases[msg.sender].push(ReleasePosition({
                totalAmount: amount,
                releaseAmount: releaseAmount,
                burnedAmount: burnAmount,
                startTime: block.timestamp,
                duration: plan.duration,
                claimed: 0
            }));
        }

        emit ReleaseCreated(
            msg.sender, releaseIndex, planIndex,
            amount, releaseAmount, burnAmount, plan.duration
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  CORE: CLAIM VESTED MA
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Claim vested MA from a linear release (same chain)
    function claimRelease(uint256 releaseIndex) external nonReentrant whenNotPaused {
        require(releaseIndex < userReleases[msg.sender].length, "Invalid index");
        ReleasePosition storage pos = userReleases[msg.sender][releaseIndex];
        require(pos.duration > 0, "Instant: already claimed");

        uint256 claimable = _claimableAmount(pos);
        require(claimable > 0, "Nothing to claim");

        pos.claimed += claimable;
        maToken.transfer(msg.sender, claimable);

        emit ReleaseClaimed(msg.sender, releaseIndex, claimable);
    }

    /// @notice Claim vested MA and bridge to another chain
    function claimAndBridge(
        uint256 releaseIndex,
        uint32 dstChainId,
        bytes calldata bridgeOptions
    ) external payable nonReentrant whenNotPaused {
        require(address(bridgeAdapter) != address(0), "Bridge not configured");
        require(releaseIndex < userReleases[msg.sender].length, "Invalid index");
        ReleasePosition storage pos = userReleases[msg.sender][releaseIndex];
        require(pos.duration > 0, "Instant: already claimed");

        uint256 claimable = _claimableAmount(pos);
        require(claimable > 0, "Nothing to claim");

        pos.claimed += claimable;

        IERC20(address(maToken)).approve(address(bridgeAdapter), claimable);
        bridgeAdapter.sendTokens{value: msg.value}(
            dstChainId, msg.sender, claimable, bridgeOptions
        );

        emit ReleaseBridged(msg.sender, releaseIndex, claimable, dstChainId);
    }

    /// @notice Batch claim all claimable linear releases
    function claimAll() external nonReentrant whenNotPaused {
        ReleasePosition[] storage releases = userReleases[msg.sender];
        uint256 totalClaim;

        for (uint256 i = 0; i < releases.length; i++) {
            if (releases[i].duration == 0) continue;
            uint256 claimable = _claimableAmount(releases[i]);
            if (claimable > 0) {
                releases[i].claimed += claimable;
                totalClaim += claimable;
                emit ReleaseClaimed(msg.sender, i, claimable);
            }
        }

        require(totalClaim > 0, "Nothing to claim");
        maToken.transfer(msg.sender, totalClaim);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  VIEW
    // ═══════════════════════════════════════════════════════════════════

    function getUserReleaseCount(address user) external view returns (uint256) {
        return userReleases[user].length;
    }

    function getReleaseInfo(address user, uint256 index) external view returns (
        uint256 totalAmount,
        uint256 releaseAmount,
        uint256 burnedAmount,
        uint256 startTime,
        uint256 duration,
        uint256 claimed,
        uint256 claimable,
        uint256 vested
    ) {
        ReleasePosition storage pos = userReleases[user][index];
        uint256 vestedAmt = _vestedAmount(pos);
        return (
            pos.totalAmount,
            pos.releaseAmount,
            pos.burnedAmount,
            pos.startTime,
            pos.duration,
            pos.claimed,
            vestedAmt - pos.claimed,
            vestedAmt
        );
    }

    function getReleasePlansCount() external view returns (uint256) {
        return releasePlans.length;
    }

    function getTotalClaimable(address user) external view returns (uint256 total) {
        for (uint256 i = 0; i < userReleases[user].length; i++) {
            total += _claimableAmount(userReleases[user][i]);
        }
    }

    function estimateBridgeFee(
        uint32 dstChainId,
        uint256 amount,
        bytes calldata bridgeOptions
    ) external view returns (uint256) {
        require(address(bridgeAdapter) != address(0), "Bridge not configured");
        return bridgeAdapter.estimateFee(dstChainId, msg.sender, amount, bridgeOptions);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setMAToken(address _maToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_maToken != address(0), "Invalid");
        maToken = IMATokenRelease(_maToken);
    }

    function setBridgeAdapter(address _bridge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridgeAdapter = IBridgeAdapterRelease(_bridge);
    }

    function updateReleasePlan(
        uint256 index,
        uint256 releaseRate,
        uint256 duration,
        bool active
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < releasePlans.length, "Invalid index");
        require(releaseRate <= 10000, "Rate exceeds 100%");
        releasePlans[index] = ReleasePlan(releaseRate, duration, active);
        emit ReleasePlanUpdated(index, releaseRate, duration, active);
    }

    function addReleasePlan(
        uint256 releaseRate,
        uint256 duration
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(releaseRate <= 10000, "Rate exceeds 100%");
        releasePlans.push(ReleasePlan(releaseRate, duration, true));
        emit ReleasePlanUpdated(releasePlans.length - 1, releaseRate, duration, true);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid");
        IERC20(token).safeTransfer(to, amount);
    }

    function emergencyWithdrawNative(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Invalid");
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "Transfer failed");
    }

    receive() external payable {}

    // ═══════════════════════════════════════════════════════════════════
    //  INTERNAL
    // ═══════════════════════════════════════════════════════════════════

    function _vestedAmount(ReleasePosition storage pos) internal view returns (uint256) {
        if (pos.duration == 0) return pos.releaseAmount;

        uint256 elapsed = block.timestamp - pos.startTime;
        if (elapsed >= pos.duration) return pos.releaseAmount;

        return (pos.releaseAmount * elapsed) / pos.duration;
    }

    function _claimableAmount(ReleasePosition storage pos) internal view returns (uint256) {
        return _vestedAmount(pos) - pos.claimed;
    }
}
