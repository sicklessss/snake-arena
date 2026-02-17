require('dotenv').config();

const CONTRACTS = {
    botRegistry: process.env.BOT_REGISTRY_CONTRACT || '0xB1D0a2C155afaa35b5eBA7aABd38c38A05D5fdD4',
    rewardDistributor: process.env.REWARD_DISTRIBUTOR_CONTRACT || '0x31367c31a0dB8b1A10A4b485A460d0D140BE7B5b',
    pariMutuel: process.env.PARIMUTUEL_CONTRACT || '0x0c1C737150a22112fE2be7dB2D46001A9f83F95f',
    snakeBotNFT: process.env.NFT_CONTRACT || '0x1f73351052d763579EDac143890E903ff0984aa3',
    referralRewards: process.env.REFERRAL_CONTRACT || '0xc20A69eddf5701738623989Fdb3511722cEBcFC8'
};

const BOT_REGISTRY_ABI = [
    "function createBot(bytes32 _botId, string calldata _botName, address _creator) external",
    "function bots(bytes32) external view returns (bytes32 botId, string memory botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice)",
    "function getBotById(bytes32 _botId) external view returns (tuple(bytes32 botId, string botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice))",
    "function getOwnerBots(address _owner) external view returns (bytes32[] memory)",
    "function getBotsForSale(uint256 _offset, uint256 _limit) external view returns (tuple(bytes32 botId, string botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice)[] memory)",
    "function registrationFee() external view returns (uint256)",
    "event BotCreated(bytes32 indexed botId, string botName, address indexed creator)",
    "event BotRegistered(bytes32 indexed botId, address indexed owner, uint256 fee)"
];

const REWARD_DISTRIBUTOR_ABI = [
    "function pendingRewards(bytes32) external view returns (uint256)",
    "function claimRewards(bytes32 _botId) external",
    "function claimRewardsBatch(bytes32[] calldata _botIds) external",
    "function MIN_CLAIM_THRESHOLD() external view returns (uint256)"
];

const SNAKE_BOT_NFT_ABI = [
    "function tokenURI(uint256 tokenId) external view returns (string memory)",
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function botToTokenId(bytes32) external view returns (uint256)",
    "function tokenIdToBot(uint256) external view returns (bytes32)"
];

const REFERRAL_REWARDS_ABI = [
    "function claim(uint256 amount, uint256 nonce, bytes calldata signature) external",
    "function getClaimed(address user) external view returns (uint256)",
    "function getNonce(address user) external view returns (uint256)",
    "function nonces(address) external view returns (uint256)",
    "function claimed(address) external view returns (uint256)",
    "event Claimed(address indexed user, uint256 amount, uint256 nonce, uint256 newTotalClaimed)"
];

const SNAKE_COLORS = [
    '#FF0000', '#00FF00', '#0088FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FF8800', '#88FF00',
    '#FF0088', '#00FF88', '#8800FF', '#FFFFFF', '#FF6666', '#66FF66', '#6666FF', '#FFAA00'
];

const CONFIG = {
    gridSize: 30,
    matchDuration: 180, // 3 minutes
    maxFood: 5,
    deathBlinkTurns: 24,
    maxWorkers: 300
};

const SPAWN_POINTS = [
    { x: 5, y: 5, dir: { x: 1, y: 0 } },
    { x: 25, y: 5, dir: { x: -1, y: 0 } },
    { x: 5, y: 25, dir: { x: 1, y: 0 } },
    { x: 25, y: 25, dir: { x: -1, y: 0 } },
    { x: 15, y: 3, dir: { x: 0, y: 1 } },
    { x: 15, y: 27, dir: { x: 0, y: -1 } },
    { x: 3, y: 15, dir: { x: 1, y: 0 } },
    { x: 27, y: 15, dir: { x: -1, y: 0 } },
    { x: 10, y: 10, dir: { x: 1, y: 0 } },
    { x: 20, y: 20, dir: { x: -1, y: 0 } },
];

const ROOM_LIMITS = {
    performance: 6,
    competitive: 2,
};

const ROOM_MAX_PLAYERS = {
    performance: 10,
    competitive: 10,
};

module.exports = {
    CONTRACTS,
    BOT_REGISTRY_ABI,
    REWARD_DISTRIBUTOR_ABI,
    SNAKE_BOT_NFT_ABI,
    REFERRAL_REWARDS_ABI,
    SNAKE_COLORS,
    CONFIG,
    SPAWN_POINTS,
    ROOM_LIMITS,
    ROOM_MAX_PLAYERS,
    ADMIN_KEY: process.env.ADMIN_KEY || null,
    BOT_UPLOAD_KEY: process.env.BOT_UPLOAD_KEY || process.env.ADMIN_KEY,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    BACKEND_PRIVATE_KEY: process.env.BACKEND_PRIVATE_KEY
};
