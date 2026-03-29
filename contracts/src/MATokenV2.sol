// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title MA Token V2 (Upgradeable)
/// @notice CoinMax platform token — UUPS upgradeable, ERC2612 permit, role-based mint.
///
///  Deployed via thirdweb Factory as ERC1967 proxy.
///  Initialize replaces constructor for proxy pattern.
///
///  Roles:
///    DEFAULT_ADMIN_ROLE — upgrade, config, blacklist, pause
///    MINTER_ROLE — Vault + InterestEngine can mint
///    PAUSER_ROLE — emergency freeze transfers
///
///  Features:
///    - ERC2612 permit() — gasless approve
///    - Supply cap + per-mint limit
///    - Blacklist blocking
///    - UUPS upgradeable
contract MATokenV2 is
    Initializable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public supplyCap;
    uint256 public mintLimit;
    mapping(address => bool) public blacklisted;

    event Minted(address indexed minter, address indexed to, uint256 amount);
    event SupplyCapUpdated(uint256 oldCap, uint256 newCap);
    event MintLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event Blacklisted(address indexed account, bool status);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize (replaces constructor for proxy deployment)
    /// @param _admin Gets DEFAULT_ADMIN_ROLE + MINTER_ROLE + PAUSER_ROLE
    function initialize(address _admin) external initializer {
        require(_admin != address(0), "Invalid admin");

        __ERC20_init("MA", "MA");
        __ERC20Burnable_init();
        __ERC20Permit_init("MA");
        __AccessControl_init();
        __Pausable_init();

        supplyCap = 1_000_000_000 * 1e18;
        mintLimit = 10_000_000 * 1e18;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(MINTER_ROLE, _admin);
        _grantRole(PAUSER_ROLE, _admin);
    }

    // ─── Mint ─────────────────────────────────────────────────────────

    function mintTo(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused {
        require(to != address(0), "Mint to zero address");
        require(amount > 0, "Zero amount");
        require(amount <= mintLimit, "Exceeds mint limit");
        require(totalSupply() + amount <= supplyCap, "Exceeds supply cap");

        _mint(to, amount);
        emit Minted(msg.sender, to, amount);
    }

    // ─── Pause ────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ─── Blacklist ────────────────────────────────────────────────────

    function setBlacklist(address account, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(account != address(0), "Invalid address");
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    // ─── Admin ────────────────────────────────────────────────────────

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

    // ─── Transfer Override ────────────────────────────────────────────

    function _update(address from, address to, uint256 value) internal override(ERC20Upgradeable) {
        require(!blacklisted[from], "Sender blacklisted");
        require(!blacklisted[to], "Recipient blacklisted");

        if (from != address(0) && to != address(0)) {
            require(!paused(), "Transfers paused");
        }

        super._update(from, to, value);
    }

    // ─── UUPS ─────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
