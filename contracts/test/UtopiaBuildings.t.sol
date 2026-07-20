// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {UtopiaBuildings} from "../src/UtopiaBuildings.sol";
import {UtopiaLandCity} from "../src/UtopiaLandCity.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStock is ERC20 {
    constructor() ERC20("STK", "STK") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract MockUtopia is ERC20 {
    constructor() ERC20("utopia", "UTOPIA") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract UtopiaBuildingsTest is Test {
    UtopiaLandCity land;
    UtopiaEligibility reg;
    UtopiaBuildings buildings;
    MockUtopia utopia;

    address safe = makeAddr("safe");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 plot;
    uint256 constant FEE = 10e18;

    function setUp() public {
        reg = new UtopiaEligibility(address(this));
        IERC20[5] memory toks;
        for (uint256 i = 0; i < 5; i++) toks[i] = IERC20(address(new MockStock()));
        uint256[5] memory rates = [uint256(2e17), 3e17, 4e17, 2e17, 3e17];
        land = new UtopiaLandCity(
            toks, rates, IUtopiaEligibility(address(reg)), uint64(block.timestamp + 90 days), address(this), 5
        );
        for (uint256 i = 0; i < 5; i++) MockStock(address(toks[i])).mint(address(land), 100e18);

        utopia = new MockUtopia();
        buildings = new UtopiaBuildings(address(land), address(utopia), FEE, safe, address(this));

        reg.setEligibility(alice, uint64(block.timestamp + 30 days));
        plot = 16 * 32 + 16;
        uint256 p = land.priceOf(plot);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        land.buy{value: p}(plot);

        utopia.mint(alice, 1000e18);
    }

    function _customizeAsAlice() internal {
        vm.startPrank(alice);
        utopia.approve(address(buildings), FEE);
        buildings.setBuilding(plot, 0xE3C67B, 1, 4, "the spire");
        vm.stopPrank();
    }

    function test_ownerCanCustomizeAndFeePulled() public {
        uint256 safeBefore = utopia.balanceOf(safe);
        _customizeAsAlice();
        (UtopiaBuildings.Building memory b, string memory name) = buildings.buildingOf(plot);
        assertTrue(b.set);
        assertEq(b.color, 0xE3C67B);
        assertEq(b.style, 1);
        assertEq(b.height, 4);
        assertEq(name, "the spire");
        assertEq(utopia.balanceOf(safe), safeBefore + FEE); // fee landed at recipient
    }

    function test_nonOwnerReverts() public {
        vm.prank(bob);
        vm.expectRevert(UtopiaBuildings.NotPlotOwner.selector);
        buildings.setBuilding(plot, 0xFFFFFF, 0, 2, "nope");
    }

    function test_invalidStyleReverts() public {
        vm.startPrank(alice);
        utopia.approve(address(buildings), FEE);
        vm.expectRevert(UtopiaBuildings.InvalidStyle.selector);
        buildings.setBuilding(plot, 0xFFFFFF, 5, 2, "x"); // style must be < 5
        vm.stopPrank();
    }

    function test_invalidHeightReverts() public {
        vm.startPrank(alice);
        utopia.approve(address(buildings), FEE);
        vm.expectRevert(UtopiaBuildings.InvalidHeight.selector);
        buildings.setBuilding(plot, 0xFFFFFF, 0, 7, "x"); // > MAX_HEIGHT
        vm.expectRevert(UtopiaBuildings.InvalidHeight.selector);
        buildings.setBuilding(plot, 0xFFFFFF, 0, 0, "x"); // zero
        vm.stopPrank();
    }

    function test_longNameReverts() public {
        vm.startPrank(alice);
        utopia.approve(address(buildings), FEE);
        vm.expectRevert(UtopiaBuildings.NameTooLong.selector);
        buildings.setBuilding(plot, 0xFFFFFF, 0, 2, "this name is way too long to fit");
        vm.stopPrank();
    }

    function test_overwriteWorks() public {
        _customizeAsAlice();
        vm.startPrank(alice);
        utopia.approve(address(buildings), FEE);
        buildings.setBuilding(plot, 0x123456, 2, 6, "rebuilt");
        vm.stopPrank();
        (UtopiaBuildings.Building memory b, string memory name) = buildings.buildingOf(plot);
        assertEq(b.color, 0x123456);
        assertEq(b.style, 2);
        assertEq(b.height, 6);
        assertEq(name, "rebuilt");
    }

    function test_customizationSurvivesResaleAndNewOwnerCanChange() public {
        _customizeAsAlice();
        // alice transfers the deed to bob (bob must be eligible to receive)
        reg.setEligibility(bob, uint64(block.timestamp + 30 days));
        vm.prank(alice);
        land.transferFrom(alice, bob, plot);
        // old building persists
        (UtopiaBuildings.Building memory b,) = buildings.buildingOf(plot);
        assertEq(b.color, 0xE3C67B);
        // new owner can overwrite; old owner cannot
        vm.prank(alice);
        vm.expectRevert(UtopiaBuildings.NotPlotOwner.selector);
        buildings.setBuilding(plot, 0x000000, 0, 1, "hijack");
        utopia.mint(bob, 100e18);
        vm.startPrank(bob);
        utopia.approve(address(buildings), FEE);
        buildings.setBuilding(plot, 0x00FF00, 3, 3, "bob's tower");
        vm.stopPrank();
        (UtopiaBuildings.Building memory b2, string memory n2) = buildings.buildingOf(plot);
        assertEq(b2.color, 0x00FF00);
        assertEq(n2, "bob's tower");
    }

    function test_batchedReadReturnsSet() public {
        _customizeAsAlice();
        uint256[] memory ids = new uint256[](2);
        ids[0] = plot;
        ids[1] = plot + 1; // uncustomized
        (UtopiaBuildings.Building[] memory bs, string[] memory ns) = buildings.getBuildings(ids);
        assertTrue(bs[0].set);
        assertEq(ns[0], "the spire");
        assertFalse(bs[1].set);
    }

    function test_freeModeSkipsFee() public {
        buildings.setFee(address(0), 0, safe); // fee off
        vm.prank(alice);
        buildings.setBuilding(plot, 0xABCDEF, 0, 2, "free"); // no approve needed
        (UtopiaBuildings.Building memory b,) = buildings.buildingOf(plot);
        assertTrue(b.set);
    }
}
