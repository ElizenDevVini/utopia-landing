// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title UtopiaToken (UTOP)
/// @notice Testnet stand-in for the utopia launch token. Land in utopia is
/// bought with UTOP. Anyone can pull 1,000 UTOP a day from the built-in
/// faucet; that exists only because this is a testnet.
contract UtopiaToken is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1000e18;
    mapping(address => uint256) public lastFaucet;

    error FaucetCooldown();

    constructor() ERC20("utopia", "UTOP") Ownable(msg.sender) {
        _mint(msg.sender, 10_000_000e18);
    }

    function faucet() external {
        uint256 last = lastFaucet[msg.sender];
        if (last != 0 && block.timestamp - last < 1 days) revert FaucetCooldown();
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
