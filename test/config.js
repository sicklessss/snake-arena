// Test configuration - all constants in one place
module.exports = {
    // Target server
    BASE_URL: 'http://107.174.228.72:3000',
    WS_URL: 'ws://107.174.228.72:3000',

    // Admin key (from .env)
    ADMIN_KEY: process.env.ADMIN_KEY || '',

    // Blockchain config (Base Sepolia)
    RPC_URL: 'https://sepolia.base.org',
    CHAIN_ID: 84532,
    PRIVATE_KEY: process.env.TEST_PRIVATE_KEY || '',

    // Contract addresses (v5.1 from server.js)
    CONTRACTS: {
        botRegistry: '0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800',
        rewardDistributor: '0xB354e3062b493466da0c1898Ede5aabF56279046',
        pariMutuel: '0x1fDDd7CC864F85B20F1EF27221B5DD6C5Ffe413d',
        snakeBotNFT: '0xF269b84543041EA350921E3e3A2Da0B14B85453C',
        referralRewards: '0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F',
    },

    // ABIs (matching server.js)
    BOT_REGISTRY_ABI: [
        "function createBot(bytes32 _botId, string calldata _botName, address _creator) external",
        "function bots(bytes32) external view returns (bytes32 botId, string memory botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice)",
        "function getBotById(bytes32 _botId) external view returns (tuple(bytes32 botId, string botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice))",
        "function getOwnerBots(address _owner) external view returns (bytes32[] memory)",
        "function getBotsForSale(uint256 _offset, uint256 _limit) external view returns (tuple(bytes32 botId, string botName, address owner, bool registered, uint256 registeredAt, uint256 matchesPlayed, uint256 totalEarnings, uint256 salePrice)[] memory)",
        "function registrationFee() external view returns (uint256)",
        "event BotCreated(bytes32 indexed botId, string botName, address indexed creator)",
        "event BotRegistered(bytes32 indexed botId, address indexed owner, uint256 fee)"
    ],
    REWARD_DISTRIBUTOR_ABI: [
        "function pendingRewards(bytes32) external view returns (uint256)",
        "function claimRewards(bytes32 _botId) external",
        "function MIN_CLAIM_THRESHOLD() external view returns (uint256)"
    ],
    SNAKE_BOT_NFT_ABI: [
        "function tokenURI(uint256 tokenId) external view returns (string memory)",
        "function ownerOf(uint256 tokenId) external view returns (address)",
        "function botToTokenId(bytes32) external view returns (uint256)",
        "function tokenIdToBot(uint256) external view returns (bytes32)",
        "function getBotsByOwner(address _owner) external view returns (bytes32[] memory)"
    ],
    REFERRAL_REWARDS_ABI: [
        "function claim(uint256 amount, uint256 nonce, bytes calldata signature) external",
        "function getClaimed(address user) external view returns (uint256)",
        "function getNonce(address user) external view returns (uint256)",
        "function nonces(address) external view returns (uint256)",
        "function claimed(address) external view returns (uint256)",
        "event Claimed(address indexed user, uint256 amount, uint256 nonce, uint256 newTotalClaimed)"
    ],
    PARI_MUTUEL_ABI: [
        "function createMatch(uint256 _matchId, uint256 _startTime) external",
        "function settleMatch(uint256 _matchId, bytes32[] calldata _winners) external",
        "function cancelMatch(uint256 _matchId, string calldata _reason) external",
        "function placeBet(uint256 _matchId, bytes32 _botId, uint256 _amount) external",
        "function claimWinnings(uint256 _matchId) external",
        "function claimRefund(uint256 _matchId) external",
        "function authorizeOracle(address _oracle) external",
        "function matches(uint256) external view returns (uint256 matchId, uint256 startTime, uint256 endTime, uint256 totalPool, bool settled, bool cancelled)",
        "function getUserPotentialWinnings(uint256 _matchId, address _bettor) external view returns (uint256)",
        "function getMatchBets(uint256 _matchId) external view returns (tuple(address bettor, bytes32 botId, uint256 amount, bool claimed)[])",
        "function botTotalBets(uint256, bytes32) external view returns (uint256)",
        "function getCurrentOdds(uint256 _matchId, bytes32 _botId) external view returns (uint256)",
        "event BetPlaced(uint256 indexed matchId, address indexed bettor, bytes32 indexed botId, uint256 amount, uint256 betIndex)",
        "event MatchSettled(uint256 indexed matchId, bytes32[] winners, uint256 totalPool, uint256 platformRake, uint256 botRewards)"
    ],

    // Timeouts
    HTTP_TIMEOUT: 10000,
    WS_TIMEOUT: 8000,
    BLOCKCHAIN_TIMEOUT: 30000,
};
