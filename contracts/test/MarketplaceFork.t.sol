// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaMarketplace} from "../src/UtopiaMarketplace.sol";

interface ILandFork {
    function ownerOf(uint256 id) external view returns (address);
    function isEligible(address a) external view returns (bool);
    function setApprovalForAll(address op, bool ok) external;
    function claimable(uint256 id) external view returns (uint256);
}

// Fork test against the live land contract + registry. Proves a real deed
// transfers through the marketplace on deployed bytecode. Run with:
//   forge test --match-contract MarketplaceFork --fork-url <rpc>
// Skips itself (no revert) when not run against a fork.
contract MarketplaceForkTest is Test {
    address constant LAND = 0xb93Ee2B0996C3a0577eC4E3a776D81D4E4FCbed2;
    address constant SAFE = 0xBdD5507c1823b663f54353e47576685e3398eE72;
    uint256 constant PLOT = 503; // known owned + eligible on the live chain

    function test_forkRealResale() public {
        if (block.chainid != 4663) {
            emit log("skipped: not a robinhood-chain fork");
            return;
        }
        ILandFork land = ILandFork(LAND);
        address seller = land.ownerOf(PLOT);
        require(land.isEligible(seller), "seller not eligible");

        UtopiaMarketplace market = new UtopiaMarketplace(LAND, 100, 200, SAFE, address(this));

        // seller approves + lists
        vm.prank(seller);
        land.setApprovalForAll(address(market), true);
        vm.prank(seller);
        market.list(PLOT, 0.05 ether);
        assertTrue(market.isListingValid(PLOT));

        // an eligible buyer purchases
        address buyer = 0x15B9b0785d18Af9968AC12e26F70c9D5200A211E; // eligible on live chain
        require(land.isEligible(buyer), "buyer not eligible");
        vm.deal(buyer, 1 ether);
        uint256 sellerBefore = seller.balance;
        uint256 owedBefore = land.claimable(PLOT);

        vm.prank(buyer);
        market.buy{value: 0.05 ether}(PLOT);

        assertEq(land.ownerOf(PLOT), buyer); // deed moved on real contract
        assertEq(seller.balance, sellerBefore + 0.05 ether - 0.0015 ether); // 97%
        assertEq(market.accruedFees(), 0.0005 ether); // operator 1%
        assertEq(land.claimable(PLOT), owedBefore); // rewards followed the deed
    }
}
