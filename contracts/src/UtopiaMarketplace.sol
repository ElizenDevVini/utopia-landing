// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UtopiaMarketplace
/// @notice Non-custodial secondary market for utopia land deeds, and the city's
/// economy engine. Sellers keep their deed until it sells; a buyer pays ETH and
/// the deed transfers seller -> buyer in one transaction. The sale fee is split:
/// part to the operator, part into a rewards pool shared by ALL landholders,
/// weighted by plots held and a loyalty multiplier that grows with hold time and
/// resets when a wallet's plot count decreases. Holding pays; selling resets.
/// @dev The contract never holds deeds. It holds only the operator's accrued fee
/// and the holder rewards pool; the operator can withdraw the former, never the
/// latter. Loyalty is tracked lazily from marketplace interactions (or a public
/// poke); transfers made outside the marketplace do not reset the clock.
interface ILand is IERC721 {
    function isEligible(address account) external view returns (bool);
    function plotsOf(address who) external view returns (uint256[4] memory);
}

contract UtopiaMarketplace is Ownable2Step, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_TOTAL_FEE_BPS = 1_000; // fees can never exceed 10%
    uint256 public constant ACC_PRECISION = 1e18;

    // loyalty: weight multiplier by continuous hold time (since last plot-count decrease)
    uint256 public constant TIER1_AFTER = 30 days; // 1.5x
    uint256 public constant TIER2_AFTER = 90 days; // 2.0x
    uint256 public constant MULT_BASE = 10_000; // 1.0x
    uint256 public constant MULT_TIER1 = 15_000; // 1.5x
    uint256 public constant MULT_TIER2 = 20_000; // 2.0x

    ILand public immutable land;
    uint256 public operatorFeeBps; // share of each sale to the operator
    uint256 public poolFeeBps; // share of each sale to the holder rewards pool
    address public feeRecipient;
    uint256 public accruedFees; // operator's withdrawable balance

    // ---- holder rewards pool (MasterChef-style accumulator) ----
    uint256 public accRewardPerWeight; // scaled by ACC_PRECISION
    uint256 public totalWeight; // sum of all checkpointed holder weights
    uint256 public pendingPool; // pool fees collected while totalWeight was 0
    uint256 public totalPaidToHolders; // lifetime ETH claimed by holders

    struct Holder {
        uint32 plotCount; // checkpointed plot count
        uint64 loyaltySince; // when the current hold streak started
        uint128 weight; // plotCount * multiplierBps
        uint256 rewardDebt; // accumulator debt at last checkpoint
        uint256 accrued; // settled, claimable ETH
    }

    mapping(address => Holder) public holders;

    struct Listing {
        address seller;
        uint96 price; // wei
    }

    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event PriceUpdated(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event RewardsClaimed(address indexed holder, uint256 amount);
    event LoyaltyReset(address indexed holder, uint32 oldCount, uint32 newCount);
    event HolderCheckpointed(address indexed holder, uint256 weight);
    event FeeChanged(uint256 operatorFeeBps, uint256 poolFeeBps, address feeRecipient);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error NotListed();
    error AlreadyListed();
    error ZeroPrice();
    error NotApproved();
    error WrongPayment();
    error BuyerNotEligible();
    error SelfBuy();
    error FeeTooHigh();
    error InvalidConfig();
    error TransferFailed();
    error NothingToClaim();

    constructor(
        address landAddress,
        uint256 operatorFeeBps_,
        uint256 poolFeeBps_,
        address feeRecipient_,
        address initialOwner
    ) Ownable(initialOwner) {
        if (landAddress == address(0) || landAddress.code.length == 0) revert InvalidConfig();
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        if (operatorFeeBps_ + poolFeeBps_ > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();
        land = ILand(landAddress);
        operatorFeeBps = operatorFeeBps_;
        poolFeeBps = poolFeeBps_;
        feeRecipient = feeRecipient_;
    }

    // ---- listing management ----

    /// @notice List a plot you own for `price` wei. Requires this contract to be
    /// approved so it can move the deed on sale. The deed stays in your wallet.
    function list(uint256 tokenId, uint256 price) external {
        if (land.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price == 0) revert ZeroPrice();
        if (price > type(uint96).max) revert WrongPayment();
        if (!_approved(tokenId, msg.sender)) revert NotApproved();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();
        listings[tokenId] = Listing(msg.sender, uint96(price));
        _checkpoint(msg.sender); // listing is an interaction; start/refresh tracking
        emit Listed(tokenId, msg.sender, price);
    }

    function updatePrice(uint256 tokenId, uint256 price) external {
        Listing memory l = listings[tokenId];
        if (l.seller != msg.sender) revert NotListed();
        if (price == 0) revert ZeroPrice();
        if (price > type(uint96).max) revert WrongPayment();
        listings[tokenId].price = uint96(price);
        emit PriceUpdated(tokenId, msg.sender, price);
    }

    function cancel(uint256 tokenId) external {
        if (listings[tokenId].seller != msg.sender) revert NotListed();
        delete listings[tokenId];
        emit Cancelled(tokenId, msg.sender);
    }

    // ---- buying ----

    /// @notice Buy a listed plot. The seller receives price minus the fee; the
    /// fee splits between the operator and the holder rewards pool. Both sides'
    /// reward checkpoints update, and the pool share is distributed to all
    /// checkpointed landholders by weight.
    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender == l.seller) revert SelfBuy();
        if (msg.value != l.price) revert WrongPayment();
        if (!land.isEligible(msg.sender)) revert BuyerNotEligible();
        if (land.ownerOf(tokenId) != l.seller || !_approved(tokenId, l.seller)) revert NotListed();

        delete listings[tokenId];

        uint256 operatorFee = (uint256(l.price) * operatorFeeBps) / BPS;
        uint256 poolFee = (uint256(l.price) * poolFeeBps) / BPS;
        uint256 toSeller = l.price - operatorFee - poolFee;
        accruedFees += operatorFee;

        // move the deed, then re-checkpoint both parties (seller's count drops ->
        // loyalty resets; buyer's count rises -> streak continues or starts)
        land.transferFrom(l.seller, msg.sender, tokenId);
        _checkpoint(l.seller);
        _checkpoint(msg.sender);

        // distribute the pool share across all checkpointed holders by weight
        _distribute(poolFee);

        (bool ok,) = payable(l.seller).call{value: toSeller}("");
        if (!ok) revert TransferFailed();

        emit Sold(tokenId, l.seller, msg.sender, l.price, operatorFee + poolFee);
    }

    // ---- holder rewards ----

    /// @notice Claim the ETH your land has earned from city trading.
    function claimRewards() external nonReentrant {
        _checkpoint(msg.sender);
        uint256 amount = holders[msg.sender].accrued;
        if (amount == 0) revert NothingToClaim();
        holders[msg.sender].accrued = 0;
        totalPaidToHolders += amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RewardsClaimed(msg.sender, amount);
    }

    /// @notice Refresh any holder's checkpoint (registers them for rewards and
    /// keeps their loyalty tier weight current). Callable by anyone.
    function pokeCheckpoint(address holder) external {
        _checkpoint(holder);
    }

    /// @notice A holder's claimable ETH if they checkpointed right now.
    function claimableRewards(address holder) external view returns (uint256) {
        Holder memory h = holders[holder];
        uint256 settled = h.accrued;
        if (h.weight > 0) {
            settled += (uint256(h.weight) * accRewardPerWeight) / ACC_PRECISION - h.rewardDebt;
        }
        return settled;
    }

    /// @notice Current loyalty multiplier for a holder, in bps of 1x = 10000.
    function loyaltyMultiplierBps(address holder) public view returns (uint256) {
        Holder memory h = holders[holder];
        if (h.loyaltySince == 0) return MULT_BASE;
        uint256 held = block.timestamp - h.loyaltySince;
        if (held >= TIER2_AFTER) return MULT_TIER2;
        if (held >= TIER1_AFTER) return MULT_TIER1;
        return MULT_BASE;
    }

    function loyaltySince(address holder) external view returns (uint256) {
        return holders[holder].loyaltySince;
    }

    // ---- views ----

    function isListingValid(uint256 tokenId) external view returns (bool) {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) return false;
        return land.ownerOf(tokenId) == l.seller && _approved(tokenId, l.seller);
    }

    function priceOf(uint256 tokenId) external view returns (uint256) {
        return listings[tokenId].price;
    }

    // ---- admin (operator fee only; the pool is untouchable) ----

    function setFee(uint256 operatorFeeBps_, uint256 poolFeeBps_, address feeRecipient_) external onlyOwner {
        if (operatorFeeBps_ + poolFeeBps_ > MAX_TOTAL_FEE_BPS) revert FeeTooHigh();
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        operatorFeeBps = operatorFeeBps_;
        poolFeeBps = poolFeeBps_;
        feeRecipient = feeRecipient_;
        emit FeeChanged(operatorFeeBps_, poolFeeBps_, feeRecipient_);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        accruedFees = 0;
        (bool ok,) = payable(feeRecipient).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    // ---- internals ----

    function _approved(uint256 tokenId, address owner_) internal view returns (bool) {
        return land.getApproved(tokenId) == address(this) || land.isApprovedForAll(owner_, address(this));
    }

    function _plotCount(address who) internal view returns (uint32) {
        uint256[4] memory words = land.plotsOf(who);
        uint256 total;
        for (uint256 i = 0; i < 4; i++) {
            uint256 w = words[i];
            while (w != 0) {
                w &= w - 1;
                total++;
            }
        }
        return uint32(total);
    }

    /// @dev Settle a holder's accrued rewards at their old weight, refresh their
    /// plot count and loyalty streak, and re-weight them for future rewards.
    function _checkpoint(address who) internal {
        Holder storage h = holders[who];
        // settle at old weight
        if (h.weight > 0) {
            h.accrued += (uint256(h.weight) * accRewardPerWeight) / ACC_PRECISION - h.rewardDebt;
        }
        uint32 newCount = _plotCount(who);
        // selling (count decreased) resets the loyalty streak
        if (newCount < h.plotCount) {
            emit LoyaltyReset(who, h.plotCount, newCount);
            h.loyaltySince = uint64(block.timestamp);
        }
        // a fresh holder's streak starts now
        if (h.loyaltySince == 0 && newCount > 0) {
            h.loyaltySince = uint64(block.timestamp);
        }
        h.plotCount = newCount;
        uint256 newWeight = newCount == 0 ? 0 : uint256(newCount) * loyaltyMultiplierBps(who);
        totalWeight = totalWeight - h.weight + newWeight;
        h.weight = uint128(newWeight);
        h.rewardDebt = (newWeight * accRewardPerWeight) / ACC_PRECISION;
        emit HolderCheckpointed(who, newWeight);
    }

    /// @dev Add `amount` of pool fees to the accumulator. If nobody is
    /// checkpointed yet, buffer it and fold it in once someone is.
    function _distribute(uint256 amount) internal {
        if (totalWeight == 0) {
            pendingPool += amount;
            return;
        }
        uint256 total = amount + pendingPool;
        pendingPool = 0;
        accRewardPerWeight += (total * ACC_PRECISION) / totalWeight;
    }
}
