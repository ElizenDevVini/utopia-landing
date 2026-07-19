// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaLandCity, ILandOwners} from "../src/UtopiaLandCity.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStock is ERC20 {
    constructor() ERC20("STK", "STK") {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

// stands in for a prior land contract we migrate from
contract OldLand {
    mapping(uint256 => address) public owners;

    function set(uint256 id, address o) external {
        owners[id] = o;
    }

    function ownerOf(uint256 id) external view returns (address) {
        if (owners[id] == address(0)) revert("nonexistent");
        return owners[id];
    }
}

contract UtopiaLandCityTest is Test {
    UtopiaLandCity land;
    UtopiaEligibility reg;
    MockStock[5] stocks;
    uint256[5] rates = [uint256(2e17), 3e17, 4e17, 2e17, 3e17];
    address safe = makeAddr("safe");
    address alice = makeAddr("alice");

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
    }

    // ---- districts ----

    function test_centerIsNVDA() public view {
        // plots at the exact center map to NVDA (token index 2)
        assertEq(land.tokenIndexOf(16 * 32 + 16), 2);
        assertEq(land.tokenIndexOf(15 * 32 + 15), 2);
    }

    function test_cornersAreDistinctStocks() public view {
        assertEq(land.tokenIndexOf(0 * 32 + 0), 0); // upper-left TSLA
        assertEq(land.tokenIndexOf(0 * 32 + 31), 1); // upper-right AAPL
        assertEq(land.tokenIndexOf(31 * 32 + 0), 3); // lower-left MSFT
        assertEq(land.tokenIndexOf(31 * 32 + 31), 4); // lower-right AMZN
    }

    function test_allTokensUsedAndContiguousCenter() public view {
        bool[5] memory used;
        uint256 centerCount;
        for (uint256 id = 0; id < 1024; id++) {
            used[land.tokenIndexOf(id)] = true;
            if (land.tokenIndexOf(id) == 2) centerCount++;
        }
        for (uint256 i = 0; i < 5; i++) {
            assertTrue(used[i]);
        }
        // center circle is a meaningful, bounded region (not the whole map)
        assertGt(centerCount, 100);
        assertLt(centerCount, 400);
    }

    // ---- migration ----

    function test_migratePreservesOwners() public {
        OldLand old = new OldLand();
        old.set(500, alice); // alice owned plot 500 on the old contract
        reg.setEligibility(alice, uint64(block.timestamp + 30 days));

        uint256[] memory ids = new uint256[](1);
        ids[0] = 500;
        land.migrateOwners(ILandOwners(address(old)), ids);

        assertEq(land.ownerOf(500), alice);
        // migrated plot accrues rewards like a bought one
        vm.warp(block.timestamp + 30 days);
        assertGt(land.claimable(500), 0);
    }

    function test_migrateSkipsUnowastedAndDoubleMint() public {
        OldLand old = new OldLand();
        old.set(10, alice);
        reg.setEligibility(alice, uint64(block.timestamp + 30 days));
        uint256[] memory ids = new uint256[](2);
        ids[0] = 10;
        ids[1] = 999; // not owned on old -> skipped, no revert
        land.migrateOwners(ILandOwners(address(old)), ids);
        assertEq(land.ownerOf(10), alice);
        // re-running is a no-op (already minted), not a revert
        land.migrateOwners(ILandOwners(address(old)), ids);
        assertEq(land.balanceOf(alice), 1);
    }

    function test_onlyOwnerMigrates() public {
        OldLand old = new OldLand();
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(alice);
        vm.expectRevert();
        land.migrateOwners(ILandOwners(address(old)), ids);
    }
}
