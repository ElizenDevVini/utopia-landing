// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title UtopiaBuildings
/// @notice Cosmetic on-chain customization for utopia land. The current owner of
/// a plot can set their building's color, style, height, and name, paying a small
/// fee in $utopia. Purely visual: no rewards, no payouts, just ownership made
/// personal. Customization is stored per plot and survives a resale (the new
/// owner can overwrite it).
/// @dev Gated on the immutable land contract's ERC721 ownerOf. This contract only
/// stores cosmetics and forwards the fee to the recipient; it never holds funds
/// or deeds.
interface ILand {
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract UtopiaBuildings is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant STYLE_COUNT = 5; // tower, spire, low-rise, dome, plaza
    uint256 public constant MAX_HEIGHT = 6;
    uint256 public constant MAX_NAME_LEN = 24;

    ILand public immutable land;
    IERC20 public feeToken; // $utopia
    uint256 public fee; // charged per customization
    address public feeRecipient;

    struct Building {
        bool set;
        uint24 color; // 0xRRGGBB
        uint8 style; // 0..STYLE_COUNT-1
        uint8 height; // 1..MAX_HEIGHT
    }

    mapping(uint256 => Building) public buildings;
    mapping(uint256 => string) public names;

    event BuildingSet(
        uint256 indexed id, address indexed owner, uint24 color, uint8 style, uint8 height, string name, uint256 feePaid
    );
    event FeeChanged(address feeToken, uint256 fee, address feeRecipient);

    error NotPlotOwner();
    error InvalidStyle();
    error InvalidHeight();
    error NameTooLong();
    error InvalidConfig();

    constructor(address landAddress, address feeToken_, uint256 fee_, address feeRecipient_, address initialOwner)
        Ownable(initialOwner)
    {
        if (landAddress == address(0) || landAddress.code.length == 0) revert InvalidConfig();
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        land = ILand(landAddress);
        feeToken = IERC20(feeToken_);
        fee = fee_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Customize the building on a plot you own. Requires a prior approve
    /// of `fee` $utopia to this contract. Overwrites any previous customization.
    function setBuilding(uint256 id, uint24 color, uint8 style, uint8 height, string calldata name)
        external
        nonReentrant
    {
        if (land.ownerOf(id) != msg.sender) revert NotPlotOwner();
        if (style >= STYLE_COUNT) revert InvalidStyle();
        if (height == 0 || height > MAX_HEIGHT) revert InvalidHeight();
        if (bytes(name).length > MAX_NAME_LEN) revert NameTooLong();

        uint256 charged = fee;
        if (charged > 0 && address(feeToken) != address(0)) {
            feeToken.safeTransferFrom(msg.sender, feeRecipient, charged);
        }

        buildings[id] = Building({set: true, color: color, style: style, height: height});
        names[id] = name;
        emit BuildingSet(id, msg.sender, color, style, height, name, charged);
    }

    // ---- views ----

    function buildingOf(uint256 id) external view returns (Building memory, string memory) {
        return (buildings[id], names[id]);
    }

    /// @notice Batched read for the map: one call for a whole holder's plots.
    function getBuildings(uint256[] calldata ids)
        external
        view
        returns (Building[] memory out, string[] memory outNames)
    {
        out = new Building[](ids.length);
        outNames = new string[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = buildings[ids[i]];
            outNames[i] = names[ids[i]];
        }
    }

    // ---- admin (fee config only; cannot alter anyone's building) ----

    function setFee(address feeToken_, uint256 fee_, address feeRecipient_) external onlyOwner {
        if (feeRecipient_ == address(0)) revert InvalidConfig();
        feeToken = IERC20(feeToken_);
        fee = fee_;
        feeRecipient = feeRecipient_;
        emit FeeChanged(feeToken_, fee_, feeRecipient_);
    }
}
