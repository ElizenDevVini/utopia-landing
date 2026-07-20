// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title UtopiaMarketplace
/// @notice Non-custodial secondary market for utopia land deeds. Sellers keep
/// their deed in their own wallet (approving this contract as operator) and list
/// a price; a buyer pays ETH and the deed transfers directly seller -> buyer in
/// one transaction, minus a fee. The land contract's own transfer gate still
/// enforces buyer eligibility, so nothing here can bypass it.
/// @dev This contract never holds deeds or seller funds. It only holds a fee
/// balance until withdrawn. A listing auto-voids if the seller no longer owns the
/// plot or revoked approval.
interface ILand is IERC721 {
    function isEligible(address account) external view returns (bool);
}

contract UtopiaMarketplace is Ownable2Step, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 1_000; // hard cap: fee can never exceed 10%

    ILand public immutable land;
    uint256 public feeBps; // taken from each sale, sent to feeRecipient
    address public feeRecipient;
    uint256 public accruedFees; // withdrawable fee balance held by this contract

    struct Listing {
        address seller;
        uint96 price; // wei; uint96 covers 7.9e28 wei, far above any plot price
    }

    // tokenId => active listing (seller == address(0) means not listed)
    mapping(uint256 => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event PriceUpdated(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event FeeChanged(uint256 feeBps, address feeRecipient);
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

    constructor(address landAddress, uint256 feeBps_, address feeRecipient_, address initialOwner)
        Ownable(initialOwner)
    {
        if (landAddress == address(0) || landAddress.code.length == 0) revert InvalidConfig();
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        land = ILand(landAddress);
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
    }

    // ---- listing management ----

    /// @notice List a plot you own for `price` wei. Requires this contract to be
    /// approved (per-token approve, or setApprovalForAll) so it can move the deed
    /// on sale. The deed stays in your wallet until it sells.
    function list(uint256 tokenId, uint256 price) external {
        if (land.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (price == 0) revert ZeroPrice();
        if (price > type(uint96).max) revert WrongPayment();
        if (!_approved(tokenId, msg.sender)) revert NotApproved();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();
        listings[tokenId] = Listing(msg.sender, uint96(price));
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

    /// @notice Buy a listed plot. Sends `price` ETH; the seller receives price
    /// minus fee, the deed transfers to you. You must be eligible on the land
    /// contract (same gate as a primary purchase).
    function buy(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender == l.seller) revert SelfBuy();
        if (msg.value != l.price) revert WrongPayment();
        // land contract also enforces this on transfer, but fail early and clearly
        if (!land.isEligible(msg.sender)) revert BuyerNotEligible();
        // listing must still be valid: seller still owns it and we're still approved
        if (land.ownerOf(tokenId) != l.seller || !_approved(tokenId, l.seller)) revert NotListed();

        delete listings[tokenId];

        uint256 fee = (uint256(l.price) * feeBps) / BPS;
        uint256 toSeller = l.price - fee;
        accruedFees += fee;

        // move the deed seller -> buyer (this contract is the approved operator)
        land.transferFrom(l.seller, msg.sender, tokenId);

        (bool ok,) = payable(l.seller).call{value: toSeller}("");
        if (!ok) revert TransferFailed();

        emit Sold(tokenId, l.seller, msg.sender, l.price, fee);
    }

    // ---- views ----

    /// @notice True if `tokenId` is currently buyable (listed, owned by the
    /// seller, and this contract still approved). Lets the UI hide stale listings.
    function isListingValid(uint256 tokenId) external view returns (bool) {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) return false;
        return land.ownerOf(tokenId) == l.seller && _approved(tokenId, l.seller);
    }

    function priceOf(uint256 tokenId) external view returns (uint256) {
        return listings[tokenId].price;
    }

    // ---- admin (fee only; never touches deeds or seller funds) ----

    function setFee(uint256 feeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeChanged(feeBps_, feeRecipient_);
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = accruedFees;
        accruedFees = 0;
        (bool ok,) = payable(feeRecipient).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    function _approved(uint256 tokenId, address owner_) internal view returns (bool) {
        return land.getApproved(tokenId) == address(this) || land.isApprovedForAll(owner_, address(this));
    }
}
