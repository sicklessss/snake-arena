const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const log = require('../utils/logger');
const { rateLimit, requireAdminKey, requireUploadKey } = require('../middleware/auth');
const { getBot, updateBot, getAllBots, saveBotRegistry } = require('../services/bot-registry');
const { startBotWorker, stopBotWorker, getActiveWorkers } = require('../services/sandbox');
const { getContracts } = require('../services/blockchain');
const { assignRoomForJoin } = require('../services/room-manager');

const BOTS_DIR = path.join(__dirname, '../../bots');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });

function createBotId() {
    return 'bot_' + Math.random().toString(36).slice(2, 8);
}

// Register
router.post('/register', rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    const { name, price, owner, botType } = req.body || {};
    const safeName = (name || 'AgentBot').toString().slice(0, 32);
    
    const existing = Object.values(getAllBots()).find(m => m.name === safeName);
    if (existing) {
        return res.status(400).json({ error: 'name_taken', message: `Bot name "${safeName}" taken` });
    }
    
    const id = createBotId();
    const bot = {
        id,
        name: safeName,
        owner: (owner || 'unknown').toString().slice(0, 64),
        price: Number(price || 0),
        botType: botType || 'agent',
        credits: 99999,
        createdAt: Date.now()
    };
    updateBot(id, bot);

    const room = assignRoomForJoin({ name: bot.name, botType: bot.botType, botPrice: bot.price, arenaType: 'performance' });
    const payload = { ...bot };
    if (room) {
        payload.arenaId = room.id;
        payload.wsUrl = 'ws://' + req.headers.host + '?arenaId=' + room.id;
    } else {
        payload.arenaId = null;
        payload.error = 'full_or_payment_required';
    }
    res.json(payload);
});

// Register Unlimited
router.post('/register-unlimited', (req, res) => {
    const { botId, txHash } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'missing_botId' });
    
    const bot = getBot(botId);
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    
    updateBot(botId, { 
        unlimited: true, 
        credits: 999999, 
        registeredTxHash: txHash || null 
    });
    
    log.important(`[Register] Bot ${bot.name} (${botId}) registered unlimited. tx: ${txHash}`);
    res.json({ ok: true, botId, message: 'Bot registered unlimited' });
});

// Lookup
router.get('/lookup', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const entry = Object.values(getAllBots()).find(m => m.name === name.toString());
    if (!entry) return res.status(404).json({ error: 'bot_not_found' });
    res.json({ botId: entry.id, name: entry.name, credits: entry.credits });
});

// Get by Name
router.get('/by-name/:name', (req, res) => {
    const { name } = req.params;
    const bot = Object.values(getAllBots()).find(b => b.name.toLowerCase() === name.toLowerCase());
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    res.json({ ok: true, ...bot });
});

// Get Bot
router.get('/:botId', (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    res.json(bot);
});

// Credits
router.get('/:botId/credits', (req, res) => {
    const bot = getBot(req.params.botId);
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    res.json({ credits: bot.credits });
});

// On-chain info
router.get('/onchain/:botId', async (req, res) => {
    try {
        const { botRegistryContract } = getContracts();
        if (!botRegistryContract) return res.status(503).json({ error: 'contracts_not_initialized' });
        
        const bot = await botRegistryContract.getBotById(ethers.encodeBytes32String(req.params.botId));
        res.json({
            botId: bot.botId,
            botName: bot.botName,
            owner: bot.owner,
            registered: bot.registered,
            registeredAt: Number(bot.registeredAt) * 1000,
            matchesPlayed: Number(bot.matchesPlayed),
            totalEarnings: ethers.formatEther(bot.totalEarnings),
            salePrice: ethers.formatEther(bot.salePrice),
            forSale: bot.salePrice > 0
        });
    } catch (e) {
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// NFT info
router.get('/nft/:botId', async (req, res) => {
    try {
        const { snakeBotNFTContract } = getContracts();
        if (!snakeBotNFTContract) return res.status(503).json({ error: 'nft_contract_not_initialized' });
        
        const tokenId = await snakeBotNFTContract.botToTokenId(ethers.encodeBytes32String(req.params.botId));
        if (tokenId === 0n) return res.json({ hasNFT: false, botId: req.params.botId });
        
        const tokenURI = await snakeBotNFTContract.tokenURI(tokenId);
        const owner = await snakeBotNFTContract.ownerOf(tokenId);
        
        res.json({ hasNFT: true, botId: req.params.botId, tokenId: Number(tokenId), tokenURI, owner });
    } catch (e) {
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Rewards
router.get('/rewards/:botId', async (req, res) => {
    try {
        const { rewardDistributorContract } = getContracts();
        if (!rewardDistributorContract) return res.status(503).json({ error: 'contracts_not_initialized' });
        
        const pending = await rewardDistributorContract.pendingRewards(ethers.encodeBytes32String(req.params.botId));
        const threshold = await rewardDistributorContract.MIN_CLAIM_THRESHOLD();
        
        res.json({
            botId: req.params.botId,
            pendingRewards: ethers.formatEther(pending),
            canClaim: pending >= threshold,
            threshold: ethers.formatEther(threshold)
        });
    } catch (e) {
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Registration Fee
router.get('/fee/registration', async (req, res) => {
    try {
        const { botRegistryContract } = getContracts();
        if (!botRegistryContract) return res.status(503).json({ error: 'contracts_not_initialized' });
        const fee = await botRegistryContract.registrationFee();
        res.json({ fee: ethers.formatEther(fee), feeWei: fee.toString() });
    } catch (e) {
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Upload
router.post('/upload', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
    try {
        const { botId, name, owner } = req.query;
        let scriptContent = req.body;
        
        if (!scriptContent || typeof scriptContent !== 'string') {
            return res.status(400).json({ error: 'invalid_script', message: 'Send text/javascript body' });
        }
        if (scriptContent.length > 200_000) return res.status(413).json({ error: 'payload_too_large' });

        // Security Scan
        const forbidden = ['require', 'import', 'process', 'fs', 'net', 'http', 'https', 'child_process', 'eval', 'Function', 'constructor', 'global', 'Buffer'];
        const risk = forbidden.find(k => new RegExp(`\\b${k}\\b`).test(scriptContent));
        if (risk) return res.status(400).json({ error: 'security_violation', message: `Forbidden: ${risk}` });
        
        // Name check
        if (name) {
            const safeName = name.toString().slice(0, 32);
            const existing = Object.entries(getAllBots()).find(([id, m]) => m.name === safeName && id !== botId);
            if (existing) return res.status(400).json({ error: 'name_taken', message: `Name "${safeName}" taken` });
        }

        let targetBotId = botId;
        if (!targetBotId) {
            targetBotId = createBotId();
            updateBot(targetBotId, {
                id: targetBotId,
                name: (name || 'Bot-' + targetBotId.substr(-4)).toString().slice(0, 32),
                credits: 99999,
                botType: 'agent',
                createdAt: Date.now(),
                owner: owner?.toString().toLowerCase() || null
            });
        } else if (!getBot(targetBotId)) {
            return res.status(404).json({ error: 'bot_not_found' });
        }

        const scriptPath = path.join(BOTS_DIR, `${targetBotId}.js`);
        fs.writeFileSync(scriptPath, scriptContent);
        
        updateBot(targetBotId, { scriptPath });
        if (name) updateBot(targetBotId, { name: name.toString().slice(0, 32) });
        if (owner) updateBot(targetBotId, { owner: owner.toString().toLowerCase() });

        // On-chain create (optional)
        const { botRegistryContract } = getContracts();
        if (botRegistryContract && !botId) {
            try {
                const tx = await botRegistryContract.createBot(
                    ethers.encodeBytes32String(targetBotId),
                    getBot(targetBotId).name,
                    ethers.ZeroAddress
                );
                // Non-blocking wait? or just fire and forget for speed?
                // tx.wait(); 
                log.important(`[Blockchain] Bot ${targetBotId} creating... tx: ${tx.hash}`);
            } catch (e) {
                log.warn('[Blockchain] Failed to create bot:', e.message);
            }
        }

        // Auto-start
        startBotWorker(targetBotId);

        res.json({ 
            ok: true, 
            botId: targetBotId, 
            name: getBot(targetBotId).name,
            owner: getBot(targetBotId).owner,
            running: true,
            message: 'Uploaded and started' 
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'upload_failed' });
    }
});

// Claim
router.post('/claim', async (req, res) => {
    const { name, address } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'missing_params' });
    
    const botEntry = Object.values(getAllBots()).find(b => b.name.toLowerCase() === name.toLowerCase());
    if (!botEntry) return res.status(404).json({ error: 'bot_not_found' });
    
    if (botEntry.owner) return res.status(400).json({ error: 'already_claimed' });
    
    updateBot(botEntry.id, { owner: address.toLowerCase() });
    res.json({ ok: true, message: 'Claimed', botId: botEntry.id, owner: address.toLowerCase() });
});

// User Bots
router.get('/user/bots', (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'missing_address' });
    
    const userBots = Object.values(getAllBots())
        .filter(b => b.owner?.toLowerCase() === address.toString().toLowerCase())
        .map(b => ({
            botId: b.id,
            name: b.name,
            credits: b.credits,
            running: b.running || false,
            botType: b.botType || 'agent',
            createdAt: b.createdAt
        }));
    res.json({ ok: true, bots: userBots, count: userBots.length });
});

module.exports = router;
