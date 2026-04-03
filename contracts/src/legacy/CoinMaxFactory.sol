// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title CoinMax Factory — Deploy + manage all contracts
/// @notice Owner = deployer EOA (NEVER relayer/server wallet)
/// @dev All child contracts' ADMIN → deployer. Server Wallet only gets MINTER/ENGINE/OPERATOR.
contract CoinMaxFactory is Ownable {

    // ═══ Registry ═══
    address public vault;
    address public oracle;
    address public engine;
    address public release;
    address public flashSwap;
    address public batchBridge;
    address public maToken;
    address public cusd;

    // ═══ Implementations ═══
    address public vaultImpl;
    address public oracleImpl;
    address public engineImpl;
    address public releaseImpl;
    address public flashSwapImpl;

    address public serverWallet;

    event Deployed(string name, address proxy, address impl);
    event Upgraded(string name, address proxy, address newImpl);
    event RolesSet(address by);

    constructor(address _serverWallet) Ownable(msg.sender) {
        require(_serverWallet != address(0));
        serverWallet = _serverWallet;
    }

    // ═══ DEPLOY ═══

    function deployMAToken(address impl) external onlyOwner {
        require(maToken == address(0));
        maToken = _proxy(impl, abi.encodeWithSignature("initialize(string,string,address)", "MA Token", "MA", address(this)));
        emit Deployed("MA", maToken, impl);
    }

    function deployCUSD(address impl) external onlyOwner {
        require(cusd == address(0));
        cusd = _proxy(impl, abi.encodeWithSignature("initialize(string,string,address)", "cUSD", "cUSD", address(this)));
        emit Deployed("cUSD", cusd, impl);
    }

    function deployOracle(address impl, uint256 price, uint256 heartbeat, uint256 maxChange) external onlyOwner {
        require(oracle == address(0));
        oracleImpl = impl;
        oracle = _proxy(impl, abi.encodeWithSignature("initialize(uint256,uint256,uint256,address)", price, heartbeat, maxChange, address(this)));
        emit Deployed("Oracle", oracle, impl);
    }

    function deployVault(address impl) external onlyOwner {
        require(vault == address(0) && cusd != address(0) && maToken != address(0) && oracle != address(0));
        vaultImpl = impl;
        vault = _proxy(impl, abi.encodeWithSignature("initialize(address,address,address,address)", cusd, maToken, oracle, msg.sender));
        emit Deployed("Vault", vault, impl);
    }

    function deployRelease(address impl) external onlyOwner {
        require(release == address(0) && maToken != address(0));
        releaseImpl = impl;
        release = _proxy(impl, abi.encodeWithSignature("initialize(address,address)", maToken, msg.sender));
        emit Deployed("Release", release, impl);
    }

    function deployEngine(address impl) external onlyOwner {
        require(engine == address(0) && vault != address(0));
        engineImpl = impl;
        engine = _proxy(impl, abi.encodeWithSignature("initialize(address,address,address,address,address)", vault, maToken, oracle, release, msg.sender));
        emit Deployed("Engine", engine, impl);
    }

    function deployFlashSwap(address impl, address usdt, address usdc, bytes32 salt) external onlyOwner {
        require(flashSwap == address(0) && maToken != address(0) && oracle != address(0));
        flashSwapImpl = impl;
        bytes memory init = abi.encodeWithSignature("initialize(address,address,address,address,address)", maToken, usdt, usdc, oracle, msg.sender);
        bytes memory code = abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(impl, init));
        address proxy;
        assembly { proxy := create2(0, add(code, 0x20), mload(code), salt) }
        require(proxy != address(0), "CREATE2 failed");
        flashSwap = proxy;
        emit Deployed("FlashSwap", flashSwap, impl);
    }

    function registerBatchBridge(address _bb) external onlyOwner { batchBridge = _bb; }

    // ═══ SETUP ROLES (one-click) ═══

    bytes32 constant MINTER = keccak256("MINTER_ROLE");
    bytes32 constant ENGINE_R = keccak256("ENGINE_ROLE");
    bytes32 constant ADMIN = 0x00;

    function setupRoles() external onlyOwner {
        // Vault → MA MINTER + cUSD MINTER
        _grant(maToken, MINTER, vault);
        if (cusd != address(0)) _grant(cusd, MINTER, vault);
        // Engine → MA MINTER
        if (engine != address(0)) _grant(maToken, MINTER, engine);
        // Server Wallet → operational roles only (NEVER admin)
        _grant(maToken, MINTER, serverWallet);
        if (release != address(0)) _grant(release, ADMIN, serverWallet);
        if (vault != address(0)) _grant(vault, ENGINE_R, serverWallet);
        // Deployer → ADMIN on all
        address d = msg.sender;
        _grant(maToken, ADMIN, d);
        if (cusd != address(0)) _grant(cusd, ADMIN, d);
        if (oracle != address(0)) _grant(oracle, ADMIN, d);
        if (vault != address(0)) _grant(vault, ADMIN, d);
        if (engine != address(0)) _grant(engine, ADMIN, d);
        if (release != address(0)) _grant(release, ADMIN, d);
        if (flashSwap != address(0)) _grant(flashSwap, ADMIN, d);
        emit RolesSet(d);
    }

    // ═══ UPGRADE ═══

    function upgradeVault(address impl) external onlyOwner { _up(vault, impl); vaultImpl = impl; emit Upgraded("Vault", vault, impl); }
    function upgradeOracle(address impl) external onlyOwner { _up(oracle, impl); oracleImpl = impl; emit Upgraded("Oracle", oracle, impl); }
    function upgradeEngine(address impl) external onlyOwner { _up(engine, impl); engineImpl = impl; emit Upgraded("Engine", engine, impl); }
    function upgradeRelease(address impl) external onlyOwner { _up(release, impl); releaseImpl = impl; emit Upgraded("Release", release, impl); }
    function upgradeFlashSwap(address impl) external onlyOwner { _up(flashSwap, impl); flashSwapImpl = impl; emit Upgraded("FlashSwap", flashSwap, impl); }

    // ═══ CONFIG ═══

    function setServerWallet(address _sw) external onlyOwner { serverWallet = _sw; }
    function setVaultDistributor(address _fd) external onlyOwner { _call(vault, abi.encodeWithSignature("setFundDistributor(address)", _fd)); }
    function setOraclePrice(uint256 p) external onlyOwner { _call(oracle, abi.encodeWithSignature("updatePrice(uint256)", p)); }
    function pause(address t) external onlyOwner { _call(t, abi.encodeWithSignature("pause()")); }
    function unpause(address t) external onlyOwner { _call(t, abi.encodeWithSignature("unpause()")); }

    // ═══ INTERNAL ═══

    function _proxy(address impl, bytes memory init) internal returns (address) { return address(new ERC1967Proxy(impl, init)); }
    function _grant(address t, bytes32 r, address a) internal { _call(t, abi.encodeWithSignature("grantRole(bytes32,address)", r, a)); }
    function _up(address p, address impl) internal { _call(p, abi.encodeWithSignature("upgradeToAndCall(address,bytes)", impl, "")); }
    function _call(address t, bytes memory d) internal { (bool ok,) = t.call(d); require(ok); }
}
