// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/AccessControl.sol";

interface IMAToken { function circulatingSupply() external view returns (uint256); }
interface ICUSD { function totalSupply() external view returns (uint256); }

contract MAPriceOracle is AccessControl {
    bytes32 public constant FEEDER_ROLE = keccak256("FEEDER_ROLE");
    IMAToken public maToken;
    ICUSD public cusd;
    uint256 public basePrice;
    uint256 public dailyRateBps;
    uint256 public genesisTime;
    uint256 public floorPrice;
    uint256 public manualPrice;
    uint256 public lastUpdated;

    event ConfigUpdated(string param);

    constructor(address _maToken, address _cusd, uint256 _basePrice, uint256 _dailyRateBps, uint256 _floorPrice) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        maToken = IMAToken(_maToken); cusd = ICUSD(_cusd);
        basePrice = _basePrice; dailyRateBps = _dailyRateBps; floorPrice = _floorPrice; genesisTime = block.timestamp;
    }

    function getPrice() external view returns (uint256) { return manualPrice > 0 ? manualPrice : _calc(); }

    function _calc() internal view returns (uint256) {
        uint256 c = maToken.circulatingSupply(); uint256 t = cusd.totalSupply();
        uint256 d = (block.timestamp - genesisTime) / 1 days;
        return _max(floorPrice, _max(_backing(t, c), _appr(d)));
    }
    function _backing(uint256 tc, uint256 cm) internal pure returns (uint256) { return cm == 0 ? 0 : (tc * 1e6) / cm; }
    function _appr(uint256 d) internal view returns (uint256) {
        uint256 p = basePrice; uint256 r = 10000 + dailyRateBps;
        for (uint256 i = 0; i < d && i < 365; i++) p = (p * r) / 10000;
        return p;
    }
    function _max(uint256 a, uint256 b) internal pure returns (uint256) { return a > b ? a : b; }

    function setManualPrice(uint256 _p) external onlyRole(FEEDER_ROLE) { manualPrice = _p; lastUpdated = block.timestamp; }
    function clearManualPrice() external onlyRole(FEEDER_ROLE) { manualPrice = 0; }
    function setFloorPrice(uint256 _f) external onlyRole(DEFAULT_ADMIN_ROLE) { floorPrice = _f; emit ConfigUpdated("floorPrice"); }
    function setDailyRate(uint256 _b) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_b <= 1000); dailyRateBps = _b; }
    function setBasePrice(uint256 _p) external onlyRole(DEFAULT_ADMIN_ROLE) { basePrice = _p; emit ConfigUpdated("basePrice"); }
    function setTokens(address _ma, address _cusd) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_ma != address(0)) maToken = IMAToken(_ma); if (_cusd != address(0)) cusd = ICUSD(_cusd);
    }
}
