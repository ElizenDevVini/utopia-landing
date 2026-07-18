// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IUniswapV3PoolMinimal {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

/// @title UtopiaLandV2
/// @notice utopia land, priced and bought in UTOP. Plot prices and stock-token
/// yield both scale with the UTOP market: once an oracle pool is set, a
/// multiplier tracks UTOP's price against its level at oracle-set time
/// (marketcap proxy: supply is fixed, so price movement is marketcap
/// movement). Until a pool exists the multiplier is 1x.
/// @dev Testnet economics. The multiplier applies to the whole unclaimed
/// accrual window at claim time; that favors holders when the multiplier
/// rises, which is the intended story.
contract UtopiaLandV2 is ERC721, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant SIDE = 32;
    uint256 public constant PLOTS = 1024;
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MULT_CAP = 100e18; // 100x

    IERC20 public immutable utop;
    IERC20[5] public tokens;
    // stock-token wei streamed per UTOP-wei of base price per year at 100% apy, 1e18-scaled
    uint256[5] public tokensPerUtopWad;

    IUniswapV3PoolMinimal public oracle;
    uint160 public refSqrtPriceX96;
    bool public utopIsToken0;

    mapping(uint256 => uint64) public lastClaim;
    mapping(uint256 => uint256) public owed;

    event Bought(uint256 indexed id, address indexed buyer, uint256 price);
    event Claimed(uint256 indexed id, address indexed to, address token, uint256 paid, uint256 stillOwed);
    event OracleSet(address pool, bool utopIsToken0, uint160 refSqrtPriceX96);

    error InvalidPlot();
    error NotPlotOwner();
    error NotMinted();
    error OracleAlreadySet();

    constructor(IERC20 utop_, IERC20[5] memory tokens_, uint256[5] memory rates_)
        ERC721("utopia land", "PLOT")
        Ownable(msg.sender)
    {
        utop = utop_;
        tokens = tokens_;
        tokensPerUtopWad = rates_;
    }

    // ---- plot attributes ----

    /// @notice Base price in UTOP wei, before the market multiplier.
    function basePriceOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        uint256 x = id % SIDE;
        uint256 y = id / SIDE;
        uint256 r = uint256(keccak256(abi.encodePacked("utopia/price/v2", id)));
        uint256 base = 50e18 + (r % 200e18);
        uint256 premium = (250e18 * 300) / (300 + x * x + y * y);
        uint256 raw = base + premium;
        return raw - (raw % 1e18); // whole UTOP
    }

    function apyBpsOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return 310 + (uint256(keccak256(abi.encodePacked("utopia/apy/v1", id))) % 271);
    }

    function tokenIndexOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return uint256(keccak256(abi.encodePacked("utopia/token/v1", id))) % 5;
    }

    // ---- market multiplier ----

    /// @notice Current market multiplier, 1e18 = 1x. Tracks UTOP price vs its
    /// level when the oracle was set; floored at 1x, capped at 100x.
    function multiplierWad() public view returns (uint256) {
        if (address(oracle) == address(0)) return WAD;
        (uint160 sqrtNow,,,,,,) = oracle.slot0();
        // price ratio = (sqrtNow / sqrtRef)^2; if UTOP is token1 the pool
        // price is the inverse, so flip the ratio
        uint256 r =
            utopIsToken0 ? (uint256(sqrtNow) * 1e9) / refSqrtPriceX96 : (uint256(refSqrtPriceX96) * 1e9) / sqrtNow;
        uint256 m = r * r;
        if (m < WAD) return WAD;
        if (m > MULT_CAP) return MULT_CAP;
        return m;
    }

    /// @notice Live price in UTOP wei: base times the market multiplier.
    function priceOf(uint256 id) public view returns (uint256) {
        return (basePriceOf(id) * multiplierWad()) / WAD;
    }

    // ---- buy / claim ----

    function buy(uint256 id) external {
        uint256 price = priceOf(id);
        lastClaim[id] = uint64(block.timestamp);
        _mint(msg.sender, id);
        utop.safeTransferFrom(msg.sender, address(this), price);
        emit Bought(id, msg.sender, price);
    }

    function claimable(uint256 id) public view returns (uint256) {
        if (_ownerOf(id) == address(0)) return 0;
        return owed[id] + _streamed(id);
    }

    function _streamed(uint256 id) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - lastClaim[id];
        // stepwise division keeps every intermediate far below 2^256
        uint256 baseFlow = (basePriceOf(id) * apyBpsOf(id) * elapsed) / (BPS * YEAR);
        uint256 stock = (baseFlow * tokensPerUtopWad[tokenIndexOf(id)]) / WAD;
        return (stock * multiplierWad()) / WAD;
    }

    function claim(uint256 id) public {
        if (_ownerOf(id) == address(0)) revert NotMinted();
        if (ownerOf(id) != msg.sender) revert NotPlotOwner();
        uint256 acc = owed[id] + _streamed(id);
        IERC20 token = tokens[tokenIndexOf(id)];
        uint256 bal = token.balanceOf(address(this));
        uint256 pay = acc <= bal ? acc : bal;
        owed[id] = acc - pay;
        lastClaim[id] = uint64(block.timestamp);
        if (pay > 0) token.safeTransfer(msg.sender, pay);
        emit Claimed(id, msg.sender, address(token), pay, acc - pay);
    }

    function claimMany(uint256[] calldata ids) external {
        for (uint256 i = 0; i < ids.length; i++) {
            claim(ids[i]);
        }
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

    /// @notice Static plot data: basePrice (bits 0..127) | apyBps << 128 | tokenIdx << 144.
    function plotsPacked() external pure returns (uint256[1024] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            out[id] = basePriceOf(id) | (apyBpsOf(id) << 128) | (tokenIndexOf(id) << 144);
        }
    }

    function plotInfo(uint256 id)
        external
        view
        returns (uint256 price, uint256 apyBps, address token, address plotOwner, uint256 claimableNow)
    {
        price = priceOf(id);
        apyBps = apyBpsOf(id);
        token = address(tokens[tokenIndexOf(id)]);
        plotOwner = _ownerOf(id);
        claimableNow = claimable(id);
    }

    // ---- admin ----

    /// @notice Point the multiplier at the UTOP pool once the token launches
    /// and has one. Snapshots the current pool price as the 1x reference.
    function setOracle(IUniswapV3PoolMinimal pool, bool utopIsToken0_) external onlyOwner {
        if (address(oracle) != address(0)) revert OracleAlreadySet();
        (uint160 sqrtNow,,,,,,) = pool.slot0();
        oracle = pool;
        utopIsToken0 = utopIsToken0_;
        refSqrtPriceX96 = sqrtNow;
        emit OracleSet(address(pool), utopIsToken0_, sqrtNow);
    }

    function withdrawUtop(address to) external onlyOwner {
        utop.safeTransfer(to, utop.balanceOf(address(this)));
    }

    function rescueTokens(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
