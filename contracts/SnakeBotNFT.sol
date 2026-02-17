// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SnakeBotNFT
 * @notice Simple NFT for registered Snake Arena bots
 */
contract SnakeBotNFT is ERC721, Ownable {
    
    uint256 private _tokenIds;
    address public botRegistry;
    
    mapping(bytes32 => uint256) public botToTokenId;
    mapping(uint256 => bytes32) public tokenIdToBot;
    
    event BotNFTMinted(uint256 indexed tokenId, bytes32 indexed botId, address indexed owner);
    
    constructor() ERC721("SnakeBot", "SNAKE") {}
    
    modifier onlyBotRegistry() {
        require(msg.sender == botRegistry, "Only BotRegistry");
        _;
    }
    
    function setBotRegistry(address _registry) external onlyOwner {
        botRegistry = _registry;
    }
    
    function mintBotNFT(address _to, bytes32 _botId) external onlyBotRegistry returns (uint256) {
        require(botToTokenId[_botId] == 0, "Bot already has NFT");
        
        _tokenIds++;
        uint256 newTokenId = _tokenIds;
        
        _safeMint(_to, newTokenId);
        
        botToTokenId[_botId] = newTokenId;
        tokenIdToBot[newTokenId] = _botId;
        
        emit BotNFTMinted(newTokenId, _botId, _to);
        
        return newTokenId;
    }
    
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        
        bytes32 botId = tokenIdToBot[tokenId];
        string memory botIdStr = bytes32ToString(botId);
        
        // Simple JSON metadata
        string memory json = string(abi.encodePacked(
            '{"name":"SnakeBot #', uintToString(tokenId), '",',
            '"description":"A battle-ready snake bot",',
            '"image":"https://snake-arena.example.com/nft/', uintToString(tokenId), '.png",',
            '"attributes":[{"trait_type":"Bot ID","value":"', botIdStr, '"}]}'
        ));
        
        return string(abi.encodePacked("data:application/json;base64,", base64Encode(bytes(json))));
    }
    
    function bytes32ToString(bytes32 _bytes32) internal pure returns (string memory) {
        uint8 i = 0;
        bytes memory bytesArray = new bytes(64);
        for (i = 0; i < 32; i++) {
            uint8 char = uint8(bytes1(_bytes32 << (i * 8)));
            uint8 char1 = char / 16;
            uint8 char2 = char % 16;
            bytesArray[i * 2] = char1 < 10 ? bytes1(char1 + 48) : bytes1(char1 + 87);
            bytesArray[i * 2 + 1] = char2 < 10 ? bytes1(char2 + 48) : bytes1(char2 + 87);
        }
        return string(bytesArray);
    }
    
    function uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
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
            
            for {
                let i := 0
            } lt(i, len) {
                i := add(i, 3)
            } {
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
            case 1 {
                mstore(sub(resultPtr, 2), shl(240, 0x3d3d))
            }
            case 2 {
                mstore(sub(resultPtr, 1), shl(248, 0x3d))
            }
        }
        
        return string(result);
    }
}
