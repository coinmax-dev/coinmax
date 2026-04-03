// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title Node NFT — On-chain node membership proof
/// @notice Engine mints NFT when user purchases node.
///         NFT represents node ownership. Yield activation requires vault deposit (DB check).
///
///  Flow:
///    1. User pays USDT → swap USDC → Server
///    2. Engine mints NodeNFT to user (on-chain proof)
///    3. Engine creates cUSD position in Vault (leverage)
///    4. DB checks: user has vault deposit ≥ threshold → activate node yield
///    5. Daily: Engine mints MA yield → Release (待释放)
///
///  NFT is non-transferable (soulbound) — node belongs to the wallet

contract NodeNFT is
    Initializable,
    ERC721Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant ENGINE_ROLE = keccak256("ENGINE_ROLE");

    struct NodeInfo {
        string nodeType;          // "MAX" or "MINI"
        uint256 contributionUSDC; // actual payment
        uint256 cusdLeverage;     // cUSD minted (10× leverage)
        uint256 vaultPositionId;  // linked VaultV4 position
        uint256 mintTime;
        bool active;
    }

    mapping(uint256 => NodeInfo) public nodes;
    uint256 public nextTokenId;
    uint256 public totalMax;
    uint256 public totalMini;

    // Node config
    mapping(string => uint256) public nodePrices;       // "MAX" → 600e18, "MINI" → 100e18
    mapping(string => uint256) public nodeLeverage;     // "MAX" → 1000, "MINI" → 1000 (10×)
    mapping(string => uint256) public nodeDurations;    // "MAX" → 120 days, "MINI" → 90 days

    event NodeMinted(uint256 indexed tokenId, address indexed user, string nodeType, uint256 contribution, uint256 cusdLeverage);
    event NodeDeactivated(uint256 indexed tokenId);

    function initialize() public initializer {
        __ERC721_init("CoinMax Node", "cmNODE");
        __AccessControl_init();
        __Pausable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Default config
        nodePrices["MAX"] = 600e18;
        nodePrices["MINI"] = 100e18;
        nodeLeverage["MAX"] = 1000;   // 10×
        nodeLeverage["MINI"] = 1000;  // 10×
        nodeDurations["MAX"] = 120 days;
        nodeDurations["MINI"] = 90 days;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE: Mint node NFT
    // ═══════════════════════════════════════════════════════════

    /// @notice Engine mints node NFT to user after USDC payment received
    /// @param user            User wallet
    /// @param nodeType        "MAX" or "MINI"
    /// @param vaultPositionId Linked VaultV4 cUSD position ID
    /// @return tokenId        The minted NFT token ID
    function mintNode(
        address user,
        string calldata nodeType,
        uint256 vaultPositionId
    ) external onlyRole(ENGINE_ROLE) whenNotPaused returns (uint256 tokenId) {
        require(user != address(0), "Zero address");
        require(nodePrices[nodeType] > 0, "Invalid node type");

        tokenId = nextTokenId++;
        uint256 contribution = nodePrices[nodeType];
        uint256 leverage = contribution * nodeLeverage[nodeType] / 100;

        nodes[tokenId] = NodeInfo(
            nodeType,
            contribution,
            leverage,
            vaultPositionId,
            block.timestamp,
            true
        );

        _safeMint(user, tokenId);

        if (_eq(nodeType, "MAX")) totalMax++;
        else totalMini++;

        emit NodeMinted(tokenId, user, nodeType, contribution, leverage);
    }

    /// @notice Batch mint nodes
    function batchMintNodes(
        address[] calldata users,
        string[] calldata nodeTypes,
        uint256[] calldata vaultPositionIds
    ) external onlyRole(ENGINE_ROLE) whenNotPaused {
        require(users.length == nodeTypes.length && users.length == vaultPositionIds.length, "Mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0)) continue;
            require(nodePrices[nodeTypes[i]] > 0, "Invalid node type");

            uint256 tokenId = nextTokenId++;
            uint256 contribution = nodePrices[nodeTypes[i]];
            uint256 leverage = contribution * nodeLeverage[nodeTypes[i]] / 100;

            nodes[tokenId] = NodeInfo(
                nodeTypes[i], contribution, leverage,
                vaultPositionIds[i], block.timestamp, true
            );
            _safeMint(users[i], tokenId);

            if (_eq(nodeTypes[i], "MAX")) totalMax++;
            else totalMini++;

            emit NodeMinted(tokenId, users[i], nodeTypes[i], contribution, leverage);
        }
    }

    /// @notice Deactivate node (expired/terminated)
    function deactivateNode(uint256 tokenId) external onlyRole(ENGINE_ROLE) {
        require(nodes[tokenId].active, "Not active");
        nodes[tokenId].active = false;
        emit NodeDeactivated(tokenId);
    }

    // ═══════════════════════════════════════════════════════════
    //  Soulbound: Non-transferable
    // ═══════════════════════════════════════════════════════════

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow mint (from=0) and burn (to=0), block transfers
        require(from == address(0) || to == address(0), "Soulbound: non-transferable");
        return super._update(to, tokenId, auth);
    }

    // ─── View ────────────────────────────────────────────────

    function getNode(uint256 tokenId) external view returns (NodeInfo memory) {
        return nodes[tokenId];
    }

    function getUserNodes(address user) external view returns (uint256[] memory tokenIds, NodeInfo[] memory infos) {
        uint256 balance = balanceOf(user);
        tokenIds = new uint256[](balance);
        infos = new NodeInfo[](balance);
        uint256 idx = 0;
        for (uint256 i = 0; i < nextTokenId && idx < balance; i++) {
            if (_ownerOf(i) == user) {
                tokenIds[idx] = i;
                infos[idx] = nodes[i];
                idx++;
            }
        }
    }

    function getStats() external view returns (uint256 total, uint256 maxCount, uint256 miniCount) {
        return (nextTokenId, totalMax, totalMini);
    }

    // ─── Admin ───────────────────────────────────────────────

    function setNodePrice(string calldata nodeType, uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nodePrices[nodeType] = price;
    }

    function setNodeLeverage(string calldata nodeType, uint256 lev) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nodeLeverage[nodeType] = lev;
    }

    function setNodeDuration(string calldata nodeType, uint256 dur) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nodeDurations[nodeType] = dur;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Upgradeable, AccessControlUpgradeable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
