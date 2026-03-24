// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CoinMax Factory
/// @notice Deploys all CoinMax contracts via ERC1967Proxy (upgradeable) or
///         minimal clones (lightweight per-chain deployment).
///
///  Deployment pattern:
///    1. Deploy implementations (CoinMaxVault, InterestEngine, Release, Gateway)
///    2. Deploy Factory
///    3. Call deployVaultChain() — deploys Vault + Engine + Release proxies on ARB
///    4. Call deployGatewayClone() — deploys Gateway clone per source chain
///
///  Proxy strategy:
///    - Vault, InterestEngine, Release: ERC1967Proxy (upgradeable)
///      → These hold state and may need bug fixes / feature upgrades
///    - Gateway: Minimal Clone (lightweight)
///      → Per-chain deployment, lower gas, stateless (config only)
///
///  Role setup:
///    - Factory automatically grants cross-contract roles:
///      Gateway → GATEWAY_ROLE on Vault
///      Engine  → ENGINE_ROLE on Vault
///      Engine  → VAULT_ROLE on Release
///      Server Wallet → SERVER_ROLE on Engine, Gateway
contract CoinMaxFactory is Ownable {
    using Clones for address;

    // ═══════════════════════════════════════════════════════════════════
    //  STORAGE
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Implementation addresses (set once, used for all proxies)
    address public vaultImpl;
    address public engineImpl;
    address public releaseImpl;
    address public gatewayImpl;

    /// @notice Deployed proxy addresses (vault chain)
    address public vaultProxy;
    address public engineProxy;
    address public releaseProxy;

    /// @notice Deployed gateway clones per chain
    mapping(uint32 => address) public gatewayClones;

    /// @notice thirdweb Engine Server Wallet address
    address public serverWallet;

    // ═══════════════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event ImplementationsSet(address vault, address engine, address release, address gateway);
    event VaultChainDeployed(address vault, address engine, address release);
    event GatewayCloneDeployed(uint32 chainId, address gateway);
    event ServerWalletUpdated(address wallet);

    // ═══════════════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor(address _serverWallet) Ownable(msg.sender) {
        serverWallet = _serverWallet;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 1: SET IMPLEMENTATIONS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Register implementation contracts (deploy them first, then set here)
    function setImplementations(
        address _vault,
        address _engine,
        address _release,
        address _gateway
    ) external onlyOwner {
        require(_vault != address(0), "Invalid vault impl");
        require(_engine != address(0), "Invalid engine impl");
        require(_release != address(0), "Invalid release impl");
        require(_gateway != address(0), "Invalid gateway impl");

        vaultImpl = _vault;
        engineImpl = _engine;
        releaseImpl = _release;
        gatewayImpl = _gateway;

        emit ImplementationsSet(_vault, _engine, _release, _gateway);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 2: DEPLOY VAULT CHAIN (ARB) — Proxy contracts
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Deploy Vault + InterestEngine + Release as ERC1967 proxies.
    ///         Automatically wires roles between contracts.
    /// @param cUsd cUSD token address
    /// @param maToken MA token address
    /// @param admin Admin address (gets DEFAULT_ADMIN_ROLE on all contracts)
    /// @param maPrice Initial MA price (6 decimals)
    function deployVaultChain(
        address cUsd,
        address maToken,
        address admin,
        uint256 maPrice
    ) external onlyOwner returns (address _vault, address _engine, address _release) {
        require(vaultImpl != address(0), "Implementations not set");
        require(vaultProxy == address(0), "Already deployed");

        // 1. Deploy Release proxy first (Vault needs its address)
        //    Initialize with placeholder engine (will update after engine deploy)
        bytes memory releaseInit = abi.encodeCall(
            ICoinMaxReleaseInit.initialize,
            (maToken, admin, address(0), serverWallet)
        );
        releaseProxy = address(new ERC1967Proxy(releaseImpl, releaseInit));

        // 2. Deploy Vault proxy
        //    Gateway will be set later via setGateway on vault
        bytes memory vaultInit = abi.encodeCall(
            ICoinMaxVaultInit.initialize,
            (cUsd, maToken, admin, address(0), address(0), maPrice)
        );
        vaultProxy = address(new ERC1967Proxy(vaultImpl, vaultInit));

        // 3. Deploy InterestEngine proxy
        bytes memory engineInit = abi.encodeCall(
            ICoinMaxEngineInit.initialize,
            (vaultProxy, maToken, releaseProxy, admin, serverWallet)
        );
        engineProxy = address(new ERC1967Proxy(engineImpl, engineInit));

        // 4. Wire roles: Engine needs ENGINE_ROLE on Vault, VAULT_ROLE on Release
        ICoinMaxRoles(vaultProxy).grantRole(keccak256("ENGINE_ROLE"), engineProxy);
        ICoinMaxRoles(releaseProxy).grantRole(keccak256("VAULT_ROLE"), engineProxy);

        _vault = vaultProxy;
        _engine = engineProxy;
        _release = releaseProxy;

        emit VaultChainDeployed(vaultProxy, engineProxy, releaseProxy);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  STEP 3: DEPLOY GATEWAY (per chain) — Clone contracts
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Deploy a Gateway clone for a specific chain.
    ///         On vault chain (ARB): wire to Vault directly.
    ///         On source chains: set bridge adapter separately.
    /// @param chainId Chain identifier for tracking
    /// @param isVaultChain true for ARB gateway
    /// @param usdt_ USDT on this chain
    /// @param usdc_ USDC on this chain
    /// @param dexRouter_ DEX router on this chain
    /// @param poolFee_ DEX pool fee
    /// @param treasury_ Treasury wallet on this chain
    /// @param admin_ Admin address
    function deployGatewayClone(
        uint32 chainId,
        bool isVaultChain,
        address usdt_,
        address usdc_,
        address dexRouter_,
        uint24 poolFee_,
        address treasury_,
        address admin_
    ) external onlyOwner returns (address gateway) {
        require(gatewayImpl != address(0), "Gateway impl not set");
        require(gatewayClones[chainId] == address(0), "Chain already deployed");

        // Deploy minimal clone
        gateway = gatewayImpl.clone();

        // Initialize
        ICoinMaxGatewayInit(gateway).initialize(
            isVaultChain,
            usdt_,
            usdc_,
            dexRouter_,
            poolFee_,
            treasury_,
            admin_,
            serverWallet
        );

        gatewayClones[chainId] = gateway;

        // If vault chain: wire Gateway → Vault (GATEWAY_ROLE)
        if (isVaultChain && vaultProxy != address(0)) {
            ICoinMaxRoles(vaultProxy).grantRole(keccak256("GATEWAY_ROLE"), gateway);
        }

        emit GatewayCloneDeployed(chainId, gateway);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setServerWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid");
        serverWallet = _wallet;
        emit ServerWalletUpdated(_wallet);
    }

    /// @notice Grant a role on a deployed contract (for manual wiring)
    function grantRoleOn(
        address target,
        bytes32 role,
        address account
    ) external onlyOwner {
        ICoinMaxRoles(target).grantRole(role, account);
    }

    /// @notice Revoke a role on a deployed contract
    function revokeRoleOn(
        address target,
        bytes32 role,
        address account
    ) external onlyOwner {
        ICoinMaxRoles(target).revokeRole(role, account);
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  INIT INTERFACES (for abi.encodeCall)
// ═══════════════════════════════════════════════════════════════════════

interface ICoinMaxVaultInit {
    function initialize(
        address cUsd,
        address maToken,
        address admin,
        address gateway,
        address engine,
        uint256 maPrice
    ) external;
}

interface ICoinMaxEngineInit {
    function initialize(
        address vault,
        address maToken,
        address releaseContract,
        address admin,
        address serverWallet
    ) external;
}

interface ICoinMaxReleaseInit {
    function initialize(
        address maToken,
        address admin,
        address engine,
        address serverWallet
    ) external;
}

interface ICoinMaxGatewayInit {
    function initialize(
        bool isVaultChain,
        address usdt,
        address usdc,
        address dexRouter,
        uint24 poolFee,
        address treasury,
        address admin,
        address serverWallet
    ) external;
}

interface ICoinMaxRoles {
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
}
