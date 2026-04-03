// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Release V4 — MA Token Lock/Release/Destroy Manager (UUPS Upgradeable)

interface IMAToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function burn(uint256 amount) external;
}

contract ReleaseV4 is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    IMAToken public maToken;

    struct UserBalance {
        uint256 released;
        uint256 locked;
        uint256 destroyed;
        uint256 claimed;
    }

    mapping(address => UserBalance) public balances;

    uint256 public totalReleased;
    uint256 public totalLocked;
    uint256 public totalDestroyed;
    uint256 public totalClaimed;

    event Released(address indexed user, uint256 amount, string source);
    event Locked(address indexed user, uint256 amount, string source);
    event Unlocked(address indexed user, uint256 amount, string reason);
    event Destroyed(address indexed user, uint256 amount, string reason);
    event Claimed(address indexed user, uint256 amount);

    function initialize(address _maToken) public initializer {
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        maToken = IMAToken(_maToken);
    }

    // ─── Engine: Add yields ──────────────────────────────────

    function addReleased(address user, uint256 amount, string calldata source) external onlyRole(ENGINE_ROLE) {
        balances[user].released += amount;
        totalReleased += amount;
        emit Released(user, amount, source);
    }

    function addLocked(address user, uint256 amount, string calldata source) external onlyRole(ENGINE_ROLE) {
        balances[user].locked += amount;
        totalLocked += amount;
        emit Locked(user, amount, source);
    }

    function batchAddReleased(address[] calldata users, uint256[] calldata amounts, string calldata source) external onlyRole(ENGINE_ROLE) {
        require(users.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] == 0) continue;
            balances[users[i]].released += amounts[i];
            totalReleased += amounts[i];
            emit Released(users[i], amounts[i], source);
        }
    }

    function batchAddLocked(address[] calldata users, uint256[] calldata amounts, string calldata source) external onlyRole(ENGINE_ROLE) {
        require(users.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] == 0) continue;
            balances[users[i]].locked += amounts[i];
            totalLocked += amounts[i];
            emit Locked(users[i], amounts[i], source);
        }
    }

    // ─── Engine: Unlock / Destroy ────────────────────────────

    function unlock(address user, uint256 amount, string calldata reason) external onlyRole(ENGINE_ROLE) {
        require(balances[user].locked >= amount, "Insufficient locked");
        balances[user].locked -= amount;
        balances[user].released += amount;
        totalLocked -= amount;
        totalReleased += amount;
        emit Unlocked(user, amount, reason);
    }

    function destroy(address user, uint256 amount, string calldata reason) external onlyRole(ENGINE_ROLE) {
        require(balances[user].locked >= amount, "Insufficient locked");
        balances[user].locked -= amount;
        balances[user].destroyed += amount;
        totalLocked -= amount;
        totalDestroyed += amount;
        maToken.burn(amount);
        emit Destroyed(user, amount, reason);
    }

    // ─── User: Claim ─────────────────────────────────────────

    function claim() external nonReentrant whenNotPaused returns (uint256 amount) {
        amount = balances[msg.sender].released;
        require(amount > 0, "Nothing to claim");
        balances[msg.sender].released = 0;
        balances[msg.sender].claimed += amount;
        totalClaimed += amount;
        require(maToken.transfer(msg.sender, amount), "Transfer failed");
        emit Claimed(msg.sender, amount);
    }

    function claimAmount(uint256 amount) external nonReentrant whenNotPaused {
        require(amount > 0 && balances[msg.sender].released >= amount, "Insufficient");
        balances[msg.sender].released -= amount;
        balances[msg.sender].claimed += amount;
        totalClaimed += amount;
        require(maToken.transfer(msg.sender, amount), "Transfer failed");
        emit Claimed(msg.sender, amount);
    }

    // ─── View ────────────────────────────────────────────────

    function getBalance(address user) external view returns (uint256 released, uint256 locked, uint256 destroyed, uint256 claimed) {
        UserBalance storage b = balances[user];
        return (b.released, b.locked, b.destroyed, b.claimed);
    }

    // ─── Admin ───────────────────────────────────────────────

    function setMAToken(address _ma) external onlyRole(DEFAULT_ADMIN_ROLE) { maToken = IMAToken(_ma); }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
