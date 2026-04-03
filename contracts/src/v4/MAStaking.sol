// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MA Staking — Lock MA tokens for vault deposit duration
/// @notice When user deposits cUSD into Vault, Engine mints MA and locks here.
///         On redeem, MA moves to Release contract (待释放).
///
///  Flow:
///    Deposit: Engine mints MA → lock(user, amount, duration)
///    Daily:   MA stays locked, cUSD interest accrues in Vault separately
///    Redeem:  Engine calls unlock() → MA transferred to Release → vault position closed

interface IMAToken {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract MAStaking is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard
{
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    IMAToken public maToken;
    address public releaseContract;     // Release V4 (待释放)

    // ─── Lock record ────────────────────────────────────────

    struct LockRecord {
        address user;
        uint256 maAmount;
        uint256 lockTime;
        uint256 duration;           // same as vault position duration
        uint256 vaultPositionId;    // link to VaultV4 position
        bool unlocked;
    }

    LockRecord[] public locks;
    mapping(address => uint256[]) public userLockIds;

    // ─── Stats ───────────────────────────────────────────────

    uint256 public totalLocked;
    uint256 public totalUnlocked;

    // ─── Events ──────────────────────────────────────────────

    event Locked(uint256 indexed lockId, address indexed user, uint256 maAmount, uint256 duration, uint256 vaultPositionId);
    event Unlocked(uint256 indexed lockId, address indexed user, uint256 maAmount, address releaseContract);

    // ─── Initialize ──────────────────────────────────────────

    function initialize(address _maToken, address _releaseContract) public initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        maToken = IMAToken(_maToken);
        releaseContract = _releaseContract;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Lock MA (called when user deposits cUSD)
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine mints MA and locks it here.
    ///         Called after VaultV4.createPosition().
    /// @param user              User wallet address
    /// @param maAmount          MA amount to mint and lock
    /// @param duration          Lock duration (matches vault plan)
    /// @param vaultPositionId   Corresponding VaultV4 position ID
    function lock(
        address user,
        uint256 maAmount,
        uint256 duration,
        uint256 vaultPositionId
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused returns (uint256 lockId) {
        require(user != address(0) && maAmount > 0, "Invalid");

        // Mint MA directly to this contract (locked)
        maToken.mint(address(this), maAmount);

        lockId = locks.length;
        locks.push(LockRecord(
            user, maAmount, block.timestamp, duration, vaultPositionId, false
        ));
        userLockIds[user].push(lockId);

        totalLocked += maAmount;
        emit Locked(lockId, user, maAmount, duration, vaultPositionId);
    }

    /// @notice Batch lock for multiple users
    function batchLock(
        address[] calldata users,
        uint256[] calldata maAmounts,
        uint256[] calldata durations,
        uint256[] calldata vaultPositionIds
    ) external onlyRole(ENGINE_ROLE) nonReentrant whenNotPaused {
        require(users.length == maAmounts.length && users.length == durations.length && users.length == vaultPositionIds.length, "Mismatch");

        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0) || maAmounts[i] == 0) continue;

            maToken.mint(address(this), maAmounts[i]);

            uint256 lockId = locks.length;
            locks.push(LockRecord(
                users[i], maAmounts[i], block.timestamp, durations[i], vaultPositionIds[i], false
            ));
            userLockIds[users[i]].push(lockId);

            totalLocked += maAmounts[i];
            emit Locked(lockId, users[i], maAmounts[i], durations[i], vaultPositionIds[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Unlock MA → Release contract (赎回/到期)
    // ═══════════════════════════════════════════════════════════

    /// @notice Unlock MA and transfer to Release contract (待释放).
    ///         Called when vault position redeemed or matured.
    ///         After this, VaultV4.closePosition() should be called to stop yield.
    function unlock(uint256 lockId) external onlyRole(ENGINE_ROLE) nonReentrant {
        require(lockId < locks.length, "Invalid");
        LockRecord storage rec = locks[lockId];
        require(!rec.unlocked, "Already unlocked");

        rec.unlocked = true;
        totalLocked -= rec.maAmount;
        totalUnlocked += rec.maAmount;

        // Transfer MA to Release contract
        require(maToken.transfer(releaseContract, rec.maAmount), "Transfer failed");

        emit Unlocked(lockId, rec.user, rec.maAmount, releaseContract);
    }

    /// @notice Batch unlock
    function batchUnlock(uint256[] calldata lockIds) external onlyRole(ENGINE_ROLE) nonReentrant {
        for (uint256 i = 0; i < lockIds.length; i++) {
            if (lockIds[i] >= locks.length) continue;
            LockRecord storage rec = locks[lockIds[i]];
            if (rec.unlocked) continue;

            rec.unlocked = true;
            totalLocked -= rec.maAmount;
            totalUnlocked += rec.maAmount;

            require(maToken.transfer(releaseContract, rec.maAmount), "Transfer failed");
            emit Unlocked(lockIds[i], rec.user, rec.maAmount, releaseContract);
        }
    }

    // ─── View ────────────────────────────────────────────────

    function getLock(uint256 lockId) external view returns (LockRecord memory) {
        return locks[lockId];
    }

    function getUserLocks(address user) external view returns (LockRecord[] memory, uint256[] memory ids) {
        uint256[] storage lockIds = userLockIds[user];
        LockRecord[] memory result = new LockRecord[](lockIds.length);
        for (uint256 i = 0; i < lockIds.length; i++) {
            result[i] = locks[lockIds[i]];
        }
        return (result, lockIds);
    }

    function getUserLockedAmount(address user) external view returns (uint256 amount) {
        uint256[] storage lockIds = userLockIds[user];
        for (uint256 i = 0; i < lockIds.length; i++) {
            if (!locks[lockIds[i]].unlocked) {
                amount += locks[lockIds[i]].maAmount;
            }
        }
    }

    // ─── Admin ───────────────────────────────────────────────

    function setReleaseContract(address _r) external onlyRole(DEFAULT_ADMIN_ROLE) { releaseContract = _r; }
    function setMAToken(address _ma) external onlyRole(DEFAULT_ADMIN_ROLE) { maToken = IMAToken(_ma); }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
