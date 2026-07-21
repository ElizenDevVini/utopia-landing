// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UtopiaLandMainnet} from "./UtopiaLandMainnet.sol";

/// @title UtopiaStockSwap
/// @notice Treasury-funded venue for exchanging the five Utopia land Stock Tokens.
/// @dev Prices always come from the immutable land contract. Swap fees remain in
/// the pool as inventory, and the owner supplies or removes all available liquidity.
contract UtopiaStockSwap is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_FEE_BPS = 200;

    UtopiaLandMainnet public immutable land;
    uint256 public immutable feeBps;
    IERC20[5] public tokens;

    event Swapped(
        address indexed sender,
        address indexed to,
        address indexed tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 fee
    );
    event InventoryWithdrawn(address indexed token, address indexed to, uint256 amount);

    error InvalidConfig();
    error InvalidTokenIndex();
    error SameToken();
    error ZeroAmount();
    error InsufficientInventory(uint256 required, uint256 available);
    error Slippage(uint256 amountOut, uint256 minOut);

    constructor(UtopiaLandMainnet land_, uint256 feeBps_, address initialOwner) Ownable(initialOwner) {
        address landAddress = address(land_);
        if (landAddress == address(0) || landAddress.code.length == 0 || feeBps_ > MAX_FEE_BPS) {
            revert InvalidConfig();
        }

        land = land_;
        feeBps = feeBps_;
        for (uint256 i = 0; i < 5; i++) {
            IERC20 token = land_.tokens(i);
            address tokenAddress = address(token);
            if (tokenAddress == address(0) || tokenAddress.code.length == 0) revert InvalidConfig();
            for (uint256 j = 0; j < i; j++) {
                if (tokenAddress == address(tokens[j])) revert InvalidConfig();
            }
            tokens[i] = token;
        }
    }

    /// @notice Quotes output and fee for an exact input using the land's current rates.
    function quote(uint256 fromIdx, uint256 toIdx, uint256 amountIn)
        public
        view
        returns (uint256 amountOut, uint256 fee)
    {
        _validateTrade(fromIdx, toIdx, amountIn);
        uint256 gross = Math.mulDiv(amountIn, land.tokensPerEthWad(toIdx), land.tokensPerEthWad(fromIdx));
        fee = Math.mulDiv(gross, feeBps, BPS);
        amountOut = gross - fee;
        uint256 available = tokens[toIdx].balanceOf(address(this));
        if (amountOut > available) revert InsufficientInventory(amountOut, available);
    }

    /// @notice Swaps the amount actually received by the pool and sends output to `to`.
    /// @dev A balance-delta input prevents fee-on-transfer tokens from creating
    /// unbacked output. The transaction reverts atomically if inventory is short.
    function swap(uint256 fromIdx, uint256 toIdx, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut, uint256 fee)
    {
        _validateTrade(fromIdx, toIdx, amountIn);
        if (to == address(0)) revert InvalidConfig();

        IERC20 tokenIn = tokens[fromIdx];
        IERC20 tokenOut = tokens[toIdx];
        uint256 inputBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = tokenIn.balanceOf(address(this)) - inputBefore;
        if (received == 0) revert ZeroAmount();

        (amountOut, fee) = quote(fromIdx, toIdx, received);
        uint256 available = tokenOut.balanceOf(address(this));
        if (amountOut > available) revert InsufficientInventory(amountOut, available);
        if (amountOut < minOut) revert Slippage(amountOut, minOut);

        tokenOut.safeTransfer(to, amountOut);
        emit Swapped(msg.sender, to, address(tokenIn), address(tokenOut), received, amountOut, fee);
    }

    /// @notice Removes treasury inventory. Swaps never leave user-owned funds at rest.
    function withdrawInventory(uint256 tokenIndex, address to, uint256 amount) external onlyOwner nonReentrant {
        if (tokenIndex >= 5) revert InvalidTokenIndex();
        if (to == address(0)) revert InvalidConfig();
        if (amount == 0) revert ZeroAmount();
        tokens[tokenIndex].safeTransfer(to, amount);
        emit InventoryWithdrawn(address(tokens[tokenIndex]), to, amount);
    }

    function _validateTrade(uint256 fromIdx, uint256 toIdx, uint256 amountIn) internal pure {
        if (fromIdx >= 5 || toIdx >= 5) revert InvalidTokenIndex();
        if (fromIdx == toIdx) revert SameToken();
        if (amountIn == 0) revert ZeroAmount();
    }
}
