// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaLandV2, IUniswapV3PoolMinimal} from "../src/UtopiaLandV2.sol";
import {UtopiaToken} from "../src/UtopiaToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStock is ERC20 {
    constructor() ERC20("STK", "STK") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract MockPool {
    uint160 public sqrt;

    constructor(uint160 s) {
        sqrt = s;
    }

    function set(uint160 s) external {
        sqrt = s;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrt, 0, 0, 0, 0, 0, true);
    }
}

contract UtopiaLandV2Test is Test {
    UtopiaLandV2 land;
    UtopiaToken utop;
    MockStock[5] stocks;
    uint256[5] rates = [uint256(3e15), 6.25e15, 6.75e15, 4.5e15, 0.75e15];

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        utop = new UtopiaToken();
        IERC20[5] memory toks;
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new MockStock();
            toks[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandV2(IERC20(address(utop)), toks, rates);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 50e18);
        }
        utop.mint(alice, 100_000e18);
        utop.mint(bob, 100_000e18);
    }

    function _buy(address who, uint256 id) internal {
        uint256 p = land.priceOf(id);
        vm.startPrank(who);
        utop.approve(address(land), p);
        land.buy(id);
        vm.stopPrank();
    }

    // ---- token ----

    function test_tokenFaucet() public {
        vm.prank(alice);
        utop.faucet();
        assertEq(utop.balanceOf(alice), 101_000e18);
        vm.prank(alice);
        vm.expectRevert(UtopiaToken.FaucetCooldown.selector);
        utop.faucet();
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        utop.faucet();
        assertEq(utop.balanceOf(alice), 102_000e18);
    }

    // ---- pricing ----

    function test_basePriceBounds() public view {
        for (uint256 id = 0; id < 1024; id++) {
            uint256 p = land.basePriceOf(id);
            assertGe(p, 50e18);
            assertLe(p, 500e18);
            assertEq(p % 1e18, 0);
        }
    }

    function test_multiplierDefaultsToOne() public view {
        assertEq(land.multiplierWad(), 1e18);
        assertEq(land.priceOf(7), land.basePriceOf(7));
    }

    // ---- buy with token ----

    function test_buyTransfersUtop() public {
        uint256 p = land.priceOf(5);
        uint256 before = utop.balanceOf(alice);
        _buy(alice, 5);
        assertEq(land.ownerOf(5), alice);
        assertEq(utop.balanceOf(alice), before - p);
        assertEq(utop.balanceOf(address(land)), p);
    }

    function test_buyWithoutApprovalReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        land.buy(5);
    }

    function test_doubleBuyReverts() public {
        _buy(alice, 5);
        uint256 p = land.priceOf(5);
        vm.startPrank(bob);
        utop.approve(address(land), p);
        vm.expectRevert();
        land.buy(5);
        vm.stopPrank();
    }

    // ---- multiplier mechanics ----

    function test_oracleMultiplierScalesPriceAndYield() public {
        _buy(alice, 5);
        uint256 baseClaim;
        vm.warp(block.timestamp + 365 days);
        baseClaim = land.claimable(5);

        MockPool pool = new MockPool(uint160(1e9) * 2 ** 96 / 1e9); // sqrt ratio 1.0
        land.setOracle(IUniswapV3PoolMinimal(address(pool)), true);
        assertEq(land.multiplierWad(), 1e18);

        // UTOP price 4x => sqrt doubles => multiplier 4x
        pool.set(uint160(2 * (2 ** 96)));
        vm.expectRevert(UtopiaLandV2.OracleAlreadySet.selector);
        land.setOracle(IUniswapV3PoolMinimal(address(pool)), true);
        assertEq(land.multiplierWad(), 4e18);
        assertEq(land.priceOf(7), land.basePriceOf(7) * 4);
        assertEq(land.claimable(5), baseClaim * 4);
    }

    function test_multiplierFloorAndCap() public {
        MockPool pool = new MockPool(uint160(2 ** 96));
        land.setOracle(IUniswapV3PoolMinimal(address(pool)), true);
        // price drops to 1/4: floored at 1x
        pool.set(uint160(2 ** 96 / 2));
        assertEq(land.multiplierWad(), 1e18);
        // price 400x: capped at 100x
        pool.set(uint160(20 * (2 ** 96)));
        assertEq(land.multiplierWad(), 100e18);
    }

    function test_multiplierInvertsWhenUtopIsToken1() public {
        MockPool pool = new MockPool(uint160(2 ** 96));
        land.setOracle(IUniswapV3PoolMinimal(address(pool)), false);
        // pool price (token1 per token0) halves the sqrt => UTOP price quadruples
        pool.set(uint160(2 ** 96 / 2));
        assertEq(land.multiplierWad(), 4e18);
    }

    // ---- accrual / claim ----

    function test_accrualExactAfterYear() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 baseFlow = land.basePriceOf(5) * land.apyBpsOf(5) * 365 days / (10_000 * 365 days);
        uint256 expected = baseFlow * rates[land.tokenIndexOf(5)] / 1e18;
        assertEq(land.claimable(5), expected);
        assertGt(expected, 0);
    }

    function test_claimPaysStock() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 acc = land.claimable(5);
        vm.prank(alice);
        land.claim(5);
        assertEq(stocks[land.tokenIndexOf(5)].balanceOf(alice), acc);
        assertEq(land.claimable(5), 0);
    }

    function test_dryTreasuryCarriesOwed() public {
        _buy(alice, 5);
        uint256 idx = land.tokenIndexOf(5);
        land.rescueTokens(IERC20(address(stocks[idx])), bob, 50e18 - 3);
        vm.warp(block.timestamp + 365 days);
        uint256 acc = land.claimable(5);
        vm.prank(alice);
        land.claim(5);
        assertEq(stocks[idx].balanceOf(alice), 3);
        assertEq(land.owed(5), acc - 3);
    }

    // ---- admin ----

    function test_withdrawUtop() public {
        _buy(alice, 5);
        uint256 p = utop.balanceOf(address(land));
        address sink = makeAddr("sink");
        land.withdrawUtop(sink);
        assertEq(utop.balanceOf(sink), p);
    }

    function test_adminAuth() public {
        vm.startPrank(alice);
        vm.expectRevert();
        land.withdrawUtop(alice);
        vm.expectRevert();
        land.setOracle(IUniswapV3PoolMinimal(address(1)), true);
        vm.stopPrank();
    }
}
