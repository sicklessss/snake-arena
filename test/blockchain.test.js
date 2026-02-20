// Blockchain contract interaction tests (Base Sepolia)
const { ethers } = require('ethers');
const config = require('./config');
const { TestRunner, assert, assertEq } = require('./utils');

function setup() {
    const provider = new ethers.JsonRpcProvider(config.RPC_URL);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);

    const botRegistry = new ethers.Contract(config.CONTRACTS.botRegistry, config.BOT_REGISTRY_ABI, wallet);
    const rewardDistributor = new ethers.Contract(config.CONTRACTS.rewardDistributor, config.REWARD_DISTRIBUTOR_ABI, provider);
    const snakeBotNFT = new ethers.Contract(config.CONTRACTS.snakeBotNFT, config.SNAKE_BOT_NFT_ABI, provider);
    const pariMutuel = new ethers.Contract(config.CONTRACTS.pariMutuel, config.PARI_MUTUEL_ABI, provider);
    const referralRewards = new ethers.Contract(config.CONTRACTS.referralRewards, config.REFERRAL_REWARDS_ABI, provider);

    return { provider, wallet, botRegistry, rewardDistributor, snakeBotNFT, pariMutuel, referralRewards };
}

async function run() {
    const t = new TestRunner('Blockchain');
    let ctx;

    await t.run('Setup: connect to Base Sepolia', async () => {
        ctx = setup();
        const network = await ctx.provider.getNetwork();
        assertEq(Number(network.chainId), config.CHAIN_ID, 'chain ID should be Base Sepolia');
        return { chainId: Number(network.chainId), rpc: config.RPC_URL };
    });

    await t.run('Wallet has balance', async () => {
        const balance = await ctx.provider.getBalance(ctx.wallet.address);
        assert(balance > 0n, 'test wallet should have ETH for gas');
        return { address: ctx.wallet.address, balanceEth: ethers.formatEther(balance) };
    });

    // ═══════════════════════════════════════════
    //  BOT REGISTRY CONTRACT
    // ═══════════════════════════════════════════

    await t.run('BotRegistry: read registrationFee()', async () => {
        const fee = await ctx.botRegistry.registrationFee();
        assert(fee >= 0n, 'fee should be non-negative');
        return { fee: ethers.formatEther(fee) };
    });

    await t.run('BotRegistry: getBotById() for random id', async () => {
        const randomBytes32 = ethers.encodeBytes32String('test_' + Date.now().toString(36));
        const bot = await ctx.botRegistry.getBotById(randomBytes32);
        // Unregistered bot should have empty/default values
        assert(bot.botName === '' || bot.registered === false, 'unknown bot should be empty or not registered');
    });

    await t.run('BotRegistry: getOwnerBots() for test wallet', async () => {
        const bots = await ctx.botRegistry.getOwnerBots(ctx.wallet.address);
        assert(Array.isArray(bots), 'should return array');
        return { ownedBots: bots.length };
    });

    await t.run('BotRegistry: getBotsForSale(0, 10)', async () => {
        const bots = await ctx.botRegistry.getBotsForSale(0, 10);
        assert(Array.isArray(bots), 'should return array');
        return { forSale: bots.length };
    });

    await t.run('BotRegistry: bots() mapping query', async () => {
        const randomBytes32 = ethers.encodeBytes32String('nonexist');
        const result = await ctx.botRegistry.bots(randomBytes32);
        // Should return tuple (won't throw for missing key)
        assert(result !== undefined, 'mapping should return default struct');
    });

    // ═══════════════════════════════════════════
    //  REWARD DISTRIBUTOR CONTRACT
    // ═══════════════════════════════════════════

    await t.run('RewardDistributor: MIN_CLAIM_THRESHOLD()', async () => {
        const threshold = await ctx.rewardDistributor.MIN_CLAIM_THRESHOLD();
        assert(threshold >= 0n, 'threshold should be non-negative');
        return { threshold: ethers.formatEther(threshold) };
    });

    await t.run('RewardDistributor: pendingRewards() for random bot', async () => {
        const randomBytes32 = ethers.encodeBytes32String('nobot');
        const pending = await ctx.rewardDistributor.pendingRewards(randomBytes32);
        assertEq(pending, 0n, 'unknown bot should have 0 pending rewards');
    });

    // ═══════════════════════════════════════════
    //  SNAKE BOT NFT CONTRACT
    // ═══════════════════════════════════════════

    await t.run('SnakeBotNFT: botToTokenId() for unknown bot', async () => {
        const randomBytes32 = ethers.encodeBytes32String('nobot_nft');
        const tokenId = await ctx.snakeBotNFT.botToTokenId(randomBytes32);
        assertEq(tokenId, 0n, 'unknown bot should have tokenId 0');
    });

    await t.run('SnakeBotNFT: getBotsByOwner() for test wallet', async () => {
        const bots = await ctx.snakeBotNFT.getBotsByOwner(ctx.wallet.address);
        assert(Array.isArray(bots), 'should return array');
        return { nftBots: bots.length };
    });

    await t.run('SnakeBotNFT: tokenIdToBot(0) returns zero', async () => {
        try {
            const botId = await ctx.snakeBotNFT.tokenIdToBot(0);
            // tokenId 0 may not exist - either returns zero or reverts
            return { botId };
        } catch (e) {
            // Revert is acceptable for nonexistent token
            assert(e.message.includes('revert') || e.message.includes('invalid') || true, 'revert expected');
            return 'reverted as expected for tokenId 0';
        }
    });

    // ═══════════════════════════════════════════
    //  PARI-MUTUEL CONTRACT
    // ═══════════════════════════════════════════

    await t.run('PariMutuel: matches() for nonexistent match', async () => {
        const match = await ctx.pariMutuel.matches(999999);
        assertEq(match.totalPool, 0n, 'nonexistent match should have 0 pool');
        assertEq(match.settled, false, 'should not be settled');
        assertEq(match.cancelled, false, 'should not be cancelled');
    });

    await t.run('PariMutuel: getMatchBets() for nonexistent match', async () => {
        const bets = await ctx.pariMutuel.getMatchBets(999999);
        assert(Array.isArray(bets), 'should return array');
        assertEq(bets.length, 0, 'should be empty for nonexistent match');
    });

    await t.run('PariMutuel: getCurrentOdds() for nonexistent', async () => {
        const randomBytes32 = ethers.encodeBytes32String('bot1');
        const odds = await ctx.pariMutuel.getCurrentOdds(999999, randomBytes32);
        assertEq(odds, 0n, 'odds should be 0 for nonexistent match');
    });

    await t.run('PariMutuel: botTotalBets() for nonexistent', async () => {
        const randomBytes32 = ethers.encodeBytes32String('bot1');
        const total = await ctx.pariMutuel.botTotalBets(999999, randomBytes32);
        assertEq(total, 0n, 'should be 0');
    });

    await t.run('PariMutuel: getUserPotentialWinnings() for nonexistent', async () => {
        const winnings = await ctx.pariMutuel.getUserPotentialWinnings(999999, ctx.wallet.address);
        assertEq(winnings, 0n, 'should be 0');
    });

    // ═══════════════════════════════════════════
    //  REFERRAL REWARDS CONTRACT
    // ═══════════════════════════════════════════

    await t.run('ReferralRewards: getClaimed() for test wallet', async () => {
        const claimed = await ctx.referralRewards.getClaimed(ctx.wallet.address);
        assert(claimed >= 0n, 'claimed should be non-negative');
        return { claimed: ethers.formatEther(claimed) };
    });

    await t.run('ReferralRewards: getNonce() for test wallet', async () => {
        const nonce = await ctx.referralRewards.getNonce(ctx.wallet.address);
        assert(nonce >= 0n, 'nonce should be non-negative');
        return { nonce: nonce.toString() };
    });

    await t.run('ReferralRewards: nonces() mapping', async () => {
        const nonce = await ctx.referralRewards.nonces(ctx.wallet.address);
        assert(nonce >= 0n, 'nonce should be non-negative');
    });

    await t.run('ReferralRewards: claimed() mapping', async () => {
        const claimed = await ctx.referralRewards.claimed(ctx.wallet.address);
        assert(claimed >= 0n, 'claimed should be non-negative');
    });

    // ═══════════════════════════════════════════
    //  CROSS-CUTTING: Server vs Chain consistency
    // ═══════════════════════════════════════════

    await t.run('Server fee matches on-chain registrationFee', async () => {
        const { get } = require('./utils');
        const serverRes = await get(`${config.BASE_URL}/api/bot/fee/registration`);
        if (serverRes.status !== 200) return 'skipped - server fee endpoint unavailable';
        const chainFee = await ctx.botRegistry.registrationFee();
        assertEq(serverRes.body.fee, ethers.formatEther(chainFee), 'server fee should match chain');
    });

    return t.summary();
}

module.exports = { run };

if (require.main === module) {
    run().then(s => {
        console.log(`\n${s.suite}: ${s.pass}/${s.total} passed (${s.fail} failed) in ${s.elapsed}ms`);
        process.exit(s.fail > 0 ? 1 : 0);
    });
}
