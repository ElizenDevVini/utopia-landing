// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UtopiaBoost} from "../src/UtopiaBoost.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandMainnet} from "../src/UtopiaLandMainnet.sol";

contract BoostMockToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UtopiaBoostTest is Test {
    UtopiaLandMainnet internal land;
    UtopiaEligibility internal registry;
    UtopiaBoost internal boost;
    BoostMockToken[5] internal stocks;
    BoostMockToken internal utopia;
    uint256[5] internal rates = [uint256(9e18), 15e18, 22e18, 8e18, 17e18];

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal charlie = makeAddr("charlie");
    address internal multisig = makeAddr("multisig");
    uint256 internal constant HALF_SATURATION = 100e18;
    uint256 internal constant ID = 5;
    uint64 internal landEnd;
    uint64 internal end;

    function setUp() public {
        vm.warp(1_800_000_000);
        landEnd = uint64(block.timestamp + 365 days);
        end = uint64(block.timestamp + 180 days);
        registry = new UtopiaEligibility(address(this));

        IERC20[5] memory tokens;
        string[5] memory symbols = ["TSLA", "AAPL", "NVDA", "MSFT", "AMZN"];
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new BoostMockToken(symbols[i]);
            tokens[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandMainnet(tokens, rates, IUtopiaEligibility(address(registry)), landEnd, multisig);
        utopia = new BoostMockToken("UTOPIA");
        boost = new UtopiaBoost(land, IERC20(address(utopia)), HALF_SATURATION, end, multisig);

        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 100e18);
            stocks[i].mint(address(boost), 1_000e18);
        }
        utopia.mint(alice, 1_000e18);
        utopia.mint(bob, 1_000e18);

        registry.setEligibility(alice, landEnd + 30 days);
        registry.setEligibility(bob, landEnd + 30 days);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        _buy(alice, ID);

        vm.prank(alice);
        utopia.approve(address(boost), type(uint256).max);
        vm.prank(bob);
        utopia.approve(address(boost), type(uint256).max);
    }

    function _buy(address who, uint256 id) internal {
        uint256 price = land.priceOf(id);
        vm.prank(who);
        land.buy{value: price}(id);
    }

    function _factor(uint256 locked) internal pure returns (uint256) {
        return Math.mulDiv(3e18, locked, locked + HALF_SATURATION);
    }

    function _baseBetween(uint256 id, uint256 start, uint256 finish) internal view returns (uint256) {
        if (finish <= start) return 0;
        uint256 annualizedEth = Math.mulDiv(land.priceOf(id), land.apyBpsOf(id) * (finish - start), 10_000 * 365 days);
        return Math.mulDiv(annualizedEth, rates[land.tokenIndexOf(id)], 1e18);
    }

    function _assertBacked(uint256 idx) internal view {
        assertGe(stocks[idx].balanceOf(address(boost)), boost.totalCommittedByToken(idx) + boost.totalOwedByToken(idx));
    }

    function test_constructorRejectsEveryInvalidConfigClause() public {
        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(UtopiaLandMainnet(address(0)), IERC20(address(utopia)), HALF_SATURATION, end, multisig);

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(
            UtopiaLandMainnet(makeAddr("codelessLand")), IERC20(address(utopia)), HALF_SATURATION, end, multisig
        );

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, IERC20(address(0)), HALF_SATURATION, end, multisig);

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, IERC20(makeAddr("codelessUtopia")), HALF_SATURATION, end, multisig);

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, IERC20(address(utopia)), 0, end, multisig);

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, IERC20(address(utopia)), HALF_SATURATION, uint64(block.timestamp + 30 days - 1), multisig);

        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, IERC20(address(utopia)), HALF_SATURATION, landEnd + 1, multisig);
    }

    function test_constructorRejectsUtopiaThatAliasesRewardStock() public {
        IERC20 aliasedUtopia = IERC20(address(stocks[land.tokenIndexOf(ID)]));
        vm.expectRevert(UtopiaBoost.InvalidConfig.selector);
        new UtopiaBoost(land, aliasedUtopia, HALF_SATURATION, end, multisig);
    }

    function test_constructorCachesConfigAndStocks() public view {
        assertEq(address(boost.land()), address(land));
        assertEq(address(boost.utopia()), address(utopia));
        assertEq(boost.halfSaturation(), HALF_SATURATION);
        assertEq(boost.boostEnd(), end);
        assertEq(boost.owner(), multisig);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(address(boost.tokens(i)), address(stocks[i]));
        }
    }

    function test_stakeUsesHandComputedFactorAndCommitment() public {
        uint256 amount = 50e18;
        uint256 start = block.timestamp;
        uint256 factor = _factor(amount);
        uint256 expectedCommitment = Math.mulDiv(_baseBetween(ID, start, end), factor, 1e18);
        uint256 idx = land.tokenIndexOf(ID);

        vm.prank(alice);
        boost.stake(ID, amount);

        (address staker, uint256 locked, uint256 factorWad, uint256 accrued, uint256 commitment) = boost.positionOf(ID);
        assertEq(staker, alice);
        assertEq(locked, amount);
        assertEq(factorWad, factor);
        assertEq(accrued, 0);
        assertEq(commitment, expectedCommitment);
        assertEq(boost.previewFactorWad(amount), factor);
        assertLt(factor, boost.MAX_BOOST_WAD());
        assertEq(boost.totalCommittedByToken(idx), expectedCommitment);
        assertEq(boost.totalOwedByToken(idx), 0);
        assertEq(utopia.balanceOf(address(boost)), amount);
        assertEq(utopia.balanceOf(alice), 1_000e18 - amount);
        _assertBacked(idx);
    }

    function test_stakeCreditsExactlyTheTransferredAmount() public {
        uint256 amount = 37e18;
        uint256 before = utopia.balanceOf(address(boost));

        vm.prank(alice);
        boost.stake(ID, amount);

        (, uint256 locked,,,) = boost.positionOf(ID);
        assertEq(locked, utopia.balanceOf(address(boost)) - before);
        assertEq(locked, amount);
    }

    function test_stakeRevertsForNonOwner() public {
        vm.prank(bob);
        vm.expectRevert(UtopiaBoost.NotPlotOwner.selector);
        boost.stake(ID, 1e18);
    }

    function test_stakeRevertsWhenPositionIsOccupiedByPriorOwner() public {
        vm.prank(alice);
        boost.stake(ID, 10e18);
        vm.prank(alice);
        land.transferFrom(alice, bob, ID);

        vm.prank(bob);
        vm.expectRevert(UtopiaBoost.PositionOccupied.selector);
        boost.stake(ID, 1e18);
    }

    function test_stakeRevertsAfterBoostEnd() public {
        vm.warp(end);
        vm.prank(alice);
        vm.expectRevert(UtopiaBoost.ProgramEnded.selector);
        boost.stake(ID, 1e18);
    }

    function test_stakeRevertsWhenReserveIsInsufficient() public {
        uint256 amount = 50e18;
        uint256 idx = land.tokenIndexOf(ID);
        uint256 required = Math.mulDiv(_baseBetween(ID, block.timestamp, end), _factor(amount), 1e18);
        uint256 available = boost.reserveAvailable(idx);

        vm.prank(multisig);
        boost.withdrawSurplusStock(idx, multisig, available - required + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(UtopiaBoost.InsufficientReserve.selector, idx, required, required - 1));
        boost.stake(ID, amount);
    }

    function test_stakeRevertsForZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(UtopiaBoost.ZeroAmount.selector);
        boost.stake(ID, 0);
    }

    function test_claimBoostPaysExactAccrualAndUpdatesAccounting() public {
        uint256 amount = 50e18;
        uint256 start = block.timestamp;
        uint256 idx = land.tokenIndexOf(ID);
        uint256 factor = _factor(amount);
        uint256 initialCommitment = Math.mulDiv(_baseBetween(ID, start, end), factor, 1e18);
        vm.prank(alice);
        boost.stake(ID, amount);

        vm.warp(start + 30 days);
        uint256 remainingCommitment = Math.mulDiv(_baseBetween(ID, block.timestamp, end), factor, 1e18);
        uint256 expected = initialCommitment - remainingCommitment;
        assertEq(boost.totalCommittedByToken(idx), initialCommitment);
        assertEq(boost.totalOwedByToken(idx), 0);
        (,,, uint256 pendingBeforeClaim, uint256 commitmentBeforeClaim) = boost.positionOf(ID);
        assertEq(pendingBeforeClaim, expected);
        assertEq(commitmentBeforeClaim, initialCommitment);
        uint256 stockBefore = stocks[idx].balanceOf(address(boost));

        vm.prank(alice);
        boost.claimBoost(ID);

        assertEq(stocks[idx].balanceOf(alice), expected);
        assertEq(stocks[idx].balanceOf(address(boost)), stockBefore - expected);
        assertEq(boost.totalCommittedByToken(idx), initialCommitment - expected);
        assertEq(boost.totalOwedByToken(idx), 0);
        (,,, uint256 accrued,) = boost.positionOf(ID);
        assertEq(accrued, 0);
        _assertBacked(idx);
    }

    function test_addingStakeUsesOldThenNewFactor() public {
        uint256 firstAmount = 40e18;
        uint256 addedAmount = 60e18;
        uint256 start = block.timestamp;
        uint256 firstFactor = _factor(firstAmount);
        uint256 newFactor = _factor(firstAmount + addedAmount);
        uint256 idx = land.tokenIndexOf(ID);
        vm.prank(alice);
        boost.stake(ID, firstAmount);

        uint256 addTime = start + 20 days;
        vm.warp(addTime);
        uint256 firstCommitment = Math.mulDiv(_baseBetween(ID, start, end), firstFactor, 1e18);
        uint256 firstSegment = firstCommitment - Math.mulDiv(_baseBetween(ID, addTime, end), firstFactor, 1e18);
        vm.prank(alice);
        boost.stake(ID, addedAmount);

        (,, uint256 factorAfterAdd, uint256 accruedAfterAdd, uint256 commitmentAfterAdd) = boost.positionOf(ID);
        uint256 expectedCommitment = Math.mulDiv(_baseBetween(ID, addTime, end), newFactor, 1e18);
        assertEq(factorAfterAdd, newFactor);
        assertEq(accruedAfterAdd, firstSegment);
        assertEq(commitmentAfterAdd, expectedCommitment);
        assertEq(boost.totalOwedByToken(idx), firstSegment);
        assertEq(boost.totalCommittedByToken(idx), expectedCommitment);

        uint256 claimTime = addTime + 25 days;
        vm.warp(claimTime);
        uint256 secondSegment = expectedCommitment - Math.mulDiv(_baseBetween(ID, claimTime, end), newFactor, 1e18);
        vm.prank(alice);
        boost.claimBoost(ID);

        assertEq(stocks[idx].balanceOf(alice), firstSegment + secondSegment);
        assertEq(boost.totalOwedByToken(idx), 0);
        assertEq(boost.totalCommittedByToken(idx), expectedCommitment - secondSegment);
        _assertBacked(idx);
    }

    function test_partialAndFullUnstakeDropFactorReleaseCommitmentAndReturnPrincipal() public {
        uint256 start = block.timestamp;
        uint256 idx = land.tokenIndexOf(ID);
        vm.prank(alice);
        boost.stake(ID, 100e18);

        vm.warp(start + 15 days);
        {
            uint256 balanceBeforePartial = utopia.balanceOf(alice);
            uint256 expectedFactor = _factor(60e18);
            uint256 expectedCommitment = Math.mulDiv(_baseBetween(ID, block.timestamp, end), expectedFactor, 1e18);
            uint256 initialCommitment = Math.mulDiv(_baseBetween(ID, start, end), _factor(100e18), 1e18);
            uint256 expectedOwed =
                initialCommitment - Math.mulDiv(_baseBetween(ID, block.timestamp, end), _factor(100e18), 1e18);
            vm.prank(alice);
            boost.unstake(ID, 40e18);

            (address staker, uint256 locked, uint256 factorWad, uint256 accrued, uint256 commitment) =
                boost.positionOf(ID);
            assertEq(staker, alice);
            assertEq(locked, 60e18);
            assertEq(factorWad, expectedFactor);
            assertEq(accrued, expectedOwed);
            assertEq(commitment, expectedCommitment);
            assertEq(boost.totalOwedByToken(idx), expectedOwed);
            assertEq(boost.totalCommittedByToken(idx), expectedCommitment);
            assertEq(utopia.balanceOf(alice), balanceBeforePartial + 40e18);
            _assertBacked(idx);
        }

        vm.warp(block.timestamp + 10 days);
        vm.prank(alice);
        boost.unstake(ID, 60e18);

        (address finalStaker, uint256 finalLocked, uint256 finalFactor,, uint256 finalCommitment) = boost.positionOf(ID);
        assertEq(finalStaker, address(0));
        assertEq(finalLocked, 0);
        assertEq(finalFactor, 0);
        assertEq(finalCommitment, 0);
        assertEq(boost.totalCommittedByToken(idx), 0);
        assertEq(utopia.balanceOf(alice), 1_000e18);
        _assertBacked(idx);
    }

    function test_plotSaleHandsPotToBuyerAndEvictionReturnsPrincipal() public {
        uint256 amount = 100e18;
        uint256 start = block.timestamp;
        uint256 factor = _factor(amount);
        uint256 idx = land.tokenIndexOf(ID);
        vm.prank(alice);
        boost.stake(ID, amount);

        vm.warp(start + 20 days);
        vm.prank(alice);
        land.transferFrom(alice, bob, ID);
        vm.warp(start + 35 days);
        uint256 expected = Math.mulDiv(_baseBetween(ID, start, block.timestamp), factor, 1e18);

        vm.prank(alice);
        vm.expectRevert(UtopiaBoost.NotPlotOwner.selector);
        boost.claimBoost(ID);

        vm.prank(bob);
        boost.claimBoost(ID);
        assertEq(stocks[idx].balanceOf(bob), expected);

        uint256 aliceBeforeEviction = utopia.balanceOf(alice);
        vm.prank(bob);
        boost.evict(ID);

        (address staker, uint256 locked,,, uint256 commitment) = boost.positionOf(ID);
        assertEq(staker, address(0));
        assertEq(locked, 0);
        assertEq(commitment, 0);
        assertEq(utopia.balanceOf(alice), aliceBeforeEviction + amount);
        assertEq(boost.totalCommittedByToken(idx), 0);
        _assertBacked(idx);
    }

    function test_programEndStopsAccrualAndReleasesAllStock() public {
        uint256 amount = 75e18;
        uint256 start = block.timestamp;
        uint256 idx = land.tokenIndexOf(ID);
        uint256 expected = Math.mulDiv(_baseBetween(ID, start, end), _factor(amount), 1e18);
        vm.prank(alice);
        boost.stake(ID, amount);

        vm.warp(end + 30 days);
        vm.prank(alice);
        boost.claimBoost(ID);

        assertEq(stocks[idx].balanceOf(alice), expected);
        assertEq(boost.totalCommittedByToken(idx), 0);
        assertEq(boost.totalOwedByToken(idx), 0);
        vm.warp(block.timestamp + 365 days);
        (,,, uint256 pending, uint256 commitment) = boost.positionOf(ID);
        assertEq(pending, 0);
        assertEq(commitment, 0);

        vm.prank(alice);
        boost.unstake(ID, amount);
        assertEq(utopia.balanceOf(alice), 1_000e18);

        uint256 surplus = boost.reserveAvailable(idx);
        vm.prank(multisig);
        boost.withdrawSurplusStock(idx, multisig, surplus);
        assertEq(boost.reserveAvailable(idx), stocks[idx].balanceOf(address(boost)));
        assertEq(stocks[idx].balanceOf(address(boost)), 0);
    }

    function test_segmentedClaimsPayTheWholeWindowCommitment() public {
        uint256 amount = 100e18;
        uint256 start = block.timestamp;
        uint256 idx = land.tokenIndexOf(ID);
        vm.prank(alice);
        boost.stake(ID, amount);
        (,,,, uint256 wholeWindowCommitment) = boost.positionOf(ID);

        for (uint256 i = 1; i <= 10; i++) {
            vm.warp(start + i * 1 days);
            vm.prank(alice);
            boost.claimBoost(ID);
        }
        vm.warp(end);
        vm.prank(alice);
        boost.claimBoost(ID);

        assertEq(stocks[idx].balanceOf(alice), wholeWindowCommitment);
        assertEq(boost.totalCommittedByToken(idx), 0);
        assertEq(boost.totalOwedByToken(idx), 0);
    }

    function test_ineligibleOwnerCannotClaimButCanUnstake() public {
        uint256 amount = 25e18;
        vm.prank(alice);
        boost.stake(ID, amount);
        vm.warp(block.timestamp + 10 days);
        registry.setEligibility(alice, 0);

        vm.prank(alice);
        vm.expectRevert(UtopiaBoost.NotEligible.selector);
        boost.claimBoost(ID);

        vm.prank(alice);
        boost.unstake(ID, amount);
        assertEq(utopia.balanceOf(alice), 1_000e18);
        (address staker, uint256 locked,,,) = boost.positionOf(ID);
        assertEq(staker, address(0));
        assertEq(locked, 0);
    }

    function test_claimBoostManyIsBoundedAndZeroClaimsAreNoOps() public {
        uint256[] memory tooMany = new uint256[](65);
        vm.prank(alice);
        vm.expectRevert(UtopiaBoost.BatchTooLarge.selector);
        boost.claimBoostMany(tooMany);

        uint256[] memory one = new uint256[](1);
        one[0] = ID;
        vm.prank(alice);
        boost.claimBoostMany(one);
        assertEq(stocks[land.tokenIndexOf(ID)].balanceOf(alice), 0);
    }

    function test_surplusWithdrawalCannotTouchObligations() public {
        uint256 idx = land.tokenIndexOf(ID);
        vm.prank(alice);
        boost.stake(ID, 100e18);
        uint256 surplus = boost.reserveAvailable(idx);

        vm.prank(multisig);
        vm.expectRevert(UtopiaBoost.InsufficientSurplus.selector);
        boost.withdrawSurplusStock(idx, multisig, surplus + 1);

        vm.prank(multisig);
        boost.withdrawSurplusStock(idx, multisig, surplus);
        assertEq(stocks[idx].balanceOf(address(boost)), boost.totalCommittedByToken(idx) + boost.totalOwedByToken(idx));
    }

    function testFuzz_randomLifecycleStaysBackedAndClearsAccounting(
        uint256 rawAmount,
        uint256 rawWarp,
        uint256 rawPartial
    ) public {
        uint256 amount = bound(rawAmount, 1e12, 500e18);
        uint256 elapsed = bound(rawWarp, 1, 90 days);
        uint256 partialAmount = bound(rawPartial, 1, amount);
        uint256 idx = land.tokenIndexOf(ID);

        vm.prank(alice);
        boost.stake(ID, amount);
        _assertBacked(idx);

        vm.warp(block.timestamp + elapsed);
        vm.prank(alice);
        boost.unstake(ID, partialAmount);
        _assertBacked(idx);

        vm.warp(end + 1 days);
        vm.prank(alice);
        boost.claimBoost(ID);
        _assertBacked(idx);

        if (partialAmount < amount) {
            vm.prank(alice);
            boost.unstake(ID, amount - partialAmount);
        }
        assertEq(boost.totalCommittedByToken(idx), 0);
        assertEq(boost.totalOwedByToken(idx), 0);
        _assertBacked(idx);
    }
}
