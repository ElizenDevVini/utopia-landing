// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IUtopiaEligibility} from "./UtopiaEligibility.sol";

/// @title UtopiaLandMainnet
/// @notice Production land deeds bought with ETH and backed by finite,
/// pre-reserved Robinhood Stock Token rewards.
/// @dev Every purchase, deed transfer, and reward claim is eligibility-gated.
/// Reward rates and the program deadline are immutable. Stock Token funds that
/// are committed to sold plots cannot be withdrawn by the owner.
interface ILandOwners {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract UtopiaLandCity is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SIDE = 32;
    uint256 public constant PLOTS = 1024;
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_RATE = 1_000e18;
    uint256 public constant MAX_BATCH = 64;
    uint256 public constant MIN_REWARD_DURATION = 30 days;
    uint256 public constant MAX_REWARD_DURATION = 730 days;

    // 5 = district mode (stock by region); 0..4 = every plot pays that one stock
    uint256 public constant DISTRICT_MODE = 5;

    IERC20[5] public tokens;
    uint256[5] public tokensPerEthWad;
    IUtopiaEligibility public immutable eligibilityRegistry;
    uint64 public immutable rewardEnd;
    uint256 public immutable rewardMode;

    mapping(uint256 => uint64) public lastClaim;
    mapping(uint256 => uint256) public reserveCommitment;
    uint256[5] public totalCommittedByToken;
    // Kept for the common dashboard interface. This contract fails closed
    // instead of creating unbacked debt, so every value remains zero.
    uint256[5] public totalOwedByToken;

    uint256[4] private _ownershipBits;
    mapping(address => uint256[4]) private _ownerBits;

    event Bought(uint256 indexed id, address indexed buyer, uint256 price, uint256 rewardReserved);
    event Claimed(uint256 indexed id, address indexed to, address token, uint256 paid, uint256 stillOwed);
    event EthWithdrawn(address indexed to, uint256 amount);
    event SurplusStockWithdrawn(address indexed token, address indexed to, uint256 amount);
    event Migrated(uint256 indexed id, address indexed to);

    error InvalidConfig();
    error InvalidPlot();
    error WrongPayment();
    error NotPlotOwner();
    error NotMinted();
    error NotEligible();
    error ProgramEnded();
    error InsufficientReserve(uint256 tokenIndex, uint256 required, uint256 available);
    error InsufficientSurplus();
    error BatchTooLarge();
    error EthTransferFailed();

    constructor(
        IERC20[5] memory tokens_,
        uint256[5] memory rates_,
        IUtopiaEligibility eligibilityRegistry_,
        uint64 rewardEnd_,
        address initialOwner,
        uint256 rewardMode_
    ) ERC721("utopia land", "PLOT") Ownable(initialOwner) {
        if (rewardMode_ > DISTRICT_MODE) revert InvalidConfig();
        rewardMode = rewardMode_;
        if (address(eligibilityRegistry_) == address(0)) revert InvalidConfig();
        if (rewardEnd_ < block.timestamp + MIN_REWARD_DURATION || rewardEnd_ > block.timestamp + MAX_REWARD_DURATION) {
            revert InvalidConfig();
        }

        for (uint256 i = 0; i < 5; i++) {
            address token = address(tokens_[i]);
            if (token == address(0) || token.code.length == 0 || rates_[i] == 0 || rates_[i] > MAX_RATE) {
                revert InvalidConfig();
            }
            if (IERC20Metadata(token).decimals() != 18) revert InvalidConfig();
            for (uint256 j = 0; j < i; j++) {
                if (token == address(tokens_[j])) revert InvalidConfig();
            }
        }

        tokens = tokens_;
        tokensPerEthWad = rates_;
        eligibilityRegistry = eligibilityRegistry_;
        rewardEnd = rewardEnd_;
    }

    // ---- plot attributes ----

    function priceOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        uint256 x = id % SIDE;
        uint256 y = id / SIDE;
        uint256 r = uint256(keccak256(abi.encodePacked("utopia/price/v1", id)));
        uint256 base = 0.0005 ether + (r % 0.002 ether);
        uint256 premium = (0.0025 ether * 300) / (300 + x * x + y * y);
        uint256 raw = base + premium;
        return raw - (raw % 1e13);
    }

    /// @notice Reference reward rate, not an investment APY or return promise.
    function apyBpsOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return 310 + (uint256(keccak256(abi.encodePacked("utopia/apy/v1", id))) % 271);
    }

    /// @notice Reward stock for a plot. In uniform mode (rewardMode 0..4) every
    /// plot pays that one stock. In district mode a center circle plus four
    /// quarters map to the five stocks; tokens = [TSLA, AAPL, NVDA, MSFT, AMZN],
    /// silicon heights (center) = NVDA.
    function tokenIndexOf(uint256 id) public view returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        if (rewardMode != DISTRICT_MODE) return rewardMode;
        int256 dx = 2 * int256(id % SIDE) - 31; // 2*(x - 15.5)
        int256 dy = 2 * int256(id / SIDE) - 31; // 2*(y - 15.5)
        if (dx * dx + dy * dy < 256) return 2; // center circle (r<8) -> NVDA
        if (dx < 0 && dy < 0) return 0; // upper-left  -> TSLA
        if (dx >= 0 && dy < 0) return 1; // upper-right -> AAPL
        if (dx < 0 && dy >= 0) return 3; // lower-left  -> MSFT
        return 4; // lower-right -> AMZN
    }

    function isEligible(address account) public view returns (bool) {
        try eligibilityRegistry.isEligible(account) returns (bool eligible) {
            return eligible;
        } catch {
            return false;
        }
    }

    // ---- finite reserve accounting ----

    function _rewardBetween(uint256 id, uint256 start, uint256 end) internal view returns (uint256) {
        if (end <= start) return 0;
        uint256 annualizedEth = Math.mulDiv(priceOf(id), apyBpsOf(id) * (end - start), BPS * YEAR);
        return Math.mulDiv(annualizedEth, tokensPerEthWad[tokenIndexOf(id)], WAD);
    }

    function maxRewardForSale(uint256 id) public view returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        if (block.timestamp >= rewardEnd) return 0;
        return _rewardBetween(id, block.timestamp, rewardEnd);
    }

    function reserveAvailable(uint256 tokenIndex) public view returns (uint256) {
        if (tokenIndex >= 5) revert InvalidConfig();
        uint256 balance = tokens[tokenIndex].balanceOf(address(this));
        uint256 committed = totalCommittedByToken[tokenIndex];
        return balance > committed ? balance - committed : 0;
    }

    /// @notice Additional reserves needed to make every currently open plot
    /// purchasable at this timestamp. Useful for the release preflight.
    function reserveRequiredForAllOpenPlots() external view returns (uint256[5] memory out) {
        if (block.timestamp >= rewardEnd) return out;
        for (uint256 id = 0; id < PLOTS; id++) {
            if (_ownerOf(id) == address(0)) out[tokenIndexOf(id)] += maxRewardForSale(id);
        }
    }

    // ---- buy / claim ----

    function buy(uint256 id) external payable nonReentrant {
        if (block.timestamp >= rewardEnd) revert ProgramEnded();
        if (!isEligible(msg.sender)) revert NotEligible();
        uint256 price = priceOf(id);
        if (msg.value != price) revert WrongPayment();
        if (_ownerOf(id) != address(0)) revert InvalidPlot();

        uint256 idx = tokenIndexOf(id);
        uint256 required = maxRewardForSale(id);
        uint256 available = reserveAvailable(idx);
        if (available < required) revert InsufficientReserve(idx, required, available);

        lastClaim[id] = uint64(block.timestamp);
        reserveCommitment[id] = required;
        totalCommittedByToken[idx] += required;
        _safeMint(msg.sender, id);
        emit Bought(id, msg.sender, price, required);
    }

    function claimable(uint256 id) public view returns (uint256) {
        if (_ownerOf(id) == address(0)) return 0;
        uint256 end = block.timestamp < rewardEnd ? block.timestamp : rewardEnd;
        return _rewardBetween(id, lastClaim[id], end);
    }

    function availablePayout(uint256 id) public view returns (uint256) {
        uint256 amount = claimable(id);
        uint256 balance = tokens[tokenIndexOf(id)].balanceOf(address(this));
        return amount < balance ? amount : balance;
    }

    function claimableMany(uint256[] calldata ids)
        external
        view
        returns (uint256[] memory claimableAmounts, uint256[] memory availableAmounts)
    {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        claimableAmounts = new uint256[](ids.length);
        availableAmounts = new uint256[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            claimableAmounts[i] = claimable(ids[i]);
            availableAmounts[i] = availablePayout(ids[i]);
        }
    }

    function claim(uint256 id) external nonReentrant {
        _claim(id);
    }

    function claimMany(uint256[] calldata ids) external nonReentrant {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < ids.length; i++) {
            _claim(ids[i]);
        }
    }

    function _claim(uint256 id) internal {
        address plotOwner = _ownerOf(id);
        if (plotOwner == address(0)) revert NotMinted();
        if (plotOwner != msg.sender) revert NotPlotOwner();
        if (!isEligible(msg.sender)) revert NotEligible();

        uint256 amount = claimable(id);
        uint256 idx = tokenIndexOf(id);
        uint256 previousCommitment = reserveCommitment[id];
        uint256 released;

        if (block.timestamp >= rewardEnd) {
            released = previousCommitment;
            reserveCommitment[id] = 0;
            lastClaim[id] = rewardEnd;
        } else {
            released = amount;
            reserveCommitment[id] = previousCommitment - amount;
            lastClaim[id] = uint64(block.timestamp);
        }
        totalCommittedByToken[idx] -= released;

        if (amount > 0) tokens[idx].safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, address(tokens[idx]), amount, 0);
    }

    // ---- frontend hydration views ----

    function ownershipBitmap() external view returns (uint256[4] memory) {
        return _ownershipBits;
    }

    function plotsOf(address who) external view returns (uint256[4] memory) {
        return _ownerBits[who];
    }

    /// @notice price (bits 0..127) | rewardBps << 128 | tokenIdx << 144.
    function plotsPacked() external view returns (uint256[1024] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            out[id] = priceOf(id) | (apyBpsOf(id) << 128) | (tokenIndexOf(id) << 144);
        }
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        if (to != address(0) && !isEligible(to)) revert NotEligible();
        from = super._update(to, tokenId, auth);

        uint256 word = tokenId >> 8;
        uint256 mask = uint256(1) << (tokenId & 255);
        if (from == address(0)) _ownershipBits[word] |= mask;
        else _ownerBits[from][word] &= ~mask;
        if (to == address(0)) _ownershipBits[word] &= ~mask;
        else _ownerBits[to][word] |= mask;
    }

    // ---- migration ----

    /// @notice Re-mint deeds from a prior utopia contract to their current
    /// owners so buyers keep their plots across a redeploy. Each migrated plot
    /// reserves its full reward like a sale, so fund the treasury first. Owners
    /// must already be eligible. Skips plots already minted here or absent on
    /// the old contract; reverts if a plot's reward reserve is short.
    function migrateOwners(ILandOwners oldLand, uint256[] calldata ids) external onlyOwner {
        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (id >= PLOTS || _ownerOf(id) != address(0)) continue;
            address to;
            try oldLand.ownerOf(id) returns (address a) {
                to = a;
            } catch {
                continue;
            }
            if (to == address(0)) continue;

            uint256 idx = tokenIndexOf(id);
            uint256 required = maxRewardForSale(id);
            uint256 available = reserveAvailable(idx);
            if (available < required) revert InsufficientReserve(idx, required, available);

            lastClaim[id] = uint64(block.timestamp);
            reserveCommitment[id] = required;
            totalCommittedByToken[idx] += required;
            _mint(to, id);
            emit Migrated(id, to);
        }
    }

    // ---- admin ----

    function withdrawEth(address payable to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidConfig();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit EthWithdrawn(to, amount);
    }

    function withdrawSurplusStock(uint256 tokenIndex, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0) || tokenIndex >= 5) revert InvalidConfig();
        if (amount > reserveAvailable(tokenIndex)) revert InsufficientSurplus();
        tokens[tokenIndex].safeTransfer(to, amount);
        emit SurplusStockWithdrawn(address(tokens[tokenIndex]), to, amount);
    }
}
