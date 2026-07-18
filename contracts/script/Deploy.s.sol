// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {UtopiaLand} from "../src/UtopiaLand.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Deploy is Script {
    function run() external {
        IERC20[5] memory toks = [
            IERC20(0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E), // TSLA
            IERC20(0x71178BAc73cBeb415514eB542a8995b82669778d), // AMD
            IERC20(0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0), // PLTR
            IERC20(0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02), // AMZN
            IERC20(0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93) // NFLX
        ];
        // fake fixed FX, tokens per ETH (1e18-scaled), ETH treated as ~$4000
        uint256[5] memory rates = [uint256(12e18), 25e18, 27e18, 18e18, 3e18];

        vm.startBroadcast();
        UtopiaLand land = new UtopiaLand(toks, rates);
        vm.stopBroadcast();
        console.log("UtopiaLand:", address(land));
    }
}
