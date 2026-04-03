// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title MA Price Oracle V4 — UUPS Upgradeable, with ceiling + daily cap
///
///  Price = clamp(floorPrice, ceilPrice, calculated)
///  calculated = max(backingPrice, appreciationPrice)
///  dailyCap: price cannot increase more than maxDailyIncreaseBps from lastPrice

interface IMAToken { function circulatingSupply() external view returns (uint256); }
interface ICUSD { function totalSupply() external view returns (uint256); }

contract MAPriceOracle is Initializable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant FEEDER_ROLE = keccak256("FEEDER_ROLE");

    IMAToken public maToken;
    ICUSD public cusd;

    uint256 public basePrice;           // 6 decimals ($1.00 = 1000000)
    uint256 public dailyRateBps;        // daily appreciation (10 = 0.10%)
    uint256 public genesisTime;

    uint256 public floorPrice;          // absolute minimum
    uint256 public ceilPrice;           // absolute maximum
    uint256 public maxDailyIncreaseBps; // max daily increase (50 = 0.50%)

    uint256 public lastPrice;           // last settled price
    uint256 public lastPriceTime;       // last price update timestamp

    uint256 public manualPrice;         // override (0 = use formula)
    uint256 public lastUpdated;

    event ConfigUpdated(string param);
    event PriceSettled(uint256 price, uint256 timestamp);

    function initialize(
        address _maToken,
        address _cusd,
        uint256 _basePrice,
        uint256 _dailyRateBps,
        uint256 _floorPrice,
        uint256 _ceilPrice,
        uint256 _maxDailyIncreaseBps
    ) public initializer {
        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        maToken = IMAToken(_maToken);
        cusd = ICUSD(_cusd);
        basePrice = _basePrice;
        dailyRateBps = _dailyRateBps;
        floorPrice = _floorPrice;
        ceilPrice = _ceilPrice;
        maxDailyIncreaseBps = _maxDailyIncreaseBps;
        genesisTime = block.timestamp;
        lastPrice = _basePrice;
        lastPriceTime = block.timestamp;
    }

    /// @notice Get current MA price (6 decimals)
    function getPrice() external view returns (uint256) {
        if (manualPrice > 0) return manualPrice;
        return _clampedPrice();
    }

    function _clampedPrice() internal view returns (uint256) {
        uint256 raw = _rawPrice();

        // Apply daily cap: cannot exceed lastPrice + maxDailyIncrease
        if (maxDailyIncreaseBps > 0 && lastPrice > 0) {
            uint256 daysSinceLast = (block.timestamp - lastPriceTime) / 1 days;
            if (daysSinceLast == 0) daysSinceLast = 1;
            uint256 maxPrice = lastPrice;
            for (uint256 i = 0; i < daysSinceLast && i < 30; i++) {
                maxPrice = (maxPrice * (10000 + maxDailyIncreaseBps)) / 10000;
            }
            if (raw > maxPrice) raw = maxPrice;
        }

        // Clamp between floor and ceil
        if (raw < floorPrice) return floorPrice;
        if (ceilPrice > 0 && raw > ceilPrice) return ceilPrice;
        return raw;
    }

    function _rawPrice() internal view returns (uint256) {
        uint256 c = maToken.circulatingSupply();
        uint256 t = cusd.totalSupply();
        uint256 d = (block.timestamp - genesisTime) / 1 days;
        uint256 backing = c == 0 ? 0 : (t * 1e6) / c;
        uint256 appreciation = _appr(d);
        return backing > appreciation ? backing : appreciation;
    }

    function _appr(uint256 d) internal view returns (uint256) {
        uint256 p = basePrice;
        uint256 r = 10000 + dailyRateBps;
        for (uint256 i = 0; i < d && i < 365; i++) {
            p = (p * r) / 10000;
        }
        return p;
    }

    /// @notice Engine calls daily to settle price (updates lastPrice for daily cap)
    function settlePrice() external onlyRole(FEEDER_ROLE) {
        uint256 price = _clampedPrice();
        lastPrice = price;
        lastPriceTime = block.timestamp;
        emit PriceSettled(price, block.timestamp);
    }

    /// @notice Get price breakdown
    function getPriceDetails() external view returns (
        uint256 price, uint256 rawPrice, uint256 backingPrice,
        uint256 appreciationPrice, uint256 dailyCap, uint256 floor, uint256 ceil
    ) {
        uint256 c = maToken.circulatingSupply();
        uint256 t = cusd.totalSupply();
        uint256 d = (block.timestamp - genesisTime) / 1 days;
        backingPrice = c == 0 ? 0 : (t * 1e6) / c;
        appreciationPrice = _appr(d);
        rawPrice = backingPrice > appreciationPrice ? backingPrice : appreciationPrice;
        price = manualPrice > 0 ? manualPrice : _clampedPrice();
        dailyCap = maxDailyIncreaseBps;
        floor = floorPrice;
        ceil = ceilPrice;
    }

    // ─── Admin ───────────────────────────────────────────────

    function setManualPrice(uint256 _p) external onlyRole(FEEDER_ROLE) { manualPrice = _p; lastUpdated = block.timestamp; }
    function clearManualPrice() external onlyRole(FEEDER_ROLE) { manualPrice = 0; }
    function setFloorPrice(uint256 _f) external onlyRole(DEFAULT_ADMIN_ROLE) { floorPrice = _f; emit ConfigUpdated("floorPrice"); }
    function setCeilPrice(uint256 _c) external onlyRole(DEFAULT_ADMIN_ROLE) { ceilPrice = _c; emit ConfigUpdated("ceilPrice"); }
    function setMaxDailyIncrease(uint256 _bps) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_bps <= 1000); maxDailyIncreaseBps = _bps; emit ConfigUpdated("maxDailyIncrease"); }
    function setDailyRate(uint256 _b) external onlyRole(DEFAULT_ADMIN_ROLE) { require(_b <= 1000); dailyRateBps = _b; }
    function setBasePrice(uint256 _p) external onlyRole(DEFAULT_ADMIN_ROLE) { basePrice = _p; emit ConfigUpdated("basePrice"); }
    function setLastPrice(uint256 _p) external onlyRole(DEFAULT_ADMIN_ROLE) { lastPrice = _p; lastPriceTime = block.timestamp; }
    function setTokens(address _ma, address _cusd) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_ma != address(0)) maToken = IMAToken(_ma);
        if (_cusd != address(0)) cusd = ICUSD(_cusd);
    }
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {} // placeholder for future
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
