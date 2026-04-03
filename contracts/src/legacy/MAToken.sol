// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title MA Token
/// @notice CoinMax platform token with role-based minting and burning.
///
///  Mint permission:
///    MINTER_ROLE — granted to Vault (principal minting) and InterestEngine (interest minting)
///    Only authorized contracts can mint, preventing unauthorized inflation.
///
///  Burn permission:
///    Any holder can burn their own tokens (ERC20Burnable)
///    Release contract burns non-released portion via burn()
///
///  Security:
///    1. MINTER_ROLE — only Vault + Engine can mint
///    2. PAUSER_ROLE — emergency freeze all transfers
///    3. Supply cap — hard ceiling prevents runaway minting
///    4. Per-mint limit — single call cap
///    5. Blacklist — block compromised addresses
///    6. ERC20Burnable — deflationary via Release burns
contract MAToken is ERC20, ERC20Burnable, AccessControl, Pausable {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Maximum total supply (default 1B MA)
    uint256 public supplyCap = 1_000_000_000 * 1e18;

    /// @notice Maximum tokens per single mint call (default 10M)
    uint256 public mintLimit = 10_000_000 * 1e18;

    /// @notice Blacklisted addresses
    mapping(address => bool) public blacklisted;

    // ─── Events ─────────────────────────────────────────────────────────

    event Minted(address indexed minter, address indexed to, uint256 amount);
    event SupplyCapUpdated(uint256 oldCap, uint256 newCap);
    event MintLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event Blacklisted(address indexed account, bool status);

    // ─── Constructor ────────────────────────────────────────────────────

    /// @param _admin Gets DEFAULT_ADMIN_ROLE + MINTER_ROLE + PAUSER_ROLE
    constructor(address _admin) ERC20("MA", "MA") {
        require(_admin != address(0), "Invalid admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    // ─── Mint ───────────────────────────────────────────────────────────

    /// @notice Mint MA tokens to an address
    /// @dev Called by Vault (principal) and InterestEngine (daily interest)
    function mintTo(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(to != address(0), "Mint to zero address");
        require(amount > 0, "Zero amount");
        require(amount <= mintLimit, "Exceeds mint limit");
        require(totalSupply() + amount <= supplyCap, "Exceeds supply cap");

        _mint(to, amount);
        emit Minted(msg.sender, to, amount);
    }

    // ─── Pause ──────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Blacklist ──────────────────────────────────────────────────────

    function setBlacklist(address account, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(account != address(0), "Invalid address");
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function setSupplyCap(uint256 _cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_cap >= totalSupply(), "Cap below current supply");
        uint256 old = supplyCap;
        supplyCap = _cap;
        emit SupplyCapUpdated(old, _cap);
    }

    function setMintLimit(uint256 _limit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_limit > 0, "Invalid limit");
        uint256 old = mintLimit;
        mintLimit = _limit;
        emit MintLimitUpdated(old, _limit);
    }

    // ─── Transfer Override ──────────────────────────────────────────────

    function _update(address from, address to, uint256 value) internal override {
        require(!blacklisted[from], "Sender blacklisted");
        require(!blacklisted[to], "Recipient blacklisted");

        if (from != address(0) && to != address(0)) {
            require(!paused(), "Transfers paused");
        }

        super._update(from, to, value);
    }
}
