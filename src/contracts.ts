// Contract addresses - Base Sepolia (synced with server.js 2026-02-21)
export const CONTRACTS = {
  botRegistry: '0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800',
  rewardDistributor: '0xB354e3062b493466da0c1898Ede5aabF56279046',
  pariMutuel: '0x35c8660C448Ccc5eef716E5c4aa2455c82B843C7',
  snakeBotNFT: '0xF269b84543041EA350921E3e3A2Da0B14B85453C',
  // BotMarketplace — NFT escrow marketplace (deploy and update address)
  botMarketplace: '0x3088D308148B1FE6BE61770E2Bb78B41852Db4fC',
  // USDC on Base Sepolia
  usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // ReferralRewards contract
  referralRewards: '0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F',
};

// BotRegistry ABI
export const BOT_REGISTRY_ABI = [
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }, { "internalType": "address", "name": "_inviter", "type": "address" }], "name": "registerBot", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [], "name": "registrationFee", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "getBotById", "outputs": [{ "components": [{ "internalType": "bytes32", "name": "botId", "type": "bytes32" }, { "internalType": "string", "name": "botName", "type": "string" }, { "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "bool", "name": "registered", "type": "bool" }, { "internalType": "uint256", "name": "registeredAt", "type": "uint256" }, { "internalType": "uint256", "name": "matchesPlayed", "type": "uint256" }, { "internalType": "uint256", "name": "totalEarnings", "type": "uint256" }, { "internalType": "uint256", "name": "salePrice", "type": "uint256" }], "internalType": "struct BotRegistry.Bot", "name": "", "type": "tuple" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "getOwnerBots", "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }], "stateMutability": "view", "type": "function" },
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
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "uint256", "name": "_startTime", "type": "uint256" }], "name": "createMatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32[]", "name": "_winners", "type": "bytes32[]" }], "name": "settleMatch", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimWinnings", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }], "name": "claimRefund", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "matches", "outputs": [{ "internalType": "uint256", "name": "matchId", "type": "uint256" }, { "internalType": "uint256", "name": "startTime", "type": "uint256" }, { "internalType": "uint256", "name": "endTime", "type": "uint256" }, { "internalType": "uint256", "name": "totalPool", "type": "uint256" }, { "internalType": "bool", "name": "settled", "type": "bool" }, { "internalType": "bool", "name": "cancelled", "type": "bool" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }, { "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "botTotalBets", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "_matchId", "type": "uint256" }, { "internalType": "bytes32", "name": "_botId", "type": "bytes32" }], "name": "getCurrentOdds", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
] as const;

// ERC20 ABI (for USDC approve)
export const ERC20_ABI = [
  { "inputs": [{ "internalType": "address", "name": "spender", "type": "address" }, { "internalType": "uint256", "name": "amount", "type": "uint256" }], "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }, { "internalType": "address", "name": "spender", "type": "address" }], "name": "allowance", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" }
] as const;

// BotMarketplace ABI — NFT escrow marketplace
export const BOT_MARKETPLACE_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "list", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "buy", "outputs": [], "stateMutability": "payable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "cancel", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [], "name": "getActiveListings", "outputs": [{ "internalType": "uint256[]", "name": "tokenIds", "type": "uint256[]" }, { "internalType": "address[]", "name": "sellers", "type": "address[]" }, { "internalType": "uint256[]", "name": "prices", "type": "uint256[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "listings", "outputs": [{ "internalType": "address", "name": "seller", "type": "address" }, { "internalType": "uint256", "name": "price", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "feePercent", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "Listed", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }, { "indexed": true, "internalType": "address", "name": "buyer", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "price", "type": "uint256" }], "name": "Sold", "type": "event" },
  { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "uint256", "name": "tokenId", "type": "uint256" }, { "indexed": true, "internalType": "address", "name": "seller", "type": "address" }], "name": "Cancelled", "type": "event" }
] as const;

// SnakeBotNFT ABI — for approve + tokenId lookups
export const SNAKE_BOT_NFT_ABI = [
  { "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "approve", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "getApproved", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "name": "botToTokenId", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "name": "tokenIdToBot", "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "getBotsByOwner", "outputs": [{ "internalType": "bytes32[]", "name": "", "type": "bytes32[]" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }], "name": "ownerOf", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" },
] as const;

// ReferralRewards ABI
export const REFERRAL_REWARDS_ABI = [
  { "inputs": [{ "internalType": "uint256", "name": "amount", "type": "uint256" }, { "internalType": "uint256", "name": "nonce", "type": "uint256" }, { "internalType": "bytes", "name": "signature", "type": "bytes" }], "name": "claim", "outputs": [], "stateMutability": "nonpayable", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "user", "type": "address" }], "name": "getClaimed", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "user", "type": "address" }], "name": "getNonce", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
] as const;
