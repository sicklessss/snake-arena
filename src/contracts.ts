// Contract addresses - Base Sepolia (synced with server.js 2026-02-20)
export const CONTRACTS = {
  botRegistry: '0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800',
  rewardDistributor: '0xB354e3062b493466da0c1898Ede5aabF56279046',
  pariMutuel: '0x1fDDd7CC864F85B20F1EF27221B5DD6C5Ffe413d',
  snakeBotNFT: '0xF269b84543041EA350921E3e3A2Da0B14B85453C',
  // USDC on Base Sepolia
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

// BotRegistry ABI
export const BOT_REGISTRY_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "address", "name": "_inviter", "type": "address" }], "name": "registerBot", "outputs": [], "stateMutability": "payable", "type": "function" },
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

// SnakeArenaPariMutuel ABI (USDC-based prediction)
export const PARI_MUTUEL_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "uint256", "name": "_amount", "type": "uint256" }], "name": "placeBet", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimWinnings", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
] as const;

// ERC20 ABI (for USDC approve)
export const ERC20_ABI = [
  { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;
