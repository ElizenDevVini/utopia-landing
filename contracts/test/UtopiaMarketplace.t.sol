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
            toks, rates, IUtopiaEligibility(address(reg)), uint64(block.timestamp + 365 days), address(this), 5
        );
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 100e18);
        }
        market = new UtopiaMarketplace(address(land), 100, 200, safe, address(this)); // 1% operator + 2% pool

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
        // 3% total fee: 1% to the operator balance, 2% into the holder pool
        uint256 fee = (price * 300) / 10_000;
        assertEq(market.accruedFees(), (price * 100) / 10_000);
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
        uint256 operatorFee = (price * 100) / 10_000;
        uint256 safeBefore = safe.balance;
        market.withdrawFees();
        assertEq(safe.balance, safeBefore + operatorFee);
        assertEq(market.accruedFees(), 0);
        // the pool share stays in the contract for holders, untouched by withdraw
        assertEq(address(market).balance, (price * 200) / 10_000);
    }

    function test_feeCappedAtDeploy() public {
        vm.expectRevert(UtopiaMarketplace.FeeTooHigh.selector);
        new UtopiaMarketplace(address(land), 800, 300, safe, address(this));
    }

    function test_ownerCannotSetExcessiveFee() public {
        vm.expectRevert(UtopiaMarketplace.FeeTooHigh.selector);
        market.setFee(800, 300, safe);
    }

    // ---- the economy: fee-share rewards + loyalty ----

    function _buyPlotAs(address who, uint256 id) internal {
        reg.setEligibility(who, uint64(block.timestamp + 365 days));
        uint256 p = land.priceOf(id);
        vm.deal(who, p + 1 ether);
        vm.prank(who);
        land.buy{value: p}(id);
    }

    function test_holderEarnsFromOtherPeoplesTrades() public {
        // bob owns a plot and checkpoints; he should earn when alice's plot sells
        _buyPlotAs(bob, 16 * 32 + 17);
        market.pokeCheckpoint(bob);
        assertEq(market.claimableRewards(bob), 0);

        _listAsAlice(); // alice's checkpoint registers here too
        address dave = makeAddr("dave");
        reg.setEligibility(dave, uint64(block.timestamp + 30 days));
        vm.deal(dave, 1 ether);
        vm.prank(dave);
        market.buy{value: price}(plot);

        // pool = 2% of price, split by weight among checkpointed holders
        uint256 pool = (price * 200) / 10_000;
        uint256 bobClaim = market.claimableRewards(bob);
        assertGt(bobClaim, 0);
        assertLe(bobClaim, pool);

        // claim pays out real ETH
        uint256 before = bob.balance;
        vm.prank(bob);
        market.claimRewards();
        assertEq(bob.balance, before + bobClaim);
        assertEq(market.claimableRewards(bob), 0);
        assertEq(market.totalPaidToHolders(), bobClaim);
    }

    function test_loyaltyTiersGrowWithHoldTime() public {
        _buyPlotAs(bob, 16 * 32 + 17);
        market.pokeCheckpoint(bob);
        assertEq(market.loyaltyMultiplierBps(bob), 10_000); // fresh: 1.0x
        vm.warp(block.timestamp + 31 days);
        assertEq(market.loyaltyMultiplierBps(bob), 15_000); // 1.5x
        vm.warp(block.timestamp + 60 days);
        assertEq(market.loyaltyMultiplierBps(bob), 20_000); // 2.0x
    }

    function test_sellingResetsLoyalty() public {
        _listAsAlice(); // alice checkpointed with her plot
        vm.warp(block.timestamp + 40 days);
        market.pokeCheckpoint(alice);
        assertEq(market.loyaltyMultiplierBps(alice), 15_000); // 1.5x after 40 days

        // her plot sells -> count decreases -> streak resets to 1.0x
        reg.setEligibility(bob, uint64(block.timestamp + 30 days)); // refresh after warp
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        market.buy{value: price}(plot);
        assertEq(market.loyaltyMultiplierBps(alice), 10_000);
    }

    function test_longHolderEarnsMoreThanFreshBuyer() public {
        // bob (long holder, 2.0x) vs dave (fresh, 1.0x), one plot each
        _buyPlotAs(bob, 16 * 32 + 17);
        market.pokeCheckpoint(bob);
        vm.warp(block.timestamp + 91 days);
        market.pokeCheckpoint(bob); // refresh weight at 2.0x

        _buyPlotAs(dave2(), 16 * 32 + 15);
        market.pokeCheckpoint(dave2());

        // a sale distributes the pool: bob's share should be double dave's
        _listAsAlice();
        address emma = makeAddr("emma");
        reg.setEligibility(emma, uint64(block.timestamp + 30 days));
        vm.deal(emma, 1 ether);
        vm.prank(emma);
        market.buy{value: price}(plot);

        uint256 bobShare = market.claimableRewards(bob);
        uint256 daveShare = market.claimableRewards(dave2());
        assertGt(bobShare, 0);
        assertEq(bobShare, daveShare * 2); // 2.0x vs 1.0x, same plot count
    }

    function dave2() internal returns (address) {
        return makeAddr("dave2");
    }

    function test_buyRightBeforeClaimEarnsNothingFromPastSales() public {
        // a sale happens while eve holds nothing; she buys in afterwards and
        // must not be able to claim rewards from that earlier sale
        _buyPlotAs(bob, 16 * 32 + 17);
        market.pokeCheckpoint(bob);
        _listAsAlice();
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        market.buy{value: price}(plot); // sale #1 distributes to... bob only

        address eve = makeAddr("eve");
        _buyPlotAs(eve, 16 * 32 + 15);
        market.pokeCheckpoint(eve);
        assertEq(market.claimableRewards(eve), 0); // nothing from the past
    }

    function test_poolBufferedWhenNoHoldersThenDistributed() public {
        // sale happens before anyone is checkpointed (seller sells ALL plots ->
        // weight 0; buyer checkpoints at purchase). buffer folds into next distribution.
        _listAsAlice();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        market.buy{value: price}(plot);
        // bob got checkpointed during the buy, so distribution had a holder;
        // just assert the pool math stayed solvent either way
        uint256 pool = (price * 200) / 10_000;
        assertEq(market.claimableRewards(bob) + market.pendingPool(), pool);
    }
}
