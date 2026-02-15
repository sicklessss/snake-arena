// Contract addresses - Base Sepolia
export const CONTRACTS = {
  botRegistry: '0x303FC17a0a849d0aB5Ca9b6C0c78916014f23D1c',
  rewardDistributor: '0xD419fE00b20f472132A5B3E803962Ae4fd962d4B',
  pariMutuel: '0x01C38985C826c8D16E057d7d590Da0A37947fed7'
};

// BotRegistry ABI
export const BOT_REGISTRY_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "registerBot", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "uint256", "name": "_price", "type": "uint256" }], "name": "listForSale", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "cancelSale", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "buyBot", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [], "name": "registrationFee", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "getBotById", "outputs": [{ "components": [{ "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "internalType": "string", "name": "botName", "type": "string" }, { "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "bool", "name": "registered", "type": "bool" }, { "internalType": "uint256", "name": "registeredAt", "type": "uint256" }, { "internalType": "uint256", "name": "matchesPlayed", "type": "uint256" }, { "internalType": "uint256", "name": "totalEarnings", "type": "uint256" }, { "internalType": "uint256", "name": "salePrice", "type": "uint256" }], "internalType": "struct BotRegistry.Bot", "name": "", "type": "tuple" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "getOwnerBots", "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_offset", "type": "uint256" }, { "internalType": "uint256", "name": "_limit", "type": "uint256" }], "name": "getBotsForSale", "outputs": [{ "components": [{ "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "internalType": "string", "name": "botName", "type": "string" }, { "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "bool", "name": "registered", "type": "bool" }, { "internalType": "uint256", "name": "registeredAt", "type": "uint256" }, { "internalType": "uint256", "name": "matchesPlayed", "type": "uint256" }, { "internalType": "uint256", "name": "totalEarnings", "type": "uint256" }, { "internalType": "uint256", "name": "salePrice", "type": "uint256" }], "internalType": "struct BotRegistry.Bot[]", "name": "", "type": "tuple[]" }], "stateMutability": "view", "type": "function" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "indexed": true, "internalType": "address", "name": "owner", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "fee", "type": "uint256" }], "name": "BotRegistered", "type": "event" }
] as const;

// RewardDistributor ABI
export const REWARD_DISTRIBUTOR_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "claimRewards", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32[]", "name": "_botIds", "type": "bytes32[]" }], "name": "claimRewardsBatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "pendingRewards", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "MIN_CLAIM_THRESHOLD", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

// SnakeArenaPariMutuel ABI (for betting)
export const PARI_MUTUEL_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "placeBet", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimWinnings", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
] as const;
