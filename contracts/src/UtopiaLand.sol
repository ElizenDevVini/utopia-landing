// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title UtopiaLand
/// @notice A 32x32 grid of land deeds on Robinhood Chain testnet. Each plot is
/// an ERC-721 priced deterministically on-chain; owned plots stream yield in
/// one of five testnet Stock Tokens, paid from a treasury this contract holds.
/// Yield accrues to the deed, not the buyer: transferring a plot transfers any
/// unclaimed accrual with it.
/// @dev Testnet economics. Prices, APYs and FX rates are deterministic fakes.
contract UtopiaLand is ERC721, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant SIDE = 32;
    uint256 public constant PLOTS = 1024;
    uint256 public constant YEAR = 365 days;
    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;

    IERC20[5] public tokens;
    // fake fixed FX: token-wei streamed per ETH-wei of price-at-APY, 1e18-scaled
    uint256[5] public tokensPerEthWad;

    mapping(uint256 => uint64) public lastClaim;
    // shortfall carried when the treasury ran dry at claim time
    mapping(uint256 => uint256) public owed;

    event Bought(uint256 indexed id, address indexed buyer, uint256 price);
    event Claimed(uint256 indexed id, address indexed to, address token, uint256 paid, uint256 stillOwed);

    error InvalidPlot();
    error WrongPayment();
    error NotPlotOwner();
    error NotMinted();

    constructor(IERC20[5] memory tokens_, uint256[5] memory rates_)
        ERC721("utopia land", "PLOT")
        Ownable(msg.sender)
    {
        tokens = tokens_;
        tokensPerEthWad = rates_;
    }

    // ---- plot attributes (deterministic, on-chain only) ----

    function priceOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        uint256 x = id % SIDE;
        uint256 y = id / SIDE;
        uint256 r = uint256(keccak256(abi.encodePacked("utopia/price/v1", id)));
        uint256 base = 0.0005 ether + (r % 0.002 ether);
        // summit premium: plot (0,0) is the diamond's top vertex
        uint256 premium = (0.0025 ether * 300) / (300 + x * x + y * y);
        uint256 raw = base + premium;
        return raw - (raw % 1e13); // snap to 0.00001 ETH steps
    }

    function apyBpsOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return 310 + (uint256(keccak256(abi.encodePacked("utopia/apy/v1", id))) % 271);
    }

    function tokenIndexOf(uint256 id) public pure returns (uint256) {
        if (id >= PLOTS) revert InvalidPlot();
        return uint256(keccak256(abi.encodePacked("utopia/token/v1", id))) % 5;
    }

    // ---- buy / claim ----

    function buy(uint256 id) external payable {
        if (msg.value != priceOf(id)) revert WrongPayment();
        lastClaim[id] = uint64(block.timestamp);
        _mint(msg.sender, id);
        emit Bought(id, msg.sender, msg.value);
    }

    /// @notice Streamed but unpaid yield for a plot, in its stock token's wei.
    function claimable(uint256 id) public view returns (uint256) {
        if (_ownerOf(id) == address(0)) return 0;
        return owed[id] + _streamed(id);
    }

    function _streamed(uint256 id) internal view returns (uint256) {
        uint256 elapsed = block.timestamp - lastClaim[id];
        // max operands: 5e15 * 580 * elapsed * 3e19 stays far below 2^256 for
        // any realistic elapsed (see test_accrualOverflowHeadroom)
        return (priceOf(id) * apyBpsOf(id) * elapsed * tokensPerEthWad[tokenIndexOf(id)]) / (BPS * YEAR * WAD);
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
        for (uint256 i = 0; i < ids.length; i++) claim(ids[i]);
    }

    // ---- frontend hydration views ----

    /// @notice Bit id set = plot minted.
    function ownershipBitmap() external view returns (uint256[4] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            if (_ownerOf(id) != address(0)) out[id >> 8] |= (1 << (id & 255));
        }
    }

    /// @notice Bit id set = plot owned by `who`.
    function plotsOf(address who) external view returns (uint256[4] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            if (_ownerOf(id) == who) out[id >> 8] |= (1 << (id & 255));
        }
    }

    /// @notice Static plot data, one call: price (bits 0..127) | apyBps << 128 | tokenIdx << 144.
    function plotsPacked() external pure returns (uint256[1024] memory out) {
        for (uint256 id = 0; id < PLOTS; id++) {
            out[id] = priceOf(id) | (apyBpsOf(id) << 128) | (tokenIndexOf(id) << 144);
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

    function withdrawEth(address payable to) external onlyOwner {
        (bool ok,) = to.call{value: address(this).balance}("");
        require(ok, "eth send failed");
    }

    function rescueTokens(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
