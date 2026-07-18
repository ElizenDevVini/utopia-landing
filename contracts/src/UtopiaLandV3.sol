// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Adapter boundary for a separately reviewed UTOP market oracle.
/// The adapter may use a Uniswap v4 TWAP, Chainlink, or another robust source.
/// It must return 1e18 for 1x and must not report a raw single-block spot price.
interface IMarketMultiplierOracle {
    function multiplierWad() external view returns (uint256);
}

/// @title UtopiaLandV3
/// @notice Mainnet candidate for Utopia land. Plot prices stay fixed in UTOP so
/// a change in UTOP's quote price is not counted twice. A checkpointed market
/// multiplier affects only future Stock Token reward intervals.
/// @dev Deployment is gated on a fixed-supply UTOP token, a reviewed oracle
/// adapter, funded Stock Token reserves, and a multisig/timelock owner.
contract UtopiaLandV3 is ERC721, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SIDE = 32;
    uint256 public constant PLOTS = 1024;
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MULT_CAP = 100e18;
    uint256 public constant MAX_BATCH = 64;

    IERC20 public immutable utop;
    IERC20[5] public tokens;
    uint256[5] public rewardTokensPerUtopWad;
    IMarketMultiplierOracle public immutable oracle;

    uint256 public marketMultiplierWad = WAD;
    uint64 public lastMarketSync;
    // Integral of multiplierWad * elapsed seconds. Rewards use checkpoint
    // differences so a new multiplier never reprices an earlier interval.
    uint256 public cumulativeMarketSecondsWad;

    mapping(uint256 => uint256) public rewardCheckpoint;
    mapping(uint256 => uint256) public owed;
    mapping(uint256 => uint256) public totalOwedByToken;

    event Bought(uint256 indexed id, address indexed buyer, uint256 price);
    event Claimed(uint256 indexed id, address indexed to, address token, uint256 paid, uint256 stillOwed);
    event MarketSynced(uint256 previousMultiplierWad, uint256 nextMultiplierWad, uint256 elapsed);
    event OracleReadFailed(uint256 retainedMultiplierWad);
    event UtopWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();
    error InvalidPlot();
    error NotPlotOwner();
    error NotMinted();
    error BatchTooLarge();

    constructor(IERC20 utop_, IERC20[5] memory tokens_, uint256[5] memory rates_, IMarketMultiplierOracle oracle_)
        ERC721("utopia land", "PLOT")
        Ownable(msg.sender)
    {
        if (address(utop_) == address(0) || address(oracle_) == address(0)) revert InvalidConfig();
        for (uint256 i = 0; i < 5; i++) {
            if (address(tokens_[i]) == address(0) || rates_[i] == 0) revert InvalidConfig();
        }
        utop = utop_;
        tokens = tokens_;
        rewardTokensPerUtopWad = rates_;
        oracle = oracle_;
        lastMarketSync = uint64(block.timestamp);
    }

    // ---- plot attributes ----

    function priceOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        uint256 x = id % SIDE;
        uint256 y = id / SIDE;
        uint256 r = uint256(keccak256(abi.encodePacked("utopia/price/v3", id)));
        uint256 base = 50e18 + (r % 200e18);
        uint256 premium = (250e18 * 300) / (300 + x * x + y * y);
        uint256 raw = base + premium;
        return raw - (raw % 1e18);
    }

    /// @notice Reference annual reward rate used with the configured token rate.
    /// This is not a guaranteed investment APY.
    function rewardBpsOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return 310 + (uint256(keccak256(abi.encodePacked("utopia/reward/v3", id))) % 271);
    }

    function tokenIndexOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return uint256(keccak256(abi.encodePacked("utopia/token/v1", id))) % 5;
    }

    // ---- checkpointed market multiplier ----

    function _boundedMultiplier(uint256 raw) internal pure returns (uint256) {
        if (raw < WAD) return WAD;
        if (raw > MULT_CAP) return MULT_CAP;
        return raw;
    }

    function _previewCumulativeMarketSecondsWad() internal view returns (uint256) {
        return cumulativeMarketSecondsWad + marketMultiplierWad * (block.timestamp - lastMarketSync);
    }

    /// @notice Accrues the previous multiplier through the current timestamp,
    /// then reads the oracle for the next interval. A transient oracle failure
    /// retains the last valid multiplier instead of blocking buys or claims.
    function syncMarket() public returns (uint256 nextMultiplierWad) {
        uint256 previous = marketMultiplierWad;
        uint256 elapsed = block.timestamp - lastMarketSync;
        cumulativeMarketSecondsWad += previous * elapsed;
        lastMarketSync = uint64(block.timestamp);

        nextMultiplierWad = previous;
        try oracle.multiplierWad() returns (uint256 raw) {
            nextMultiplierWad = _boundedMultiplier(raw);
            marketMultiplierWad = nextMultiplierWad;
        } catch {
            emit OracleReadFailed(previous);
        }
        emit MarketSynced(previous, nextMultiplierWad, elapsed);
    }

    // ---- buy / claim ----

    function buy(uint256 id) external nonReentrant {
        uint256 price = priceOf(id);
        syncMarket();
        utop.safeTransferFrom(msg.sender, address(this), price);
        rewardCheckpoint[id] = cumulativeMarketSecondsWad;
        _safeMint(msg.sender, id);
        emit Bought(id, msg.sender, price);
    }

    function _accrued(uint256 id, uint256 cumulativeNow) internal view returns (uint256) {
        uint256 marketSecondsWad = cumulativeNow - rewardCheckpoint[id];
        uint256 weightedUtop = Math.mulDiv(priceOf(id), rewardBpsOf(id) * marketSecondsWad, BPS * YEAR * WAD);
        return Math.mulDiv(weightedUtop, rewardTokensPerUtopWad[tokenIndexOf(id)], WAD);
    }

    function claimable(uint256 id) public view returns (uint256) {
        if (_ownerOf(id) == address(0)) return 0;
        return owed[id] + _accrued(id, _previewCumulativeMarketSecondsWad());
    }

    function availablePayout(uint256 id) public view returns (uint256) {
        uint256 amount = claimable(id);
        if (amount == 0) return 0;
        uint256 bal = tokens[tokenIndexOf(id)].balanceOf(address(this));
        return amount <= bal ? amount : bal;
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
        syncMarket();
        _claim(id);
    }

    function claimMany(uint256[] calldata ids) external nonReentrant {
        if (ids.length > MAX_BATCH) revert BatchTooLarge();
        syncMarket();
        for (uint256 i = 0; i < ids.length; i++) {
            _claim(ids[i]);
        }
    }

    function _claim(uint256 id) internal {
        if (_ownerOf(id) == address(0)) revert NotMinted();
        if (ownerOf(id) != msg.sender) revert NotPlotOwner();

        uint256 previousOwed = owed[id];
        uint256 acc = previousOwed + _accrued(id, cumulativeMarketSecondsWad);
        uint256 idx = tokenIndexOf(id);
        IERC20 token = tokens[idx];
        uint256 bal = token.balanceOf(address(this));
        uint256 pay = acc <= bal ? acc : bal;
        uint256 stillOwed = acc - pay;

        rewardCheckpoint[id] = cumulativeMarketSecondsWad;
        owed[id] = stillOwed;
        totalOwedByToken[idx] = totalOwedByToken[idx] - previousOwed + stillOwed;
        if (pay > 0) token.safeTransfer(msg.sender, pay);
        emit Claimed(id, msg.sender, address(token), pay, stillOwed);
    }

    // ---- frontend hydration views ----

    function ownershipBitmap() external view returns (uint256[4] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            if (_ownerOf(id) != address(0)) out[id >> 8] |= (1 << (id & 255));
        }
    }

    function plotsOf(address who) external view returns (uint256[4] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            if (_ownerOf(id) == who) out[id >> 8] |= (1 << (id & 255));
        }
    }

    /// @notice price (bits 0..127) | rewardBps << 128 | tokenIdx << 144.
    function plotsPacked() external pure returns (uint256[1024] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            out[id] = priceOf(id) | (rewardBpsOf(id) << 128) | (tokenIndexOf(id) << 144);
        }
    }

    // ---- admin ----

    /// @notice Land-sale proceeds. The production owner must be the disclosed
    /// multisig/timelock. Stock Token reserves intentionally have no rescue path.
    function withdrawUtop(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidConfig();
        utop.safeTransfer(to, amount);
        emit UtopWithdrawn(to, amount);
    }
}
