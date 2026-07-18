// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandMainnet} from "../src/UtopiaLandMainnet.sol";

contract MainnetMockStock is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UtopiaLandMainnetTest is Test {
    UtopiaLandMainnet internal land;
    UtopiaEligibility internal registry;
    MainnetMockStock[5] internal stocks;
    uint256[5] internal rates = [uint256(9e18), 15e18, 22e18, 8e18, 17e18];

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal charlie = makeAddr("charlie");
    address internal multisig = makeAddr("multisig");
    uint64 internal end;

    function setUp() public {
        vm.warp(1_800_000_000);
        end = uint64(block.timestamp + 365 days);
        registry = new UtopiaEligibility(address(this));

        IERC20[5] memory tokens;
        string[5] memory symbols = ["TSLA", "AAPL", "NVDA", "MSFT", "AMZN"];
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new MainnetMockStock(symbols[i]);
            tokens[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandMainnet(tokens, rates, IUtopiaEligibility(address(registry)), end, multisig);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 100e18);
        }

        registry.setEligibility(alice, end + 30 days);
        registry.setEligibility(bob, end + 30 days);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _buy(address who, uint256 id) internal {
        uint256 price = land.priceOf(id);
        vm.prank(who);
        land.buy{value: price}(id);
    }

    function test_constructorSetsMultisigOwnerAndFiniteWindow() public view {
        assertEq(land.owner(), multisig);
        assertEq(land.rewardEnd(), end);
        assertEq(address(land.eligibilityRegistry()), address(registry));
    }

    function test_buyRequiresEligibility() public {
        vm.deal(charlie, 1 ether);
        uint256 price = land.priceOf(5);
        vm.prank(charlie);
        vm.expectRevert(UtopiaLandMainnet.NotEligible.selector);
        land.buy{value: price}(5);
    }

    function test_buyRequiresExactPayment() public {
        uint256 price = land.priceOf(5);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandMainnet.WrongPayment.selector);
        land.buy{value: price - 1}(5);
    }

    function test_buyReservesFullRewardAndUpdatesBitmaps() public {
        uint256 expected = land.maxRewardForSale(5);
        uint256 idx = land.tokenIndexOf(5);
        _buy(alice, 5);

        assertEq(land.ownerOf(5), alice);
        assertEq(land.reserveCommitment(5), expected);
        assertEq(land.totalCommittedByToken(idx), expected);
        uint256[4] memory allPlots = land.ownershipBitmap();
        uint256[4] memory alicePlots = land.plotsOf(alice);
        assertEq((allPlots[0] >> 5) & 1, 1);
        assertEq((alicePlots[0] >> 5) & 1, 1);
    }

    function test_underfundedRewardTokenBlocksSale() public {
        uint256 id = 5;
        uint256 idx = land.tokenIndexOf(id);
        uint256 required = land.maxRewardForSale(id);
        uint256 balance = stocks[idx].balanceOf(address(land));

        vm.prank(multisig);
        land.withdrawSurplusStock(idx, multisig, balance - required + 1);

        uint256 price = land.priceOf(id);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(UtopiaLandMainnet.InsufficientReserve.selector, idx, required, required - 1)
        );
        land.buy{value: price}(id);
    }

    function test_claimPaysAndReleasesEqualCommitmentBeforeEnd() public {
        uint256 id = 5;
        uint256 idx = land.tokenIndexOf(id);
        _buy(alice, id);
        uint256 commitmentBefore = land.reserveCommitment(id);
        uint256 balanceBefore = stocks[idx].balanceOf(address(land));
        vm.warp(block.timestamp + 30 days);
        uint256 expected = land.claimable(id);

        vm.prank(alice);
        land.claim(id);

        assertEq(stocks[idx].balanceOf(alice), expected);
        assertEq(stocks[idx].balanceOf(address(land)), balanceBefore - expected);
        assertEq(land.reserveCommitment(id), commitmentBefore - expected);
        assertEq(land.totalCommittedByToken(idx), commitmentBefore - expected);
        assertEq(land.claimable(id), 0);
        assertEq(land.totalOwedByToken(idx), 0);
    }

    function test_finalClaimStopsAccrualAndReleasesRoundingSurplus() public {
        uint256 id = 5;
        uint256 idx = land.tokenIndexOf(id);
        _buy(alice, id);
        vm.warp(end + 1 days);
        uint256 expected = land.claimable(id);

        vm.prank(alice);
        land.claim(id);

        assertEq(stocks[idx].balanceOf(alice), expected);
        assertEq(land.reserveCommitment(id), 0);
        assertEq(land.totalCommittedByToken(idx), 0);
        vm.warp(block.timestamp + 365 days);
        assertEq(land.claimable(id), 0);
    }

    function test_committedStockCannotBeWithdrawn() public {
        uint256 id = 5;
        uint256 idx = land.tokenIndexOf(id);
        _buy(alice, id);
        uint256 surplus = land.reserveAvailable(idx);

        vm.prank(multisig);
        vm.expectRevert(UtopiaLandMainnet.InsufficientSurplus.selector);
        land.withdrawSurplusStock(idx, multisig, surplus + 1);

        vm.prank(multisig);
        land.withdrawSurplusStock(idx, multisig, surplus);
        assertEq(stocks[idx].balanceOf(address(land)), land.totalCommittedByToken(idx));
    }

    function test_transferMovesBitmapAndRequiresEligibleRecipient() public {
        _buy(alice, 5);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandMainnet.NotEligible.selector);
        land.transferFrom(alice, charlie, 5);

        vm.prank(alice);
        land.transferFrom(alice, bob, 5);
        assertEq(land.ownerOf(5), bob);
        uint256[4] memory alicePlots = land.plotsOf(alice);
        uint256[4] memory bobPlots = land.plotsOf(bob);
        assertEq((alicePlots[0] >> 5) & 1, 0);
        assertEq((bobPlots[0] >> 5) & 1, 1);
    }

    function test_accruedRewardFollowsTheDeed() public {
        _buy(alice, 5);
        vm.warp(block.timestamp + 30 days);
        uint256 expected = land.claimable(5);
        vm.prank(alice);
        land.transferFrom(alice, bob, 5);
        vm.prank(bob);
        land.claim(5);
        assertEq(stocks[land.tokenIndexOf(5)].balanceOf(bob), expected);
    }

    function test_expiredEligibilityBlocksClaim() public {
        registry.setEligibility(alice, uint64(block.timestamp + 1 days));
        _buy(alice, 5);
        vm.warp(block.timestamp + 2 days);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandMainnet.NotEligible.selector);
        land.claim(5);
    }

    function test_programEndBlocksNewSales() public {
        vm.warp(end);
        uint256 price = land.priceOf(5);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandMainnet.ProgramEnded.selector);
        land.buy{value: price}(5);
    }

    function test_claimManyIsBounded() public {
        uint256[] memory ids = new uint256[](65);
        vm.prank(alice);
        vm.expectRevert(UtopiaLandMainnet.BatchTooLarge.selector);
        land.claimMany(ids);
    }

    function test_openPlotReserveQuoteIsCovered() public view {
        uint256[5] memory requirements = land.reserveRequiredForAllOpenPlots();
        for (uint256 i = 0; i < 5; i++) {
            assertGt(requirements[i], 0);
            assertGe(stocks[i].balanceOf(address(land)), requirements[i]);
        }
    }

    function test_onlyMultisigCanWithdrawEth() public {
        _buy(alice, 5);
        uint256 amount = address(land).balance;
        vm.prank(alice);
        vm.expectRevert();
        land.withdrawEth(payable(alice), amount);

        uint256 before = multisig.balance;
        vm.prank(multisig);
        land.withdrawEth(payable(multisig), amount);
        assertEq(multisig.balance, before + amount);
    }

    function testFuzz_soldPlotNeverCreatesUnbackedCommitment(uint256 rawId) public {
        uint256 id = bound(rawId, 0, 1023);
        uint256 idx = land.tokenIndexOf(id);
        _buy(alice, id);
        assertGe(stocks[idx].balanceOf(address(land)), land.totalCommittedByToken(idx));
    }
}

contract UtopiaEligibilityTest is Test {
    UtopiaEligibility internal registry;
    address internal alice = makeAddr("alice");
    address internal multisig = makeAddr("multisig");

    function setUp() public {
        vm.warp(1_800_000_000);
        registry = new UtopiaEligibility(multisig);
    }

    function test_onlyOwnerCanRecordAndRevokeEligibility() public {
        vm.expectRevert();
        registry.setEligibility(alice, uint64(block.timestamp + 1 days));

        vm.prank(multisig);
        registry.setEligibility(alice, uint64(block.timestamp + 1 days));
        assertTrue(registry.isEligible(alice));

        vm.prank(multisig);
        registry.setEligibility(alice, 0);
        assertFalse(registry.isEligible(alice));
    }

    function test_batchIsBounded() public {
        address[] memory accounts = new address[](201);
        uint64[] memory expiries = new uint64[](201);
        vm.prank(multisig);
        vm.expectRevert(UtopiaEligibility.BatchTooLarge.selector);
        registry.setEligibilityMany(accounts, expiries);
    }
}
