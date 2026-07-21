// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandMainnet} from "../src/UtopiaLandMainnet.sol";
import {UtopiaStockSwap} from "../src/UtopiaStockSwap.sol";

contract SwapMockToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UtopiaStockSwapTest is Test {
    uint256 internal constant FEE_BPS = 125;

    UtopiaLandMainnet internal land;
    UtopiaEligibility internal registry;
    UtopiaStockSwap internal stockSwap;
    SwapMockToken[5] internal stocks;
    uint256[5] internal rates = [uint256(9e18), 15e18, 22e18, 8e18, 17e18];

    address internal alice = makeAddr("alice");
    address internal multisig = makeAddr("multisig");

    function setUp() public {
        vm.warp(1_800_000_000);
        registry = new UtopiaEligibility(address(this));

        IERC20[5] memory tokens;
        string[5] memory symbols = ["TSLA", "AAPL", "NVDA", "MSFT", "AMZN"];
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new SwapMockToken(symbols[i]);
            tokens[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandMainnet(
            tokens, rates, IUtopiaEligibility(address(registry)), uint64(block.timestamp + 365 days), multisig
        );
        stockSwap = new UtopiaStockSwap(land, FEE_BPS, multisig);

        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(stockSwap), 1_000_000e18);
            stocks[i].mint(alice, 10_000e18);
            vm.prank(alice);
            stocks[i].approve(address(stockSwap), type(uint256).max);
        }
    }

    function _handQuote(uint256 fromIdx, uint256 toIdx, uint256 amountIn)
        internal
        view
        returns (uint256 amountOut, uint256 fee)
    {
        uint256 gross = Math.mulDiv(amountIn, rates[toIdx], rates[fromIdx]);
        fee = Math.mulDiv(gross, FEE_BPS, 10_000);
        amountOut = gross - fee;
    }

    function test_constructorCachesConfigAndTokens() public view {
        assertEq(address(stockSwap.land()), address(land));
        assertEq(stockSwap.feeBps(), FEE_BPS);
        assertEq(stockSwap.owner(), multisig);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(address(stockSwap.tokens(i)), address(stocks[i]));
        }
    }

    function test_constructorRejectsInvalidLandAndFee() public {
        vm.expectRevert(UtopiaStockSwap.InvalidConfig.selector);
        new UtopiaStockSwap(UtopiaLandMainnet(address(0)), FEE_BPS, multisig);

        vm.expectRevert(UtopiaStockSwap.InvalidConfig.selector);
        new UtopiaStockSwap(UtopiaLandMainnet(makeAddr("codelessLand")), FEE_BPS, multisig);

        vm.expectRevert(UtopiaStockSwap.InvalidConfig.selector);
        new UtopiaStockSwap(land, 201, multisig);
    }

    function test_quoteRoundTripMatchesHandComputationIncludingBothFees() public view {
        uint256 amountIn = 137e18 + 91;
        (uint256 expectedOut, uint256 expectedFee) = _handQuote(0, 2, amountIn);
        (uint256 amountOut, uint256 fee) = stockSwap.quote(0, 2, amountIn);
        assertEq(amountOut, expectedOut);
        assertEq(fee, expectedFee);

        (uint256 expectedReturn, uint256 expectedReturnFee) = _handQuote(2, 0, amountOut);
        (uint256 returned, uint256 returnFee) = stockSwap.quote(2, 0, amountOut);
        assertEq(returned, expectedReturn);
        assertEq(returnFee, expectedReturnFee);
    }

    function test_swapMovesExactInputAndOutputBalances() public {
        uint256 amountIn = 90e18;
        (uint256 amountOut,) = stockSwap.quote(0, 1, amountIn);
        uint256 aliceOutBefore = stocks[1].balanceOf(alice);
        uint256 poolInBefore = stocks[0].balanceOf(address(stockSwap));
        uint256 poolOutBefore = stocks[1].balanceOf(address(stockSwap));

        vm.prank(alice);
        (uint256 actualOut,) = stockSwap.swap(0, 1, amountIn, amountOut, alice);

        assertEq(actualOut, amountOut);
        assertEq(stocks[0].balanceOf(alice), 10_000e18 - amountIn);
        assertEq(stocks[0].balanceOf(address(stockSwap)), poolInBefore + amountIn);
        assertEq(stocks[1].balanceOf(alice), aliceOutBefore + amountOut);
        assertEq(stocks[1].balanceOf(address(stockSwap)), poolOutBefore - amountOut);
    }

    function testFuzz_swapConservesInventoryAndQuotedMinOutIsPayable(
        uint8 fromSeed,
        uint8 offsetSeed,
        uint96 amountSeed
    ) public {
        uint256 fromIdx = uint256(fromSeed) % 5;
        uint256 toIdx = (fromIdx + 1 + (uint256(offsetSeed) % 4)) % 5;
        uint256 amountIn = bound(uint256(amountSeed), 1, 10_000e18);
        (uint256 quotedOut, uint256 quotedFee) = stockSwap.quote(fromIdx, toIdx, amountIn);
        uint256 gross = Math.mulDiv(amountIn, rates[toIdx], rates[fromIdx]);
        uint256 inputBefore = stocks[fromIdx].balanceOf(address(stockSwap));
        uint256 outputBefore = stocks[toIdx].balanceOf(address(stockSwap));

        vm.prank(alice);
        (uint256 amountOut, uint256 fee) = stockSwap.swap(fromIdx, toIdx, amountIn, quotedOut, alice);

        assertEq(amountOut, quotedOut);
        assertEq(fee, quotedFee);
        assertEq(gross, amountOut + fee);
        assertEq(stocks[fromIdx].balanceOf(address(stockSwap)), inputBefore + amountIn);
        assertEq(stocks[toIdx].balanceOf(address(stockSwap)), outputBefore - gross + fee);
    }

    function test_swapRevertsWhenInventoryIsInsufficient() public {
        uint256 amountIn = 90e18;
        (uint256 amountOut,) = stockSwap.quote(0, 1, amountIn);
        uint256 available = amountOut - 1;
        uint256 excess = stocks[1].balanceOf(address(stockSwap)) - available;
        vm.prank(multisig);
        stockSwap.withdrawInventory(1, multisig, excess);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UtopiaStockSwap.InsufficientInventory.selector, amountOut, available));
        stockSwap.swap(0, 1, amountIn, 0, alice);
    }

    function test_quoteNeverPromisesMoreThanCurrentInventory() public {
        uint256 amountIn = 90e18;
        (uint256 promised,) = stockSwap.quote(0, 1, amountIn);
        uint256 available = promised - 1;
        uint256 excess = stocks[1].balanceOf(address(stockSwap)) - available;
        vm.prank(multisig);
        stockSwap.withdrawInventory(1, multisig, excess);

        vm.expectRevert(abi.encodeWithSelector(UtopiaStockSwap.InsufficientInventory.selector, promised, available));
        stockSwap.quote(0, 1, amountIn);
    }

    function testFuzz_quoteRejectsAnyPromiseAboveInventory(uint96 amountSeed, uint96 availableSeed) public {
        uint256 amountIn = bound(uint256(amountSeed), 1e18, 100e18);
        (uint256 promised,) = _handQuote(0, 1, amountIn);
        uint256 available = bound(uint256(availableSeed), 0, promised - 1);
        uint256 excess = stocks[1].balanceOf(address(stockSwap)) - available;
        vm.prank(multisig);
        stockSwap.withdrawInventory(1, multisig, excess);

        vm.expectRevert(abi.encodeWithSelector(UtopiaStockSwap.InsufficientInventory.selector, promised, available));
        stockSwap.quote(0, 1, amountIn);
    }

    function test_swapRevertsOnSlippage() public {
        uint256 amountIn = 90e18;
        (uint256 amountOut,) = stockSwap.quote(0, 1, amountIn);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UtopiaStockSwap.Slippage.selector, amountOut, amountOut + 1));
        stockSwap.swap(0, 1, amountIn, amountOut + 1, alice);
    }

    function test_quoteAndSwapRejectSameIndexAndZeroAmount() public {
        vm.expectRevert(UtopiaStockSwap.SameToken.selector);
        stockSwap.quote(2, 2, 1e18);

        vm.expectRevert(UtopiaStockSwap.ZeroAmount.selector);
        stockSwap.quote(1, 2, 0);

        vm.prank(alice);
        vm.expectRevert(UtopiaStockSwap.SameToken.selector);
        stockSwap.swap(3, 3, 1e18, 0, alice);

        vm.prank(alice);
        vm.expectRevert(UtopiaStockSwap.ZeroAmount.selector);
        stockSwap.swap(3, 4, 0, 0, alice);
    }

    function test_quoteRejectsOutOfRangeIndex() public {
        vm.expectRevert(UtopiaStockSwap.InvalidTokenIndex.selector);
        stockSwap.quote(5, 0, 1e18);
        vm.expectRevert(UtopiaStockSwap.InvalidTokenIndex.selector);
        stockSwap.quote(0, 5, 1e18);
    }

    function test_feeRemainsInOutputInventory() public {
        uint256 amountIn = 90e18;
        uint256 gross = Math.mulDiv(amountIn, rates[1], rates[0]);
        (uint256 amountOut, uint256 fee) = stockSwap.quote(0, 1, amountIn);
        uint256 poolBefore = stocks[1].balanceOf(address(stockSwap));

        vm.prank(alice);
        stockSwap.swap(0, 1, amountIn, amountOut, alice);

        assertEq(gross - amountOut, fee);
        assertEq(stocks[1].balanceOf(address(stockSwap)), poolBefore - gross + fee);
    }

    function test_ownerCanWithdrawInventory() public {
        uint256 amount = 123e18;
        uint256 beforeBalance = stocks[4].balanceOf(multisig);
        vm.prank(multisig);
        stockSwap.withdrawInventory(4, multisig, amount);
        assertEq(stocks[4].balanceOf(multisig), beforeBalance + amount);
    }

    function test_nonOwnerCannotWithdrawInventory() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        stockSwap.withdrawInventory(0, alice, 1e18);
    }
}
