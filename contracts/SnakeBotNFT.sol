// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SnakeBotNFT v2
 * @notice NFT for registered Snake Arena bots. Uses ERC721Enumerable so
 *         wallets can enumerate their bots on-chain without a backend.
 */
contract SnakeBotNFT is ERC721Enumerable, Ownable {

    uint256 private _tokenIds;
    address public botRegistry;

    mapping(bytes32 => uint256) public botToTokenId;
    mapping(uint256 => bytes32) public tokenIdToBot;

    event BotNFTMinted(uint256 indexed tokenId, bytes32 indexed botId, address indexed owner);

    constructor() ERC721("SnakeBot", "SNAKE") Ownable(msg.sender) {}

    modifier onlyBotRegistry() {
        require(msg.sender == botRegistry, "Only BotRegistry");
        _;
    }

    function setBotRegistry(address _registry) external onlyOwner {
        botRegistry = _registry;
    }

    /**
     * @notice Mint a bot NFT. Called by BotRegistry on registerBot().
     * @param _to      Recipient (the registering wallet)
     * @param _botId   bytes32 bot ID (e.g. encodeBytes32String("bot_zu3up5"))
     * @param _botName Bot display name (stored in event / metadata)
     */
    function mintBotNFT(address _to, bytes32 _botId, string calldata _botName) external onlyBotRegistry returns (uint256) {
        require(botToTokenId[_botId] == 0, "Bot already has NFT");

        _tokenIds++;
        uint256 newTokenId = _tokenIds;

        _safeMint(_to, newTokenId);

        botToTokenId[_botId] = newTokenId;
        tokenIdToBot[newTokenId] = _botId;

        emit BotNFTMinted(newTokenId, _botId, _to);

        return newTokenId;
    }

    /**
     * @notice Return all botIds owned by a wallet. Frontend calls this on connect.
     */
    function getBotsByOwner(address _owner) external view returns (bytes32[] memory) {
        uint256 count = balanceOf(_owner);
        bytes32[] memory botIds = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(_owner, i);
            botIds[i] = tokenIdToBot[tokenId];
        }
        return botIds;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        bytes32 botId = tokenIdToBot[tokenId];
        string memory botIdStr = bytes32ToHexStr(botId);

        string memory json = string(abi.encodePacked(
            '{"name":"SnakeBot #', uintToString(tokenId), '",',
            '"description":"A battle-ready snake bot on Snake Arena",',
            '"attributes":[{"trait_type":"Bot ID","value":"', botIdStr, '"}]}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", base64Encode(bytes(json))));
    }

    // ============ Internal helpers ============

    function bytes32ToHexStr(bytes32 _b) internal pure returns (string memory) {
        bytes memory bytesArray = new bytes(64);
        for (uint8 i = 0; i < 32; i++) {
            uint8 char = uint8(bytes1(_b << (i * 8)));
            uint8 hi = char / 16;
            uint8 lo = char % 16;
            bytesArray[i * 2]     = hi < 10 ? bytes1(hi + 48) : bytes1(hi + 87);
            bytesArray[i * 2 + 1] = lo < 10 ? bytes1(lo + 48) : bytes1(lo + 87);
        }
        return string(bytesArray);
    }

    function uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function base64Encode(bytes memory data) internal pure returns (string memory) {
        string memory TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        if (len == 0) return "";
        uint256 encodedLen = 4 * ((len + 2) / 3);
        bytes memory result = new bytes(encodedLen + 32);
        bytes memory table = bytes(TABLE);
        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            for { let i := 0 } lt(i, len) { i := add(i, 3) } {
                let input := and(mload(add(data, i)), 0xffffff)
                let out := mload(add(tablePtr, and(shr(18, input), 0x3F)))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(12, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(shr(6, input), 0x3F))), 0xFF))
                out := shl(8, out)
                out := add(out, and(mload(add(tablePtr, and(input, 0x3F))), 0xFF))
                out := shl(224, out)
                mstore(resultPtr, out)
                resultPtr := add(resultPtr, 4)
            }
            switch mod(len, 3)
            case 1 { mstore(sub(resultPtr, 2), shl(240, 0x3d3d)) }
            case 2 { mstore(sub(resultPtr, 1), shl(248, 0x3d)) }
        }
        return string(result);
    }
}
