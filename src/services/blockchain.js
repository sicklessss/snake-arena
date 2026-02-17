const { ethers } = require('ethers');
const log = require('../utils/logger');
const { 
    CONTRACTS, 
    BOT_REGISTRY_ABI, 
    REWARD_DISTRIBUTOR_ABI, 
    SNAKE_BOT_NFT_ABI, 
    REFERRAL_REWARDS_ABI, 
    BACKEND_PRIVATE_KEY 
} = require('../config/constants');

const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const backendWallet = BACKEND_PRIVATE_KEY 
    ? new ethers.Wallet(BACKEND_PRIVATE_KEY, provider)
    : null;

let botRegistryContract = null;
let rewardDistributorContract = null;
let snakeBotNFTContract = null;
let referralRewardsContract = null;

function initContracts() {
    if (backendWallet && CONTRACTS.botRegistry && CONTRACTS.botRegistry !== '0x0000000000000000000000000000000000000000') {
        try {
            botRegistryContract = new ethers.Contract(CONTRACTS.botRegistry, BOT_REGISTRY_ABI, backendWallet);
            rewardDistributorContract = new ethers.Contract(CONTRACTS.rewardDistributor, REWARD_DISTRIBUTOR_ABI, provider);
            snakeBotNFTContract = new ethers.Contract(CONTRACTS.snakeBotNFT, SNAKE_BOT_NFT_ABI, provider);
            referralRewardsContract = new ethers.Contract(CONTRACTS.referralRewards, REFERRAL_REWARDS_ABI, provider);
            log.important(`[Blockchain] Contracts initialized. Registry: ${CONTRACTS.botRegistry}, NFT: ${CONTRACTS.snakeBotNFT}, Referral: ${CONTRACTS.referralRewards}`);
        } catch (e) {
            log.error('[Blockchain] Init failed:', e.message);
        }
    } else {
        log.warn('[Blockchain] Contracts not initialized - check env vars or deploy contracts');
    }
}

// Helper to get contracts safely
function getContracts() {
    if (!botRegistryContract) {
        // Try to init if not ready
        initContracts();
    }
    return {
        botRegistryContract,
        rewardDistributorContract,
        snakeBotNFTContract,
        referralRewardsContract,
        provider,
        backendWallet
    };
}

module.exports = {
    initContracts,
    getContracts,
    provider,
    backendWallet
};
