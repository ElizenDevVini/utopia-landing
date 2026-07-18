// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IUtopiaEligibility {
    function isEligible(address account) external view returns (bool);
}

/// @title UtopiaEligibility
/// @notice Onchain result of the operator's offchain eligibility process.
/// @dev The owner must be the disclosed compliance multisig. This contract does
/// not perform KYC; it only records the expiry chosen by that authority.
contract UtopiaEligibility is IUtopiaEligibility, Ownable2Step {
    uint256 public constant MAX_BATCH = 200;

    mapping(address => uint64) public eligibleUntil;

    event EligibilitySet(address indexed account, uint64 eligibleUntil);

    error InvalidAccount();
    error BatchTooLarge();
    error LengthMismatch();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function isEligible(address account) external view returns (bool) {
        return account != address(0) && eligibleUntil[account] >= block.timestamp;
    }

    function setEligibility(address account, uint64 until) external onlyOwner {
        _setEligibility(account, until);
    }

    function setEligibilityMany(address[] calldata accounts, uint64[] calldata expiries) external onlyOwner {
        if (accounts.length != expiries.length) revert LengthMismatch();
        if (accounts.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < accounts.length; i++) {
            _setEligibility(accounts[i], expiries[i]);
        }
    }

    function _setEligibility(address account, uint64 until) internal {
        if (account == address(0)) revert InvalidAccount();
        eligibleUntil[account] = until;
        emit EligibilitySet(account, until);
    }
}
