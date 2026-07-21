// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UtopiaAgentVault} from "../src/UtopiaAgentVault.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandMainnet} from "../src/UtopiaLandMainnet.sol";
import {UtopiaStockSwap} from "../src/UtopiaStockSwap.sol";

contract VaultMockToken is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract UtopiaAgentVaultTest is Test {
    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant ALICE_PLOT = 5;
    uint256 internal constant BOB_PLOT = 6;

    UtopiaLandMainnet internal land;
    UtopiaEligibility internal registry;
    UtopiaStockSwap internal stockSwap;
    UtopiaAgentVault internal vault;
    VaultMockToken[5] internal stocks;
    uint256[5] internal rates = [uint256(10e18), 20e18, 5e18, 25e18, 8e18];

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");
    address internal multisig = makeAddr("multisig");
    uint64 internal landEnd;

    function setUp() public {
        vm.warp(1_800_000_000);
        landEnd = uint64(block.timestamp + 365 days);
        registry = new UtopiaEligibility(address(this));

        IERC20[5] memory tokens;
        string[5] memory symbols = ["TSLA", "AAPL", "NVDA", "MSFT", "AMZN"];
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new VaultMockToken(symbols[i]);
            tokens[i] = IERC20(address(stocks[i]));
        }
        land = new UtopiaLandMainnet(tokens, rates, IUtopiaEligibility(address(registry)), landEnd, multisig);
        stockSwap = new UtopiaStockSwap(land, FEE_BPS, multisig);
        vault = new UtopiaAgentVault(land, stockSwap, multisig);

        registry.setEligibility(alice, landEnd + 30 days);
        registry.setEligibility(bob, landEnd + 30 days);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 1_000e18);
            stocks[i].mint(address(stockSwap), 1_000_000e18);
            stocks[i].mint(alice, 1_000_000e18);
            stocks[i].mint(bob, 1_000_000e18);
            vm.prank(alice);
            stocks[i].approve(address(vault), type(uint256).max);
            vm.prank(bob);
            stocks[i].approve(address(vault), type(uint256).max);
        }
        _buy(alice, ALICE_PLOT);
        _buy(bob, BOB_PLOT);
    }

    function _buy(address who, uint256 id) internal {
        uint256 price = land.priceOf(id);
        vm.prank(who);
        land.buy{value: price}(id);
    }

    function _targets(uint16 a, uint16 b, uint16 c, uint16 d, uint16 e)
        internal
        pure
        returns (uint16[5] memory targets)
    {
        targets = [a, b, c, d, e];
    }

    function _activate(address user, uint16[5] memory targets) internal {
        vm.prank(user);
        vault.activate(targets);
    }

    function _deposit(address user, uint256 idx, uint256 amount) internal {
        vm.prank(user);
        vault.deposit(idx, amount);
    }

    function test_constructorCachesCompatibleConfig() public view {
        assertEq(address(vault.land()), address(land));
        assertEq(address(vault.stockSwap()), address(stockSwap));
        assertEq(vault.owner(), multisig);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(address(vault.tokens(i)), address(stocks[i]));
        }
    }

    function test_activateRequiresPlotOwnership() public {
        vm.prank(stranger);
        vm.expectRevert(UtopiaAgentVault.NotPlotOwner.selector);
        vault.activate(_targets(2_000, 2_000, 2_000, 2_000, 2_000));
    }

    function test_activateRequiresTargetsToSumToBps() public {
        vm.prank(alice);
        vm.expectRevert(UtopiaAgentVault.InvalidTargets.selector);
        vault.activate(_targets(2_000, 2_000, 2_000, 2_000, 1_999));
    }

    function test_depositAndWithdrawUseExactPerUserAccounting() public {
        _activate(alice, _targets(2_000, 2_000, 2_000, 2_000, 2_000));
        _deposit(alice, 2, 75e18);

        (,,, uint256[5] memory balances,,) = vault.agentOf(alice);
        assertEq(balances[2], 75e18);
        assertEq(stocks[2].balanceOf(address(vault)), 75e18);

        vm.prank(alice);
        vault.withdraw(2, 30e18, alice);
        (,,, balances,,) = vault.agentOf(alice);
        assertEq(balances[2], 45e18);
        assertEq(stocks[2].balanceOf(address(vault)), 45e18);
        assertEq(stocks[2].balanceOf(alice), 1_000_000e18 - 45e18);
    }

    function test_withdrawWorksAfterAllPlotsSoldAndWhileCooldownPending() public {
        _activate(alice, _targets(0, 10_000, 0, 0, 0));
        _deposit(alice, 0, 100e18);
        vm.prank(stranger);
        vault.rebalance(alice);

        vm.prank(alice);
        land.transferFrom(alice, bob, ALICE_PLOT);
        assertEq(land.balanceOf(alice), 0);

        vm.prank(alice);
        vault.withdraw(0, 10e18, alice);
        (,, uint64 lastRebalance, uint256[5] memory balances,,) = vault.agentOf(alice);
        assertEq(lastRebalance, block.timestamp);
        assertEq(balances[0], 70e18);
    }

    function test_activationTracksCurrentPlotOwnershipAndWithdrawHasNoActiveGate() public {
        vm.prank(alice);
        land.transferFrom(alice, bob, ALICE_PLOT);

        vm.prank(alice);
        vm.expectRevert(UtopiaAgentVault.NotPlotOwner.selector);
        vault.activate(_targets(2_000, 2_000, 2_000, 2_000, 2_000));

        _activate(bob, _targets(2_000, 2_000, 2_000, 2_000, 2_000));

        vm.prank(stranger);
        vm.expectRevert(UtopiaAgentVault.InvalidAmount.selector);
        vault.withdraw(0, 1, stranger);
    }

    function test_rebalanceIsPermissionlessCappedAndUsesActualOutput() public {
        _activate(alice, _targets(5_000, 5_000, 0, 0, 0));
        _deposit(alice, 0, 100e18);
        uint256 beforeTotal = 10e18;
        uint256 expectedAmountIn = 20e18;
        (uint256 expectedAmountOut, uint256 fee) = stockSwap.quote(0, 1, expectedAmountIn);

        vm.prank(stranger);
        vault.rebalance(alice);

        (,, uint64 lastRebalance, uint256[5] memory balances, uint256[5] memory values, uint256 total) =
            vault.agentOf(alice);
        assertEq(balances[0], 80e18);
        assertEq(balances[1], expectedAmountOut);
        assertEq(stocks[0].balanceOf(address(vault)), balances[0]);
        assertEq(stocks[1].balanceOf(address(vault)), balances[1]);
        assertEq(lastRebalance, block.timestamp);

        uint256 feeEthValue = Math.mulDiv(fee, 1e18, rates[1]);
        assertEq(total, values[0] + values[1]);
        assertEq(total, beforeTotal - feeEthValue);
    }

    function test_secondImmediateRebalanceRevertsOnCooldown() public {
        _activate(alice, _targets(0, 10_000, 0, 0, 0));
        _deposit(alice, 0, 100e18);
        vm.prank(stranger);
        vault.rebalance(alice);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(UtopiaAgentVault.CooldownActive.selector, block.timestamp + vault.COOLDOWN())
        );
        vault.rebalance(alice);
    }

    function test_belowThresholdDriftRevertsNothingToRebalance() public {
        _activate(alice, _targets(5_000, 5_000, 0, 0, 0));
        _deposit(alice, 0, 510e18);
        _deposit(alice, 1, 980e18);

        vm.prank(stranger);
        vm.expectRevert(UtopiaAgentVault.NothingToRebalance.selector);
        vault.rebalance(alice);
    }

    function test_zeroTargetHeldTokenIsSoldDown() public {
        _activate(alice, _targets(0, 10_000, 0, 0, 0));
        _deposit(alice, 0, 100e18);
        vm.prank(stranger);
        vault.rebalance(alice);

        (,,, uint256[5] memory balances,,) = vault.agentOf(alice);
        assertEq(balances[0], 80e18);
        assertGt(balances[1], 0);
    }

    function test_roundingCannotPermanentlyStrandMaterialDrift() public {
        _activate(alice, _targets(2_000, 2_000, 2_000, 2_000, 2_000));
        _deposit(alice, 0, 60);

        for (uint256 i = 0; i < 4; i++) {
            vault.rebalance(alice);
            vm.warp(block.timestamp + vault.COOLDOWN());
        }

        (,,, uint256[5] memory balances,,) = vault.agentOf(alice);
        assertEq(balances[0], 12);
        assertEq(balances[1], 24);
        assertEq(balances[2], 6);
        assertEq(balances[3], 30);
        assertEq(balances[4], 9);
    }

    function test_depositIntoZeroTargetIsAllowed() public {
        _activate(alice, _targets(0, 10_000, 0, 0, 0));
        _deposit(alice, 0, 13e18);
        (,,, uint256[5] memory balances,,) = vault.agentOf(alice);
        assertEq(balances[0], 13e18);
    }

    function testFuzz_twoUserRandomTargetsAndDepositsRemainExactlySolvent(
        uint16[5] memory targetSeedsA,
        uint16[5] memory targetSeedsB,
        uint96[5] memory depositSeedsA,
        uint96[5] memory depositSeedsB
    ) public {
        uint16[5] memory targetsA = _normalizeTargets(targetSeedsA);
        uint16[5] memory targetsB = _normalizeTargets(targetSeedsB);
        _activate(alice, targetsA);
        _activate(bob, targetsB);

        for (uint256 i = 0; i < 5; i++) {
            uint256 amountA = bound(uint256(depositSeedsA[i]), 1e6, 10_000e18);
            uint256 amountB = bound(uint256(depositSeedsB[i]), 1e6, 10_000e18);
            _deposit(alice, i, amountA);
            _deposit(bob, i, amountB);
        }

        (,,, uint256[5] memory balancesA,,) = vault.agentOf(alice);
        (,,, uint256[5] memory balancesB,,) = vault.agentOf(bob);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(stocks[i].balanceOf(address(vault)), balancesA[i] + balancesB[i]);
        }
    }

    function testFuzz_twoUserInterleavingsPreserveSolvencyAndIsolation(uint256 actionSeed) public {
        uint16[5] memory equalTargets = _targets(2_000, 2_000, 2_000, 2_000, 2_000);
        _activate(alice, equalTargets);
        _activate(bob, equalTargets);

        for (uint256 stepIndex = 0; stepIndex < 24; stepIndex++) {
            uint256 action = uint256(keccak256(abi.encode(actionSeed, stepIndex)));
            address user = action & 1 == 0 ? alice : bob;
            address other = user == alice ? bob : alice;
            uint256 tokenIndex = (action >> 8) % 5;
            uint256[5] memory otherBefore = _balancesOf(other);
            uint256 operation = (action >> 16) % 3;

            if (operation == 0) {
                uint256 amount = 1 + ((action >> 32) % 100e18);
                _deposit(user, tokenIndex, amount);
            } else if (operation == 1) {
                uint256 balance = _balancesOf(user)[tokenIndex];
                if (balance != 0) {
                    uint256 amount = 1 + ((action >> 32) % balance);
                    vm.prank(user);
                    vault.withdraw(tokenIndex, amount, user);
                }
            } else {
                vm.warp(block.timestamp + vault.COOLDOWN());
                (bool success, bytes memory reason) = address(vault).call(abi.encodeCall(vault.rebalance, (user)));
                if (!success) assertEq(_selector(reason), UtopiaAgentVault.NothingToRebalance.selector);
            }

            _assertBalancesEq(_balancesOf(other), otherBefore);
            _assertExactlySolvent();
        }

        _withdrawEverything(alice);
        _assertExactlySolvent();
        _withdrawEverything(bob);
        _assertExactlySolvent();
    }

    function testFuzz_rebalancesAreBoundedAndConvergeMonotonically(
        uint16[5] memory targetSeeds,
        uint96[5] memory depositSeeds
    ) public {
        uint16[5] memory targets = _normalizeTargets(targetSeeds);
        _activate(alice, targets);
        for (uint256 i = 0; i < 5; i++) {
            _deposit(alice, i, bound(uint256(depositSeeds[i]), 1e12, 10_000e18));
        }

        bool[25] memory tradedDirections;
        bool converged;
        for (uint256 callIndex = 0; callIndex < 40; callIndex++) {
            uint256[5] memory beforeBalances = _balancesOf(alice);
            (bool success, bytes memory reason) = address(vault).call(abi.encodeCall(vault.rebalance, (alice)));
            if (!success) {
                assertEq(_selector(reason), UtopiaAgentVault.NothingToRebalance.selector);
                converged = true;
                break;
            }

            uint256[5] memory afterBalances = _balancesOf(alice);
            (uint256 fromIdx, uint256 toIdx) = _assertRebalanceStep(beforeBalances, afterBalances, targets);
            assertFalse(tradedDirections[toIdx * 5 + fromIdx]);
            tradedDirections[fromIdx * 5 + toIdx] = true;

            vm.expectRevert(
                abi.encodeWithSelector(UtopiaAgentVault.CooldownActive.selector, block.timestamp + vault.COOLDOWN())
            );
            vault.rebalance(alice);
            vm.warp(block.timestamp + vault.COOLDOWN());
        }
        assertTrue(converged, "rebalance did not converge within 40 calls");
    }

    function _assertRebalanceStep(
        uint256[5] memory beforeBalances,
        uint256[5] memory afterBalances,
        uint16[5] memory targets
    ) internal view returns (uint256 fromIdx, uint256 toIdx) {
        (uint256 totalBefore, uint256 driftBefore, uint256 maxDifferenceBefore) = _preciseDrift(beforeBalances, targets);
        (uint256 totalAfter, uint256 driftAfter,) = _preciseDrift(afterBalances, targets);
        assertGe(Math.mulDiv(maxDifferenceBefore, 10_000, totalBefore), vault.DRIFT_THRESHOLD_BPS());
        assertLt(driftAfter, driftBefore);
        assertLe(totalAfter, totalBefore);

        uint256 amountIn;
        (fromIdx, toIdx, amountIn) = _tradeDelta(beforeBalances, afterBalances);
        assertLe(amountIn, beforeBalances[fromIdx]);
        uint256 tradedValue = Math.mulDiv(amountIn, 1e36, rates[fromIdx]);
        assertLe(tradedValue, Math.mulDiv(totalBefore, vault.MAX_TRADE_BPS(), 10_000));
    }

    function _balancesOf(address user) internal view returns (uint256[5] memory balances) {
        (,,, balances,,) = vault.agentOf(user);
    }

    function _assertExactlySolvent() internal view {
        uint256[5] memory balancesA = _balancesOf(alice);
        uint256[5] memory balancesB = _balancesOf(bob);
        for (uint256 i = 0; i < 5; i++) {
            assertEq(stocks[i].balanceOf(address(vault)), balancesA[i] + balancesB[i]);
        }
    }

    function _assertBalancesEq(uint256[5] memory left, uint256[5] memory right) internal pure {
        for (uint256 i = 0; i < 5; i++) {
            assertEq(left[i], right[i]);
        }
    }

    function _withdrawEverything(address user) internal {
        uint256[5] memory balances = _balancesOf(user);
        for (uint256 i = 0; i < 5; i++) {
            if (balances[i] != 0) {
                vm.prank(user);
                vault.withdraw(i, balances[i], user);
            }
        }
    }

    function _preciseDrift(uint256[5] memory balances, uint16[5] memory targets)
        internal
        view
        returns (uint256 total, uint256 drift, uint256 maxDifference)
    {
        uint256[5] memory values;
        for (uint256 i = 0; i < 5; i++) {
            values[i] = Math.mulDiv(balances[i], 1e36, rates[i]);
            total += values[i];
        }
        for (uint256 i = 0; i < 5; i++) {
            uint256 targetValue = Math.mulDiv(total, targets[i], 10_000);
            uint256 difference = values[i] > targetValue ? values[i] - targetValue : targetValue - values[i];
            drift += difference;
            if (difference > maxDifference) maxDifference = difference;
        }
    }

    function _tradeDelta(uint256[5] memory beforeBalances, uint256[5] memory afterBalances)
        internal
        pure
        returns (uint256 fromIdx, uint256 toIdx, uint256 amountIn)
    {
        for (uint256 i = 0; i < 5; i++) {
            if (afterBalances[i] < beforeBalances[i]) {
                fromIdx = i;
                amountIn = beforeBalances[i] - afterBalances[i];
            } else if (afterBalances[i] > beforeBalances[i]) {
                toIdx = i;
            }
        }
        assertGt(amountIn, 0);
    }

    function _selector(bytes memory reason) internal pure returns (bytes4 result) {
        if (reason.length >= 4) {
            assembly ("memory-safe") {
                result := mload(add(reason, 0x20))
            }
        }
    }

    function _normalizeTargets(uint16[5] memory seeds) internal pure returns (uint16[5] memory targets) {
        uint256 sum;
        for (uint256 i = 0; i < 5; i++) {
            sum += uint256(seeds[i]) + 1;
        }

        uint256 allocated;
        for (uint256 i = 0; i < 4; i++) {
            targets[i] = uint16(Math.mulDiv(uint256(seeds[i]) + 1, 10_000, sum));
            allocated += targets[i];
        }
        targets[4] = uint16(10_000 - allocated);
    }
}
