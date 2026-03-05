// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CoinMax Fund Manager
/// @notice Receives funds from payment contracts (Nodes, VIP, Vault) and manages
///         distribution to configured wallets with configurable ratios.
contract CoinMaxFundManager is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice Authorized contracts that can deposit (CoinMaxNodes, VIP, Vault, etc.)
    mapping(address => bool) public authorizedSources;

    /// @notice Whitelisted tokens
    mapping(address => bool) public allowedTokens;

    struct Recipient {
        address wallet;
        uint256 share; // basis points (e.g. 5000 = 50%)
    }

    /// @notice Fund distribution recipients
    Recipient[] public recipients;

    /// @notice Total shares must equal 10000 (100%)
    uint256 public constant TOTAL_BASIS = 10000;

    // ─── Events ─────────────────────────────────────────────────────────

    event FundsReceived(address indexed from, address indexed token, uint256 amount);
    event FundsDistributed(address indexed token, uint256 totalAmount);
    event RecipientPaid(address indexed recipient, address indexed token, uint256 amount);
    event RecipientsUpdated(uint256 count);
    event SourceAuthorized(address indexed source, bool authorized);
    event TokenAllowed(address indexed token, bool allowed);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _usdt USDT token address
    /// @param _usdc USDC token address
    constructor(
        address _usdt,
        address _usdc
    ) Ownable(msg.sender) {
        require(_usdt != address(0), "Invalid USDT");
        require(_usdc != address(0), "Invalid USDC");

        allowedTokens[_usdt] = true;
        allowedTokens[_usdc] = true;
        emit TokenAllowed(_usdt, true);
        emit TokenAllowed(_usdc, true);
    }

    // ─── Core ───────────────────────────────────────────────────────────

    /// @notice Distribute a specific token's balance to all recipients
    /// @param token The ERC20 token to distribute
    function distribute(address token) external nonReentrant whenNotPaused {
        require(allowedTokens[token], "Token not allowed");
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance to distribute");

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 payout = (balance * recipients[i].share) / TOTAL_BASIS;
            if (payout > 0) {
                IERC20(token).safeTransfer(recipients[i].wallet, payout);
                emit RecipientPaid(recipients[i].wallet, token, payout);
            }
        }

        emit FundsDistributed(token, balance);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    /// @notice Set distribution recipients and their shares
    /// @param _wallets Recipient addresses
    /// @param _shares Shares in basis points (must sum to 10000)
    function setRecipients(
        address[] calldata _wallets,
        uint256[] calldata _shares
    ) external onlyOwner {
        _setRecipients(_wallets, _shares);
    }

    /// @notice Authorize or revoke a source contract (e.g. CoinMaxNodes)
    function setAuthorizedSource(address source, bool authorized) external onlyOwner {
        require(source != address(0), "Invalid source");
        authorizedSources[source] = authorized;
        emit SourceAuthorized(source, authorized);
    }

    /// @notice Add or remove a whitelisted token
    function setAllowedToken(address token, bool allowed) external onlyOwner {
        require(token != address(0), "Invalid token");
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    /// @notice Pause contract in emergency
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause contract
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency: withdraw tokens stuck in this contract
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address");
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    // ─── View ───────────────────────────────────────────────────────────

    /// @notice Get the number of recipients
    function getRecipientsCount() external view returns (uint256) {
        return recipients.length;
    }

    /// @notice Get token balance held in this contract
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _setRecipients(
        address[] memory _wallets,
        uint256[] memory _shares
    ) internal {
        require(_wallets.length > 0, "No recipients");
        require(_wallets.length == _shares.length, "Length mismatch");

        // Clear existing recipients
        delete recipients;

        uint256 totalShares;
        for (uint256 i = 0; i < _wallets.length; i++) {
            require(_wallets[i] != address(0), "Invalid recipient");
            require(_shares[i] > 0, "Share must be > 0");
            totalShares += _shares[i];
            recipients.push(Recipient(_wallets[i], _shares[i]));
        }
        require(totalShares == TOTAL_BASIS, "Shares must total 10000");

        emit RecipientsUpdated(_wallets.length);
    }
}
