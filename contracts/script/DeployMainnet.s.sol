// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {UtopiaLand} from "../src/UtopiaLand.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Mainnet deploy: ETH-priced UtopiaLand streaming real Robinhood Stock
/// Tokens. Run only after reading contracts/MAINNET.md end to end — the
/// operator funds the reward treasury with real assets and owns the legal
/// exposure of distributing them.
contract DeployMainnet is Script {
    // Robinhood Chain mainnet Stock Tokens, verified via symbol()/decimals()
    // on-chain 2026-07-18
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;

    function run() external {
        require(block.chainid == 4663, "not robinhood chain mainnet");

        IERC20[5] memory toks = [IERC20(TSLA), IERC20(AAPL), IERC20(NVDA), IERC20(MSFT), IERC20(AMZN)];

        // tokensPerEthWad: stock-wei streamed per ETH-wei of plot price per
        // year at 100% of the base rate. These encode a snapshot of
        // ETH/stock prices (ETH ~$4000 at authoring) and are FIXED at deploy;
        // there is no price oracle in this version. RECHECK AND EDIT before
        // deploying: rate_i = eth_usd / stock_usd, times 1e18.
        uint256[5] memory rates = [
            uint256(9e18), // TSLA ~$440
            15e18, // AAPL ~$270
            22e18, // NVDA ~$180
            8e18, // MSFT ~$500
            17e18 // AMZN ~$230
        ];

        vm.startBroadcast();
        UtopiaLand land = new UtopiaLand(toks, rates);
        vm.stopBroadcast();
        console.log("UtopiaLand (mainnet):", address(land));
    }
}
