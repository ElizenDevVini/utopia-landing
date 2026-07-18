// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {UtopiaLandV2} from "../src/UtopiaLandV2.sol";
import {UtopiaToken} from "../src/UtopiaToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeployV2 is Script {
    function run() external {
        IERC20[5] memory toks = [
            IERC20(0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E), // TSLA
            IERC20(0x71178BAc73cBeb415514eB542a8995b82669778d), // AMD
            IERC20(0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0), // PLTR
            IERC20(0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02), // AMZN
            IERC20(0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93) // NFLX
        ];
        // stock wei per UTOP of base price per year at 100% apy (UTOP ~= $1 at launch)
        uint256[5] memory rates = [uint256(3e15), 6.25e15, 6.75e15, 4.5e15, 0.75e15];

        vm.startBroadcast();
        UtopiaToken utop = new UtopiaToken();
        UtopiaLandV2 land = new UtopiaLandV2(IERC20(address(utop)), toks, rates);
        vm.stopBroadcast();
        console.log("UtopiaToken:", address(utop));
        console.log("UtopiaLandV2:", address(land));
    }
}
