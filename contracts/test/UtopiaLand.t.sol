// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaLand} from "../src/UtopiaLand.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStock is ERC20 {
    constructor(string memory sym) ERC20(sym, sym) {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract UtopiaLandTest is Test {
    UtopiaLand land;
    MockStock[5] stocks;
    uint256[5] rates = [uint256(12e18), 25e18, 27e18, 18e18, 3e18];

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        IERC20[5] memory toks;
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new MockStock("STK");
            toks[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLand(toks, rates);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 50e18);
        }
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // ---- pricing ----

    function test_priceBoundsAndSnap() public view {
        for (uint256 id = 0; id < 1024; id++) {
            uint256 p = land.priceOf(id);
            assertGe(p, 0.0005 ether);
            assertLe(p, 0.005 ether);
            assertEq(p % 1e13, 0);
        }
    }

    function test_priceDeterministic() public view {
        assertEq(land.priceOf(7), land.priceOf(7));
    }

    function test_summitPremium() public view {
        // average near summit beats average at far corner
        uint256 nearSum;
        uint256 farSum;
        uint256 n;
        for (uint256 y = 0; y < 4; y++) {
            for (uint256 x = 0; x < 4; x++) {
                nearSum += land.priceOf(y * 32 + x);
                farSum += land.priceOf((31 - y) * 32 + (31 - x));
                n++;
            }
        }
        assertGt(nearSum / n, farSum / n);
    }

    function test_priceRevertsOutOfRange() public {
        vm.expectRevert(UtopiaLand.InvalidPlot.selector);
        land.priceOf(1024);
    }

    function test_apyAndTokenDistribution() public view {
        bool[5] memory used;
        for (uint256 id = 0; id < 1024; id++) {
            uint256 a = land.apyBpsOf(id);
            assertGe(a, 310);
            assertLe(a, 580);
            used[land.tokenIndexOf(id)] = true;
        }
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(used[i]);
        }
    }

    // ---- buy ----

    function test_buy() public {
        uint256 p = land.priceOf(5);
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit UtopiaLand.Bought(5, alice, p);
        land.buy{value: p}(5);
        assertEq(land.ownerOf(5), alice);
        assertEq(land.lastClaim(5), block.timestamp);
        assertEq(address(land).balance, p);
    }

    function test_buyWrongPaymentReverts() public {
        uint256 p = land.priceOf(5);
        vm.startPrank(alice);
        vm.expectRevert(UtopiaLand.WrongPayment.selector);
        land.buy{value: p - 1}(5);
        vm.expectRevert(UtopiaLand.WrongPayment.selector);
        land.buy{value: p + 1}(5);
        vm.stopPrank();
    }

    function test_buyBadIdReverts() public {
        vm.prank(alice);
        vm.expectRevert(UtopiaLand.InvalidPlot.selector);
        land.buy{value: 1 ether}(1024);
    }

    function test_doubleBuyReverts() public {
        uint256 p = land.priceOf(5);
        vm.prank(alice);
        land.buy{value: p}(5);
        vm.prank(bob);
        vm.expectRevert();
        land.buy{value: p}(5);
    }

    function testFuzz_buy(uint256 id, uint256 value) public {
        id = bound(id, 0, 2047);
        value = bound(value, 0, 0.006 ether);
        vm.prank(alice);
        if (id < 1024 && value == land.priceOf(id % 1024) && id < 1024) {
            land.buy{value: value}(id);
            assertEq(land.ownerOf(id), alice);
        } else {
            vm.expectRevert();
            land.buy{value: value}(id);
        }
    }

    // ---- accrual ----

    function test_claimableZeroAtBuy() public {
        _buy(alice, 5);
        assertEq(land.claimable(5), 0);
    }

    function test_claimableZeroUnminted() public view {
        assertEq(land.claimable(5), 0);
    }

    function test_accrualExactAfterYear() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 expected =
            land.priceOf(5) * land.apyBpsOf(5) * 365 days * rates[land.tokenIndexOf(5)] / (10_000 * 365 days * 1e18);
        assertEq(land.claimable(5), expected);
        assertGt(expected, 0);
    }

    function test_accrualMonotonic() public {
        _buy(alice, 5);
        uint256 prev;
        for (uint256 i = 1; i <= 5; i++) {
            vm.warp(block.timestamp + 30 days);
            uint256 c = land.claimable(5);
            assertGe(c, prev);
            prev = c;
        }
    }

    function test_accrualOverflowHeadroom() public pure {
        // documented worst case: price 5e15, apy 580, 100 years, rate 3e19
        uint256 product = 5e15 * 580 * (100 * 365 days) * 3e19;
        assertLt(product, type(uint256).max / 1e6);
    }

    // ---- claim ----

    function test_claim() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 acc = land.claimable(5);
        IERC20 tok = IERC20(address(stocks[land.tokenIndexOf(5)]));
        vm.prank(alice);
        land.claim(5);
        assertEq(tok.balanceOf(alice), acc);
        assertEq(land.claimable(5), 0);
        assertEq(land.owed(5), 0);
    }

    function test_claimNotOwnerReverts() public {
        _buy(alice, 5);
        vm.prank(bob);
        vm.expectRevert(UtopiaLand.NotPlotOwner.selector);
        land.claim(5);
    }

    function test_claimUnmintedReverts() public {
        vm.prank(alice);
        vm.expectRevert(UtopiaLand.NotMinted.selector);
        land.claim(5);
    }

    function test_claimDryTreasuryCarriesOwed() public {
        _buy(alice, 5);
        uint256 idx = land.tokenIndexOf(5);
        // drain treasury to a sliver
        vm.prank(land.owner());
        land.rescueTokens(IERC20(address(stocks[idx])), bob, 50e18 - 3);

        vm.warp(block.timestamp + 365 days);
        uint256 acc = land.claimable(5);
        assertGt(acc, 3);

        vm.prank(alice);
        land.claim(5);
        assertEq(stocks[idx].balanceOf(alice), 3);
        assertEq(land.owed(5), acc - 3);
        assertEq(land.claimable(5), acc - 3);

        // top up, claim the remainder
        stocks[idx].mint(address(land), 100e18);
        vm.prank(alice);
        land.claim(5);
        assertEq(stocks[idx].balanceOf(alice), acc);
        assertEq(land.owed(5), 0);
    }

    function test_claimMany() public {
        // find two plots with different tokens
        uint256 a = 0;
        uint256 b = 1;
        while (land.tokenIndexOf(b) == land.tokenIndexOf(a)) b++;
        _buy(alice, a);
        _buy(alice, b);
        vm.warp(block.timestamp + 100 days);
        uint256 ca = land.claimable(a);
        uint256 cb = land.claimable(b);
        uint256[] memory ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
        vm.prank(alice);
        land.claimMany(ids);
        assertEq(stocks[land.tokenIndexOf(a)].balanceOf(alice), ca);
        assertEq(stocks[land.tokenIndexOf(b)].balanceOf(alice), cb);
    }

    function test_yieldStaysWithDeed() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 365 days);
        uint256 accBefore = land.claimable(5);
        vm.prank(alice);
        land.transferFrom(alice, bob, 5);
        // accrual did not checkpoint on transfer: bob can claim it all
        assertEq(land.claimable(5), accBefore);
        vm.prank(bob);
        land.claim(5);
        assertEq(stocks[land.tokenIndexOf(5)].balanceOf(bob), accBefore);
        vm.prank(alice);
        vm.expectRevert(UtopiaLand.NotPlotOwner.selector);
        land.claim(5);
    }

    // ---- bitmaps / packing ----

    function test_bitmaps() public {
        uint256[5] memory ids = [uint256(0), 31, 255, 256, 1023];
        for (uint256 i = 0; i < ids.length; i++) {
            _buy(i % 2 == 0 ? alice : bob, ids[i]);
        }
        uint256[4] memory all = land.ownershipBitmap();
        uint256[4] memory al = land.plotsOf(alice);
        for (uint256 id = 0; id < 1024; id++) {
            bool minted = (all[id >> 8] >> (id & 255)) & 1 == 1;
            bool isAlice = (al[id >> 8] >> (id & 255)) & 1 == 1;
            bool shouldMint = id == 0 || id == 31 || id == 255 || id == 256 || id == 1023;
            bool shouldAlice = id == 0 || id == 255 || id == 1023;
            assertEq(minted, shouldMint);
            assertEq(isAlice, shouldAlice);
        }
    }

    function test_plotsPacked() public view {
        uint256[1024] memory packed = land.plotsPacked();
        for (uint256 id = 0; id < 1024; id += 37) {
            assertEq(packed[id] & ((1 << 128) - 1), land.priceOf(id));
            assertEq((packed[id] >> 128) & 0xffff, land.apyBpsOf(id));
            assertEq(packed[id] >> 144, land.tokenIndexOf(id));
        }
    }

    function test_plotInfo() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 10 days);
        (uint256 price, uint256 apy, address tok, address owner_, uint256 c) = land.plotInfo(5);
        assertEq(price, land.priceOf(5));
        assertEq(apy, land.apyBpsOf(5));
        assertEq(tok, address(stocks[land.tokenIndexOf(5)]));
        assertEq(owner_, alice);
        assertEq(c, land.claimable(5));
    }

    // ---- admin ----

    function test_withdrawEth() public {
        _buy(alice, 5);
        uint256 p = land.priceOf(5);
        address to = makeAddr("sink");
        vm.prank(land.owner());
        land.withdrawEth(payable(to));
        assertEq(to.balance, p);
    }

    function test_adminAuth() public {
        vm.startPrank(alice);
        vm.expectRevert();
        land.withdrawEth(payable(alice));
        vm.expectRevert();
        land.rescueTokens(IERC20(address(stocks[0])), alice, 1);
        vm.stopPrank();
    }

    // ---- helpers ----

    function _buy(address who, uint256 id) internal {
        uint256 p = land.priceOf(id); // fetched first: an external call in the
        vm.prank(who); //                buy args would consume the prank
        land.buy{value: p}(id);
    }
}
