// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaMarketplace} from "../src/UtopiaMarketplace.sol";
import {UtopiaLandCity} from "../src/UtopiaLandCity.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStock is ERC20 {
    constructor() ERC20("STK", "STK") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract UtopiaMarketplaceTest is Test {
    UtopiaLandCity land;
    UtopiaEligibility reg;
    UtopiaMarketplace market;
    MockStock[5] stocks;
    uint256[5] rates = [uint256(2e17), 3e17, 4e17, 2e17, 3e17];

    address safe = makeAddr("safe");
    address alice = makeAddr("alice"); // seller
    address bob = makeAddr("bob"); // buyer
    address carol = makeAddr("carol"); // ineligible

    uint256 plot; // a plot alice owns
    uint256 price = 0.05 ether;

    function setUp() public {
        reg = new UtopiaEligibility(address(this));
        IERC20[5] memory toks;
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new MockStock();
            toks[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandCity(
            toks, rates, IUtopiaEligibility(address(reg)), uint64(block.timestamp + 90 days), address(this), 5
        );
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 100e18);
        }
        market = new UtopiaMarketplace(address(land), 300, safe, address(this)); // 3% fee

        reg.setEligibility(alice, uint64(block.timestamp + 30 days));
        reg.setEligibility(bob, uint64(block.timestamp + 30 days));
        // alice buys a center (NVDA-funded) plot to own it
        plot = 16 * 32 + 16;
        uint256 p = land.priceOf(plot); // read before prank so prank applies to buy
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        land.buy{value: p}(plot);
    }

    function _listAsAlice() internal {
        vm.startPrank(alice);
        land.setApprovalForAll(address(market), true);
        market.list(plot, price);
        vm.stopPrank();
    }

    function test_listRequiresOwnership() public {
        vm.prank(bob);
        vm.expectRevert(UtopiaMarketplace.NotOwner.selector);
        market.list(plot, price);
    }

    function test_listRequiresApproval() public {
        vm.prank(alice);
        vm.expectRevert(UtopiaMarketplace.NotApproved.selector);
        market.list(plot, price);
    }

    function test_listAndBuyTransfersDeedAndPaysWithFee() public {
        _listAsAlice();
        assertTrue(market.isListingValid(plot));

        vm.deal(bob, 1 ether);
        uint256 aliceBefore = alice.balance;
        vm.prank(bob);
        market.buy{value: price}(plot);

        // deed moved to buyer
        assertEq(land.ownerOf(plot), bob);
        // 3% fee held by market, 97% to seller
        uint256 fee = (price * 300) / 10_000;
        assertEq(market.accruedFees(), fee);
        assertEq(alice.balance, aliceBefore + price - fee);
        // listing cleared
        assertFalse(market.isListingValid(plot));
    }

    function test_buyerMustBeEligible() public {
        _listAsAlice();
        vm.deal(carol, 1 ether);
        vm.prank(carol);
        vm.expectRevert(UtopiaMarketplace.BuyerNotEligible.selector);
        market.buy{value: price}(plot);
    }

    function test_wrongPaymentReverts() public {
        _listAsAlice();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(UtopiaMarketplace.WrongPayment.selector);
        market.buy{value: price - 1}(plot);
    }

    function test_cannotBuyOwnListing() public {
        _listAsAlice();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UtopiaMarketplace.SelfBuy.selector);
        market.buy{value: price}(plot);
    }

    function test_cancelPreventsBuy() public {
        _listAsAlice();
        vm.prank(alice);
        market.cancel(plot);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(UtopiaMarketplace.NotListed.selector);
        market.buy{value: price}(plot);
    }

    function test_staleListingIfSellerMovedPlot() public {
        _listAsAlice();
        // alice transfers the plot away, invalidating the listing
        vm.prank(alice);
        land.transferFrom(alice, bob, plot);
        assertFalse(market.isListingValid(plot));
        // a buy now reverts (seller no longer owns it)
        address dave = makeAddr("dave");
        reg.setEligibility(dave, uint64(block.timestamp + 30 days));
        vm.deal(dave, 1 ether);
        vm.prank(dave);
        vm.expectRevert(UtopiaMarketplace.NotListed.selector);
        market.buy{value: price}(plot);
    }

    function test_rewardsRideWithDeedOnResale() public {
        _listAsAlice();
        // let rewards accrue, then sell; the buyer inherits the accrued claim
        vm.warp(block.timestamp + 30 days);
        uint256 owed = land.claimable(plot);
        assertGt(owed, 0);
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        market.buy{value: price}(plot);
        // accrued rewards did not reset on transfer; new owner can claim them
        assertEq(land.claimable(plot), owed);
    }

    function test_feeWithdrawGoesToRecipient() public {
        _listAsAlice();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        market.buy{value: price}(plot);
        uint256 fee = (price * 300) / 10_000;
        uint256 safeBefore = safe.balance;
        market.withdrawFees();
        assertEq(safe.balance, safeBefore + fee);
        assertEq(market.accruedFees(), 0);
    }

    function test_feeCappedAtDeploy() public {
        vm.expectRevert(UtopiaMarketplace.FeeTooHigh.selector);
        new UtopiaMarketplace(address(land), 1_001, safe, address(this));
    }

    function test_ownerCannotSetExcessiveFee() public {
        vm.expectRevert(UtopiaMarketplace.FeeTooHigh.selector);
        market.setFee(2_000, safe);
    }
}
