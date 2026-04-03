// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CUSD is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public totalMinted;
    uint256 public totalBurned;

    constructor() ERC20("CoinMax USD", "cUSD") { _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) { _mint(to, amount); totalMinted += amount; }
    function burn(uint256 amount) external { _burn(msg.sender, amount); totalBurned += amount; }
    function burnFrom(address from, uint256 amount) external onlyRole(MINTER_ROLE) { _burn(from, amount); totalBurned += amount; }
    function decimals() public pure override returns (uint8) { return 18; }
}
