// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {UtopiaLandMainnet} from "./UtopiaLandMainnet.sol";
import {UtopiaStockSwap} from "./UtopiaStockSwap.sol";

/// @title UtopiaAgentVault
/// @notice User-owned Stock Token portfolios with permissionless, bounded rebalancing.
/// @dev Every agent is keyed by its user's address, never by plot ID. A land deed
/// sale therefore cannot transfer, strand, or otherwise affect deposited stocks.
/// Plot ownership gates activation and target updates only; withdrawals are always
/// available to the user who deposited the funds.
contract UtopiaAgentVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant WAD = 1e18;
    uint256 private constant PRECISE_VALUE_DENOMINATOR = 1e36;
    uint256 public constant COOLDOWN = 1 hours;
    uint256 public constant DRIFT_THRESHOLD_BPS = 300;
    uint256 public constant MAX_TRADE_BPS = 2_000;

    struct Agent {
        bool active;
        uint16[5] targetBps;
        uint64 lastRebalance;
        uint256[5] balances;
    }

    UtopiaLandMainnet public immutable land;
    UtopiaStockSwap public immutable stockSwap;
    IERC20[5] public tokens;

    mapping(address => Agent) private _agents;

    event Activated(address indexed user, uint16[5] targetBps);
    event Deposited(address indexed user, address indexed token, uint256 amountReceived, uint256 newBalance);
    event Withdrawn(address indexed user, address indexed token, address indexed to, uint256 amount);
    event Rebalanced(
        address indexed user, uint256 indexed fromIdx, uint256 indexed toIdx, uint256 amountIn, uint256 amountOut
    );

    error InvalidConfig();
    error InvalidTokenIndex();
    error InvalidTargets();
    error ZeroAmount();
    error InvalidAmount();
    error NotPlotOwner();
    error AgentNotActive();
    error CooldownActive(uint256 availableAt);
    error NothingToRebalance();

    constructor(UtopiaLandMainnet land_, UtopiaStockSwap swap_, address initialOwner) Ownable(initialOwner) {
        address landAddress = address(land_);
        address swapAddress = address(swap_);
        if (
            landAddress == address(0) || landAddress.code.length == 0 || swapAddress == address(0)
                || swapAddress.code.length == 0
        ) revert InvalidConfig();
        if (address(swap_.land()) != landAddress) revert InvalidConfig();

        land = land_;
        stockSwap = swap_;
        for (uint256 i = 0; i < 5; i++) {
            IERC20 token = land_.tokens(i);
            if (address(token) == address(0) || address(token) != address(swap_.tokens(i))) revert InvalidConfig();
            tokens[i] = token;
        }
    }

    /// @notice Activates an agent or updates its targets while the user owns a plot.
    function activate(uint16[5] calldata targets) external {
        if (land.balanceOf(msg.sender) == 0) revert NotPlotOwner();
        uint256 sum;
        for (uint256 i = 0; i < 5; i++) {
            sum += targets[i];
        }
        if (sum != BPS) revert InvalidTargets();

        Agent storage agent = _agents[msg.sender];
        agent.active = true;
        agent.targetBps = targets;
        emit Activated(msg.sender, targets);
    }

    /// @notice Deposits a Stock Token into the caller's active agent.
    function deposit(uint256 tokenIndex, uint256 amount) external nonReentrant {
        if (tokenIndex >= 5) revert InvalidTokenIndex();
        if (amount == 0) revert ZeroAmount();
        Agent storage agent = _agents[msg.sender];
        if (!agent.active) revert AgentNotActive();

        IERC20 token = tokens[tokenIndex];
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert ZeroAmount();
        agent.balances[tokenIndex] += received;
        emit Deposited(msg.sender, address(token), received, agent.balances[tokenIndex]);
    }

    /// @notice Withdraws only the caller's recorded balance to `to`.
    /// @dev This deliberately has no plot-ownership, eligibility, activation,
    /// drift, or cooldown check: user custody takes precedence over automation.
    function withdraw(uint256 tokenIndex, uint256 amount, address to) external nonReentrant {
        if (tokenIndex >= 5) revert InvalidTokenIndex();
        if (to == address(0)) revert InvalidConfig();
        if (amount == 0) revert ZeroAmount();
        Agent storage agent = _agents[msg.sender];
        if (amount > agent.balances[tokenIndex]) revert InvalidAmount();

        agent.balances[tokenIndex] -= amount;
        tokens[tokenIndex].safeTransfer(to, amount);
        emit Withdrawn(msg.sender, address(tokens[tokenIndex]), to, amount);
    }

    /// @notice Rebalances one largest-overweight/largest-underweight token pair.
    /// @dev Any keeper may call this. Trade input is limited to 20% of portfolio
    /// ETH value, and output is protected by the venue's deterministic exact quote.
    function rebalance(address user) external nonReentrant {
        Agent storage agent = _agents[user];
        if (!agent.active) revert AgentNotActive();

        (uint256[5] memory preciseValues, uint256 totalPreciseValue) = _precisePortfolioValue(agent);
        if (totalPreciseValue == 0) revert NothingToRebalance();

        uint256 availableAt = uint256(agent.lastRebalance) + COOLDOWN;
        if (block.timestamp < availableAt) revert CooldownActive(availableAt);

        (uint256 fromIdx, uint256 toIdx, uint256 tradeValue) = _selectTrade(agent, preciseValues, totalPreciseValue);
        uint256 amountIn = Math.mulDiv(tradeValue, land.tokensPerEthWad(fromIdx), PRECISE_VALUE_DENOMINATOR);
        if (amountIn == 0 || amountIn > agent.balances[fromIdx]) revert NothingToRebalance();

        _executeTrade(agent, user, fromIdx, toIdx, amountIn);
    }

    function _selectTrade(Agent storage agent, uint256[5] memory values, uint256 totalValue)
        internal
        view
        returns (uint256 fromIdx, uint256 toIdx, uint256 tradeEthValue)
    {
        uint256 largestExcess;
        uint256 largestDeficit;
        uint256 maxDriftBps;
        for (uint256 i = 0; i < 5; i++) {
            uint256 targetValue = Math.mulDiv(totalValue, agent.targetBps[i], BPS);
            uint256 difference;
            if (values[i] > targetValue) {
                difference = values[i] - targetValue;
                if (difference > largestExcess) {
                    largestExcess = difference;
                    fromIdx = i;
                }
            } else {
                difference = targetValue - values[i];
                if (difference > largestDeficit) {
                    largestDeficit = difference;
                    toIdx = i;
                }
            }
            uint256 driftBps = Math.mulDiv(difference, BPS, totalValue);
            if (driftBps > maxDriftBps) maxDriftBps = driftBps;
        }
        if (maxDriftBps < DRIFT_THRESHOLD_BPS || largestExcess == 0 || largestDeficit == 0) {
            revert NothingToRebalance();
        }

        tradeEthValue = Math.min(largestExcess, largestDeficit);
        tradeEthValue = Math.min(tradeEthValue, Math.mulDiv(totalValue, MAX_TRADE_BPS, BPS));
    }

    function _executeTrade(Agent storage agent, address user, uint256 fromIdx, uint256 toIdx, uint256 amountIn)
        internal
    {
        (uint256 quotedOut,) = stockSwap.quote(fromIdx, toIdx, amountIn);
        if (quotedOut == 0) revert NothingToRebalance();

        IERC20 tokenIn = tokens[fromIdx];
        IERC20 tokenOut = tokens[toIdx];
        uint256 inputBefore = tokenIn.balanceOf(address(this));
        uint256 outputBefore = tokenOut.balanceOf(address(this));
        tokenIn.forceApprove(address(stockSwap), amountIn);
        stockSwap.swap(fromIdx, toIdx, amountIn, quotedOut, address(this));
        tokenIn.forceApprove(address(stockSwap), 0);

        uint256 amountSpent = inputBefore - tokenIn.balanceOf(address(this));
        uint256 amountOut = tokenOut.balanceOf(address(this)) - outputBefore;
        if (amountSpent == 0 || amountSpent > agent.balances[fromIdx] || amountOut == 0) revert NothingToRebalance();

        agent.balances[fromIdx] -= amountSpent;
        agent.balances[toIdx] += amountOut;
        agent.lastRebalance = uint64(block.timestamp);
        emit Rebalanced(user, fromIdx, toIdx, amountSpent, amountOut);
    }

    /// @notice Returns full user-agent state and its current land-rate valuation.
    function agentOf(address user)
        external
        view
        returns (
            bool active,
            uint16[5] memory targetBps,
            uint64 lastRebalance,
            uint256[5] memory balances,
            uint256[5] memory ethValues,
            uint256 totalEthValue
        )
    {
        Agent storage agent = _agents[user];
        active = agent.active;
        targetBps = agent.targetBps;
        lastRebalance = agent.lastRebalance;
        balances = agent.balances;
        (ethValues, totalEthValue) = _portfolioValue(agent);
    }

    function _portfolioValue(Agent storage agent)
        internal
        view
        returns (uint256[5] memory ethValues, uint256 totalEthValue)
    {
        for (uint256 i = 0; i < 5; i++) {
            ethValues[i] = Math.mulDiv(agent.balances[i], WAD, land.tokensPerEthWad(i));
            totalEthValue += ethValues[i];
        }
    }

    /// @dev Uses 18 extra decimal places internally so sub-wei target shares do
    /// not disappear before they are converted back into 18-decimal token units.
    function _precisePortfolioValue(Agent storage agent)
        internal
        view
        returns (uint256[5] memory values, uint256 totalValue)
    {
        for (uint256 i = 0; i < 5; i++) {
            values[i] = Math.mulDiv(agent.balances[i], PRECISE_VALUE_DENOMINATOR, land.tokensPerEthWad(i));
            totalValue += values[i];
        }
    }
}
