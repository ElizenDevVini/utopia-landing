// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UtopiaLandMainnet} from "./UtopiaLandMainnet.sol";

/// @title UtopiaBoost
/// @notice Plot-specific Utopia locks backed by finite reserves of additional
/// Robinhood Stock Token rewards.
/// @dev Rewards accrue to a per-plot pot and are claimable by the current land
/// owner at claim time. Selling a plot hands all unclaimed boost to the buyer,
/// while locked principal always belongs to the staker. Exact time attribution
/// across land transfers is intentionally out of scope. Every future and accrued
/// reward remains reserved against this contract's stock balances.
contract UtopiaBoost is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_BOOST_WAD = 3e18;
    uint256 public constant MAX_BATCH = 64;
    uint256 public constant MIN_BOOST_DURATION = 30 days;

    struct Position {
        address staker;
        uint64 lastCheckpoint;
        uint256 locked;
        uint256 accrued;
        uint256 commitment;
    }

    UtopiaLandMainnet public immutable land;
    IERC20 public immutable utopia;
    uint256 public immutable halfSaturation;
    uint64 public immutable boostEnd;
    IERC20[5] public tokens;

    mapping(uint256 => Position) private _positions;
    uint256[5] public totalCommittedByToken;
    uint256[5] public totalOwedByToken;

    event Staked(
        uint256 indexed id, address indexed staker, uint256 amountReceived, uint256 newLocked, uint256 newFactorWad
    );
    event Unstaked(uint256 indexed id, address indexed staker, uint256 amount, uint256 newLocked, uint256 newFactorWad);
    event Evicted(uint256 indexed id, address indexed staker, uint256 amount);
    event BoostClaimed(uint256 indexed id, address indexed owner, address token, uint256 amount);
    event SurplusStockWithdrawn(address indexed token, address indexed to, uint256 amount);

    error InvalidConfig();
    error ZeroAmount();
    error InvalidAmount();
    error NotPlotOwner();
    error PositionOccupied();
    error PositionNotEvictable();
    error NotStaker();
    error NotEligible();
    error ProgramEnded();
    error InsufficientReserve(uint256 tokenIndex, uint256 required, uint256 available);
    error InsufficientSurplus();
    error BatchTooLarge();

    constructor(
        UtopiaLandMainnet land_,
        IERC20 utopia_,
        uint256 halfSaturation_,
        uint64 boostEnd_,
        address initialOwner
    ) Ownable(initialOwner) {
        address landAddress = address(land_);
        address utopiaAddress = address(utopia_);
        if (
            landAddress == address(0) || landAddress.code.length == 0 || utopiaAddress == address(0)
                || utopiaAddress.code.length == 0 || halfSaturation_ == 0
        ) revert InvalidConfig();
        if (boostEnd_ < block.timestamp + MIN_BOOST_DURATION || boostEnd_ > land_.rewardEnd()) {
            revert InvalidConfig();
        }

        land = land_;
        utopia = utopia_;
        halfSaturation = halfSaturation_;
        boostEnd = boostEnd_;
        for (uint256 i = 0; i < 5; i++) {
            IERC20 token = land_.tokens(i);
            if (address(token) == utopiaAddress) revert InvalidConfig();
            tokens[i] = token;
        }
    }

    /// @notice Returns the incremental boost factor for a principal amount in WAD units.
    function previewFactorWad(uint256 locked) public view returns (uint256) {
        return Math.mulDiv(MAX_BOOST_WAD, locked, locked + halfSaturation);
    }

    /// @notice Mirrors the land contract's base reward calculation for a time interval.
    function baseRewardBetween(uint256 id, uint256 start, uint256 end) public view returns (uint256) {
        if (end <= start) return 0;
        uint256 annualizedEth = Math.mulDiv(land.priceOf(id), land.apyBpsOf(id) * (end - start), BPS * YEAR);
        return Math.mulDiv(annualizedEth, land.tokensPerEthWad(land.tokenIndexOf(id)), WAD);
    }

    /// @notice Returns stock not reserved for either future or accrued plot rewards.
    function reserveAvailable(uint256 tokenIndex) public view returns (uint256) {
        if (tokenIndex >= 5) revert InvalidConfig();
        uint256 balance = tokens[tokenIndex].balanceOf(address(this));
        uint256 committed = totalCommittedByToken[tokenIndex];
        if (balance <= committed) return 0;
        uint256 afterCommitments = balance - committed;
        uint256 owed = totalOwedByToken[tokenIndex];
        return afterCommitments > owed ? afterCommitments - owed : 0;
    }

    function stake(uint256 id, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (land.ownerOf(id) != msg.sender) revert NotPlotOwner();
        Position storage position = _positions[id];
        if (position.staker != address(0) && position.staker != msg.sender) revert PositionOccupied();
        if (block.timestamp >= boostEnd) revert ProgramEnded();

        _checkpoint(id, position);
        uint256 balanceBefore = utopia.balanceOf(address(this));
        utopia.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = utopia.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert ZeroAmount();

        uint256 newLocked = position.locked + received;
        uint256 newFactorWad = previewFactorWad(newLocked);
        uint256 newCommitment = _remainingCommitment(id, newFactorWad);
        uint256 idx = land.tokenIndexOf(id);
        if (newCommitment > position.commitment) {
            uint256 increase = newCommitment - position.commitment;
            uint256 available = reserveAvailable(idx);
            if (available < increase) revert InsufficientReserve(idx, increase, available);
            totalCommittedByToken[idx] += increase;
        } else {
            totalCommittedByToken[idx] -= position.commitment - newCommitment;
        }

        position.staker = msg.sender;
        position.locked = newLocked;
        position.commitment = newCommitment;
        emit Staked(id, msg.sender, received, newLocked, newFactorWad);
    }

    function unstake(uint256 id, uint256 amount) external nonReentrant {
        Position storage position = _positions[id];
        if (position.staker != msg.sender) revert NotStaker();
        if (amount == 0 || amount > position.locked) revert InvalidAmount();

        _checkpoint(id, position);
        uint256 newLocked = position.locked - amount;
        uint256 newFactorWad = previewFactorWad(newLocked);
        uint256 newCommitment = _remainingCommitment(id, newFactorWad);
        uint256 idx = land.tokenIndexOf(id);
        totalCommittedByToken[idx] -= position.commitment - newCommitment;

        position.locked = newLocked;
        position.commitment = newCommitment;
        if (newLocked == 0) position.staker = address(0);
        utopia.safeTransfer(msg.sender, amount);
        emit Unstaked(id, msg.sender, amount, newLocked, newFactorWad);
    }

    /// @notice Returns an old owner's principal after a plot sale and frees the
    /// plot for the current owner. Rewards earned by that stake remain with the plot.
    function evict(uint256 id) external nonReentrant {
        if (land.ownerOf(id) != msg.sender) revert NotPlotOwner();
        Position storage position = _positions[id];
        address staker = position.staker;
        if (staker == address(0) || staker == msg.sender) revert PositionNotEvictable();

        _checkpoint(id, position);
        uint256 amount = position.locked;
        uint256 idx = land.tokenIndexOf(id);
        totalCommittedByToken[idx] -= position.commitment;
        position.staker = address(0);
        position.locked = 0;
        position.commitment = 0;
        utopia.safeTransfer(staker, amount);
        emit Evicted(id, staker, amount);
    }

    function claimBoost(uint256 id) external nonReentrant {
        _claimBoost(id);
    }

    function claimBoostMany(uint256[] calldata ids) external nonReentrant {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < ids.length; i++) {
            _claimBoost(ids[i]);
        }
    }

    function _claimBoost(uint256 id) internal {
        address plotOwner = land.ownerOf(id);
        if (plotOwner != msg.sender) revert NotPlotOwner();
        if (!land.isEligible(msg.sender)) revert NotEligible();

        Position storage position = _positions[id];
        _checkpoint(id, position);
        uint256 amount = position.accrued;
        uint256 idx = land.tokenIndexOf(id);
        position.accrued = 0;
        totalOwedByToken[idx] -= amount;
        if (amount > 0) tokens[idx].safeTransfer(msg.sender, amount);
        emit BoostClaimed(id, msg.sender, address(tokens[idx]), amount);
    }

    /// @notice Returns position state plus rewards pending since its last checkpoint.
    function positionOf(uint256 id)
        external
        view
        returns (address staker, uint256 locked, uint256 factorWad, uint256 pendingAccrued, uint256 commitment)
    {
        Position storage position = _positions[id];
        staker = position.staker;
        locked = position.locked;
        factorWad = previewFactorWad(locked);
        pendingAccrued = position.accrued;
        commitment = position.commitment;
        uint64 end = _checkpointEnd();
        if (locked != 0 && position.lastCheckpoint < end) {
            pendingAccrued += commitment - _remainingCommitment(id, factorWad);
        }
    }

    function withdrawSurplusStock(uint256 tokenIndex, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0) || tokenIndex >= 5) revert InvalidConfig();
        if (amount > reserveAvailable(tokenIndex)) revert InsufficientSurplus();
        tokens[tokenIndex].safeTransfer(to, amount);
        emit SurplusStockWithdrawn(address(tokens[tokenIndex]), to, amount);
    }

    /// @dev Moves elapsed rewards from future commitment to the plot's claimable pot.
    function _checkpoint(uint256 id, Position storage position) internal {
        uint64 end = _checkpointEnd();
        if (position.lastCheckpoint >= end) return;
        if (position.locked == 0) {
            position.lastCheckpoint = end;
            return;
        }

        uint256 newCommitment = _remainingCommitment(id, previewFactorWad(position.locked));
        uint256 amount = position.commitment - newCommitment;
        uint256 idx = land.tokenIndexOf(id);
        position.accrued += amount;
        position.commitment = newCommitment;
        totalCommittedByToken[idx] -= amount;
        totalOwedByToken[idx] += amount;
        position.lastCheckpoint = end;
    }

    /// @dev Quotes the fully backed future obligation at the current timestamp.
    function _remainingCommitment(uint256 id, uint256 factorWad) internal view returns (uint256) {
        if (block.timestamp >= boostEnd || factorWad == 0) return 0;
        return Math.mulDiv(baseRewardBetween(id, block.timestamp, boostEnd), factorWad, WAD);
    }

    function _checkpointEnd() internal view returns (uint64) {
        return block.timestamp < boostEnd ? uint64(block.timestamp) : boostEnd;
    }
}
