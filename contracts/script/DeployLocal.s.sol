// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Local demo only. Uses well-known Anvil dev keys; never use on a public network.

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UtopiaAgentVault} from "../src/UtopiaAgentVault.sol";
import {UtopiaEligibility, IUtopiaEligibility} from "../src/UtopiaEligibility.sol";
import {UtopiaLandMainnet} from "../src/UtopiaLandMainnet.sol";
import {UtopiaStockSwap} from "../src/UtopiaStockSwap.sol";

contract MockStock is ERC20 {
    constructor(string memory symbol_) ERC20(symbol_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DeployLocal is Script {
    uint256 internal constant DEPLOYER_PRIVATE_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 internal constant DEMO_PRIVATE_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address internal constant DEMO = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        address deployer = vm.addr(DEPLOYER_PRIVATE_KEY);
        require(vm.addr(DEMO_PRIVATE_KEY) == DEMO, "unexpected demo key");

        MockStock[5] memory stocks;
        IERC20[5] memory tokens;
        string[5] memory symbols = ["TSLA", "AAPL", "NVDA", "MSFT", "AMZN"];
        uint256[5] memory rates = [uint256(9e18), 15e18, 22e18, 8e18, 17e18];

        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i] = new MockStock(symbols[i]);
            tokens[i] = IERC20(address(stocks[i]));
        }

        UtopiaEligibility registry = new UtopiaEligibility(deployer);
        uint64 rewardEnd = uint64(block.timestamp + 365 days);
        UtopiaLandMainnet land =
            new UtopiaLandMainnet(tokens, rates, IUtopiaEligibility(address(registry)), rewardEnd, deployer);
        registry.setEligibility(DEMO, rewardEnd + uint64(30 days));
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(land), 100e18);
        }
        vm.stopBroadcast();

        vm.startBroadcast(DEMO_PRIVATE_KEY);
        land.buy{value: land.priceOf(240)}(240);
        land.buy{value: land.priceOf(245)}(245);
        vm.stopBroadcast();

        vm.startBroadcast(DEPLOYER_PRIVATE_KEY);
        UtopiaStockSwap stockSwap = new UtopiaStockSwap(land, 30, deployer);
        for (uint256 i = 0; i < 5; i++) {
            stocks[i].mint(address(stockSwap), 500e18);
        }
        UtopiaAgentVault vault = new UtopiaAgentVault(land, stockSwap, deployer);
        vm.stopBroadcast();

        vm.startBroadcast(DEMO_PRIVATE_KEY);
        uint16[5] memory targets = [uint16(2_000), 2_000, 2_000, 2_000, 2_000];
        vault.activate(targets);

        stocks[2].mint(DEMO, 40e18);
        stocks[1].mint(DEMO, 10e18);
        stocks[2].approve(address(vault), 40e18);
        stocks[1].approve(address(vault), 10e18);
        vault.deposit(2, 40e18);
        vault.deposit(1, 10e18);
        vault.rebalance(DEMO);
        vm.stopBroadcast();

        console2.log(string.concat("LAND=", vm.toString(address(land))));
        console2.log(string.concat("SWAP=", vm.toString(address(stockSwap))));
        console2.log(string.concat("VAULT=", vm.toString(address(vault))));
        console2.log(string.concat("REGISTRY=", vm.toString(address(registry))));
        console2.log(string.concat("DEMO=", vm.toString(DEMO)));
    }
}
