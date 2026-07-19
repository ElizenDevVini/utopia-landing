// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandCity} from "../src/UtopiaLandCity.sol";

/// @notice Deploy the district-based, migration-capable city contract. Same
/// inputs as DeployMainnet; set UTOPIA_ELIGIBILITY to reuse the live registry
/// so the approved wallets carry over.
contract DeployCity is Script {
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;

    function run() external {
        require(block.chainid == 4663, "not robinhood chain mainnet");

        address owner = vm.envAddress("UTOPIA_OWNER");
        uint256 rewardEndRaw = vm.envUint("UTOPIA_REWARD_END");
        require(owner.code.length > 0, "owner must be deployed multisig/timelock");
        require(rewardEndRaw <= type(uint64).max, "reward end overflows uint64");

        IERC20[5] memory toks = [IERC20(TSLA), IERC20(AAPL), IERC20(NVDA), IERC20(MSFT), IERC20(AMZN)];
        uint256[5] memory rates = [
            vm.envUint("UTOPIA_TSLA_PER_ETH_WAD"),
            vm.envUint("UTOPIA_AAPL_PER_ETH_WAD"),
            vm.envUint("UTOPIA_NVDA_PER_ETH_WAD"),
            vm.envUint("UTOPIA_MSFT_PER_ETH_WAD"),
            vm.envUint("UTOPIA_AMZN_PER_ETH_WAD")
        ];

        // token addresses were validated (symbol/decimals) on the two prior
        // mainnet deploys; the metadata reads here trip the public RPC's
        // Cloudflare challenge, so we trust the vetted constants and skip them.
        for (uint256 i = 0; i < 5; i++) {
            require(address(toks[i]).code.length > 0, "stock token has no code");
        }

        address existingRegistry = vm.envOr("UTOPIA_ELIGIBILITY", address(0));
        if (existingRegistry != address(0)) {
            require(existingRegistry.code.length > 0, "eligibility registry has no code");
        }

        // 5 = district mode; 0..4 = every plot pays that one stock (NVDA = 2)
        uint256 rewardMode = vm.envOr("UTOPIA_REWARD_MODE", uint256(5));

        vm.startBroadcast();
        IUtopiaEligibility registry = existingRegistry == address(0)
            ? IUtopiaEligibility(address(new UtopiaEligibility(owner)))
            : IUtopiaEligibility(existingRegistry);
        // forge-lint: disable-next-line(unsafe-typecast)
        UtopiaLandCity land = new UtopiaLandCity(toks, rates, registry, uint64(rewardEndRaw), owner, rewardMode);
        vm.stopBroadcast();

        console.log("UtopiaEligibility:", address(registry));
        console.log("UtopiaLandCity:", address(land));
        console.log("Owner:", owner);
    }
}
