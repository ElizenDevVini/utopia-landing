// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaLandV3, IMarketMultiplierOracle} from "../src/UtopiaLandV3.sol";
import {UtopiaToken} from "../src/UtopiaToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract V3MockStock is ERC20 {
    constructor() ERC20("STK", "STK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockMarketOracle is IMarketMultiplierOracle {
    uint256 public value = 1e18;
    bool public shouldRevert;

    function set(uint256 value_) external {
        value = value_;
    }

    function setRevert(bool shouldRevert_) external {
        shouldRevert = shouldRevert_;
    }

    function multiplierWad() external view returns (uint256) {
        require(!shouldRevert, "oracle unavailable");
        return value;
    }
}

contract UtopiaLandV3Test is Test {
    UtopiaLandV3 land;
    UtopiaToken utop;
    MockMarketOracle oracle;
    V3MockStock[5] stocks;
    uint256[5] rates = [uint256(3e15), 6.25e15, 6.75e15, 4.5e15, 0.75e15];

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        utop = new UtopiaToken();
        oracle = new MockMarketOracle();
        IERC20[5] memory tokens;
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new V3MockStock();
            tokens[i] = IERC20(address(stocks[i]));
            stocks[i].mint(address(this), 100e18);
        }
        land = new UtopiaLandV3(IERC20(address(utop)), tokens, rates, oracle);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 50e18);
        }
        utop.mint(alice, 100_000e18);
        utop.mint(bob, 100_000e18);
    }

    function _buy(address who, uint256 id) internal {
        uint256 price = land.priceOf(id);
        vm.startPrank(who);
        utop.approve(address(land), price);
        land.buy(id);
        vm.stopPrank();
    }

    function _oneYearReward(uint256 id) internal view returns (uint256) {
        uint256 weighted = land.priceOf(id) * land.rewardBpsOf(id) / 10_000;
        return weighted * rates[land.tokenIndexOf(id)] / 1e18;
    }

    function test_priceStaysFixedWhenMarketChanges() public {
        uint256 before = land.priceOf(5);
        oracle.set(4e18);
        land.syncMarket();
        assertEq(land.marketMultiplierWad(), 4e18);
        assertEq(land.priceOf(5), before);
    }

    function test_multiplierOnlyAffectsFutureIntervals() public {
        _buy(alice, 5);
        uint256 oneYear = _oneYearReward(5);

        vm.warp(block.timestamp + 365 days);
        oracle.set(4e18);
        land.syncMarket();
        assertEq(land.claimable(5), oneYear);

        vm.warp(block.timestamp + 365 days);
        assertEq(land.claimable(5), oneYear * 5);
    }

    function test_multiplierIsFlooredAndCapped() public {
        oracle.set(0);
        land.syncMarket();
        assertEq(land.marketMultiplierWad(), 1e18);

        oracle.set(500e18);
        land.syncMarket();
        assertEq(land.marketMultiplierWad(), 100e18);
    }

    function test_oracleFailureRetainsLastMultiplier() public {
        oracle.set(3e18);
        land.syncMarket();
        oracle.setRevert(true);
        vm.warp(block.timestamp + 1 days);
        land.syncMarket();
        assertEq(land.marketMultiplierWad(), 3e18);
    }

    function test_buyTransfersFixedUtopPrice() public {
        uint256 price = land.priceOf(7);
        uint256 before = utop.balanceOf(alice);
        _buy(alice, 7);
        assertEq(land.ownerOf(7), alice);
        assertEq(utop.balanceOf(alice), before - price);
        assertEq(utop.balanceOf(address(land)), price);
    }

    function test_claimReportsAndPaysReward() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 expected = _oneYearReward(5);
        uint256 idx = land.tokenIndexOf(5);

        vm.prank(alice);
        land.claim(5);

        assertEq(stocks[idx].balanceOf(alice), expected);
        assertEq(land.claimable(5), 0);
    }

    function test_shortfallIsVisibleAndCarried() public {
        _buy(alice, 5);
        uint256 idx = land.tokenIndexOf(5);
        uint256 current = stocks[idx].balanceOf(address(land));
        vm.prank(address(land));
        stocks[idx].transfer(address(this), current - 3);
        vm.warp(block.timestamp + 365 days);
        uint256 expected = land.claimable(5);
        assertEq(land.availablePayout(5), 3);

        vm.prank(alice);
        land.claim(5);

        assertEq(stocks[idx].balanceOf(alice), 3);
        assertEq(land.owed(5), expected - 3);
        assertEq(land.totalOwedByToken(idx), expected - 3);
    }

    function test_yieldStaysWithTransferredDeed() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 expected = land.claimable(5);
        vm.prank(alice);
        land.transferFrom(alice, bob, 5);
        vm.prank(bob);
        land.claim(5);
        assertEq(stocks[land.tokenIndexOf(5)].balanceOf(bob), expected);
    }

    function test_claimableManyReturnsPayoutState() public {
        _buy(alice, 5);
        _buy(alice, 6);
        vm.warp(block.timestamp + 30 days);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 5;
        ids[1] = 6;
        (uint256[] memory claimables, uint256[] memory available) = land.claimableMany(ids);
        assertGt(claimables[0], 0);
        assertGt(claimables[1], 0);
        assertEq(available[0], claimables[0]);
        assertEq(available[1], claimables[1]);
    }

    function test_claimManyIsBounded() public {
        uint256[] memory ids = new uint256[](65);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandV3.BatchTooLarge.selector);
        land.claimMany(ids);
    }

    function test_onlyOwnerCanWithdrawSaleProceeds() public {
        _buy(alice, 5);
        uint256 amount = utop.balanceOf(address(land));
        vm.prank(alice);
        vm.expectRevert();
        land.withdrawUtop(alice, amount);

        land.withdrawUtop(bob, amount);
        assertEq(utop.balanceOf(bob), 100_000e18 + amount);
    }

    function test_plotBounds() public view {
        for (uint256 id = 0; id < 1024; id++) {
            uint256 price = land.priceOf(id);
            assertGe(price, 50e18);
            assertLe(price, 500e18);
            assertEq(price % 1e18, 0);
        }
    }
}
