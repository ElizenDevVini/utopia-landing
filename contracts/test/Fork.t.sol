// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaLand} from "../src/UtopiaLand.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Meta is IERC20 {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// Run with: forge test --fork-url robinhood_testnet --match-path 'test/Fork*'
/// Skips itself when not forked onto chain 46630.
contract ForkTest is Test {
    address constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    address constant AMD = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant PLTR = 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0;
    address constant AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    address constant NFLX = 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93;
    // USDC/TSLA v3 pool: a large real holder to impersonate
    address constant TSLA_WHALE = 0xFfEf1147c3724a19AB7328F4e361C049ba452dA9;

    function _onFork() internal view returns (bool) {
        return block.chainid == 46630;
    }

    function test_tokensLookRight() public view {
        if (!_onFork()) return;
        address[5] memory toks = [TSLA, AMD, PLTR, AMZN, NFLX];
        string[5] memory syms = ["TSLA", "AMD", "PLTR", "AMZN", "NFLX"];
        for (uint256 i = 0; i < 5; i++) {
            assertGt(toks[i].code.length, 0);
            assertEq(IERC20Meta(toks[i]).symbol(), syms[i]);
            assertEq(IERC20Meta(toks[i]).decimals(), 18);
        }
    }

    /// The exact pattern UtopiaLand needs: a contract holds stock tokens and
    /// transfers them out to an EOA on claim.
    function test_contractCanHoldAndPayStockTokens() public {
        if (!_onFork()) return;
        IERC20[5] memory toks =
            [IERC20(TSLA), IERC20(AMD), IERC20(PLTR), IERC20(AMZN), IERC20(NFLX)];
        uint256[5] memory rates = [uint256(12e18), 25e18, 27e18, 18e18, 3e18];
        UtopiaLand land = new UtopiaLand(toks, rates);

        // seed the deployed-on-fork contract from a real holder
        vm.prank(TSLA_WHALE);
        IERC20(TSLA).transfer(address(land), 10e18);
        assertEq(IERC20(TSLA).balanceOf(address(land)), 10e18);

        // find a TSLA plot, buy it, warp, claim real tokens
        uint256 id = 0;
        while (land.tokenIndexOf(id) != 0) id++;
        address buyer = makeAddr("buyer");
        vm.deal(buyer, 1 ether);
        vm.startPrank(buyer);
        land.buy{value: land.priceOf(id)}(id);
        vm.warp(block.timestamp + 30 days);
        uint256 acc = land.claimable(id);
        assertGt(acc, 0);
        land.claim(id);
        vm.stopPrank();
        assertEq(IERC20(TSLA).balanceOf(buyer), acc);
    }
}
