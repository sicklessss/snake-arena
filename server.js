require('dotenv').config();

const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Worker } = require('worker_threads');

// --- Blockchain Config ---
const { ethers } = require('ethers');

// Contract addresses (updated 2026-02-19 - v5.1 Fixed PariMutuel)
const CONTRACTS = {
    botRegistry: process.env.BOT_REGISTRY_CONTRACT || '0x25DEA1962A7A3a5fC4E1956E05b5eADE609E0800',
    rewardDistributor: process.env.REWARD_DISTRIBUTOR_CONTRACT || '0xB354e3062b493466da0c1898Ede5aabF56279046',
    pariMutuel: process.env.PARIMUTUEL_CONTRACT || '0x1fDDd7CC864F85B20F1EF27221B5DD6C5Ffe413d',
    snakeBotNFT: process.env.NFT_CONTRACT || '0xF269b84543041EA350921E3e3A2Da0B14B85453C',
    referralRewards: process.env.REFERRAL_CONTRACT || '0xfAA055B73D0CbE3E114152aE38f5E76a09F6524F'
};

// Backend wallet for creating bots on-chain
const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
const backendWallet = process.env.BACKEND_PRIVATE_KEY 
    ? new ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, provider)
    : null;

// Contract ABIs (simplified)
const BOT_REGISTRY_ABI = [
    "function createBot(bytes32 _botId, string calldata _botName, address _creator) external",
    "function registerBot(bytes32 _botId, address _inviter) external payable",
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
    "function mintBotNFT(address _to, bytes32 _botId, string calldata _botName) external returns (uint256)",
    "function tokenURI(uint256 tokenId) external view returns (string memory)",
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function balanceOf(address owner) external view returns (uint256)",
    "function botToTokenId(bytes32) external view returns (uint256)",
    "function tokenIdToBot(uint256) external view returns (bytes32)",
    "function getBotsByOwner(address _owner) external view returns (bytes32[] memory)",
    "function safeTransferFrom(address from, address to, uint256 tokenId) external",
    "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)"
];

// Edit token store: token -> { botId, address, expires }
const editTokens = new Map();
// Clean up expired tokens every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of editTokens.entries()) {
        if (data.expires < now) editTokens.delete(token);
    }
}, 3600_000);

const REFERRAL_REWARDS_ABI = [
    "function claim(uint256 amount, uint256 nonce, bytes calldata signature) external",
    "function getClaimed(address user) external view returns (uint256)",
    "function getNonce(address user) external view returns (uint256)",
    "function nonces(address) external view returns (uint256)",
    "function claimed(address) external view returns (uint256)",
    "event Claimed(address indexed user, uint256 amount, uint256 nonce, uint256 newTotalClaimed)"
];

const PARI_MUTUEL_ABI = [
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
];

// Initialize contracts
let botRegistryContract = null;
let rewardDistributorContract = null;
let snakeBotNFTContract = null;
let referralRewardsContract = null;
let pariMutuelContract = null;

function initContracts() {
    if (backendWallet && CONTRACTS.botRegistry !== '0x0000000000000000000000000000000000000000') {
        botRegistryContract = new ethers.Contract(CONTRACTS.botRegistry, BOT_REGISTRY_ABI, backendWallet);
        rewardDistributorContract = new ethers.Contract(CONTRACTS.rewardDistributor, REWARD_DISTRIBUTOR_ABI, provider);
        snakeBotNFTContract = new ethers.Contract(CONTRACTS.snakeBotNFT, SNAKE_BOT_NFT_ABI, backendWallet);
        referralRewardsContract = new ethers.Contract(CONTRACTS.referralRewards, REFERRAL_REWARDS_ABI, provider);
        pariMutuelContract = new ethers.Contract(CONTRACTS.pariMutuel, PARI_MUTUEL_ABI, backendWallet);
        log.important(`[Blockchain] Contracts initialized. Registry: ${CONTRACTS.botRegistry}, NFT: ${CONTRACTS.snakeBotNFT}, PariMutuel: ${CONTRACTS.pariMutuel}`);

        // Poll for BotRegistered events every 30s (reliable on public RPC, no filter expiry issues)
        let lastCheckedBlock = null;
        async function pollBotRegisteredEvents() {
            try {
                const currentBlock = await provider.getBlockNumber();
                if (lastCheckedBlock === null) {
                    lastCheckedBlock = currentBlock; // start from now
                    return;
                }
                if (currentBlock <= lastCheckedBlock) return;
                const fromBlock = lastCheckedBlock + 1;
                const toBlock = currentBlock;
                const events = await botRegistryContract.queryFilter('BotRegistered', fromBlock, toBlock);
                for (const evt of events) {
                    try {
                        const [botIdBytes32, ownerAddr] = evt.args;
                        const botId = ethers.decodeBytes32String(botIdBytes32).replace(/\0/g, '');
                        const bot = botRegistry[botId];
                        if (bot) {
                            bot.unlimited = true;
                            bot.credits = 999999;
                            saveBotRegistry();
                            log.important(`[Blockchain] BotRegistered: ${bot.name} (${botId}) → unlimited plays granted. Owner: ${ownerAddr}`);
                        } else {
                            log.warn(`[Blockchain] BotRegistered event for unknown local botId: ${botId}`);
                        }
                    } catch (e) {
                        log.error('[Blockchain] BotRegistered event parse error:', e.message);
                    }
                }
                lastCheckedBlock = toBlock;
            } catch (e) {
                log.warn('[Blockchain] pollBotRegisteredEvents error:', e.message);
            }
        }
        setInterval(pollBotRegisteredEvents, 30_000);
        pollBotRegisteredEvents(); // initial run
        log.important('[Blockchain] Polling for BotRegistered events every 30s...');
    } else {
        log.warn('[Blockchain] Contracts not initialized - set env vars or deploy contracts');
    }
}

// --- Logging Config ---
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // 'debug' | 'info' | 'warn' | 'error'
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const log = {
    debug: (...args) => LOG_LEVELS[LOG_LEVEL] <= 0 && console.log('[DEBUG]', ...args),
    info: (...args) => LOG_LEVELS[LOG_LEVEL] <= 1 && console.log('[INFO]', ...args),
    warn: (...args) => LOG_LEVELS[LOG_LEVEL] <= 2 && console.warn('[WARN]', ...args),
    error: (...args) => LOG_LEVELS[LOG_LEVEL] <= 3 && console.error('[ERROR]', ...args),
    important: (...args) => console.log('🔔', ...args), // Always show important events
};

// --- Sandbox Config ---
const BOTS_DIR = path.join(__dirname, 'bots');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });
const MAX_WORKERS = 300;
const activeWorkers = new Map(); // botId -> Worker instance

// --- Referral System Config ---
const REFERRAL_DATA_FILE = path.join(__dirname, 'data', 'referrals.json');
const REFERRAL_POINTS_L1 = 100; // 100 points per direct referral
const REFERRAL_POINTS_L2 = 50;  // 50 points per L2 referral

// Load referral data
let referralData = { users: {}, rewards: {} };
function loadReferralData() {
    try {
        if (fs.existsSync(REFERRAL_DATA_FILE)) {
            referralData = JSON.parse(fs.readFileSync(REFERRAL_DATA_FILE, 'utf8'));
            log.info(`[Referral] Loaded ${Object.keys(referralData.users).length} referral records`);
        }
    } catch (e) {
        log.error('[Referral] Failed to load data:', e.message);
    }
}
function saveReferralData() {
    try {
        const dataDir = path.dirname(REFERRAL_DATA_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(REFERRAL_DATA_FILE, JSON.stringify(referralData, null, 2));
    } catch (e) {
        log.error('[Referral] Failed to save data:', e.message);
    }
}
loadReferralData();

// --- Points System ---
const POINTS_DATA_FILE = path.join(__dirname, 'data', 'points.json');
let pointsData = {}; // { walletAddress: { points: 0, history: [] } }
function loadPoints() {
    try {
        if (fs.existsSync(POINTS_DATA_FILE)) {
            pointsData = JSON.parse(fs.readFileSync(POINTS_DATA_FILE, 'utf8'));
            log.info(`[Points] Loaded ${Object.keys(pointsData).length} point records`);
        }
    } catch (e) {
        log.error('[Points] Failed to load data:', e.message);
    }
}
function savePoints() {
    try {
        const dataDir = path.dirname(POINTS_DATA_FILE);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(POINTS_DATA_FILE, JSON.stringify(pointsData, null, 2));
    } catch (e) {
        log.error('[Points] Failed to save data:', e.message);
    }
}
loadPoints();

// Record referral registration
function recordReferral(user, inviter, txHash, amount) {
    if (!user || !inviter || user.toLowerCase() === inviter.toLowerCase()) return false;

    const userLower = user.toLowerCase();
    const inviterLower = inviter.toLowerCase();

    // Check if user already has inviter
    if (referralData.users[userLower]) return false;

    // Record L1 referral relationship
    referralData.users[userLower] = {
        inviter: inviterLower,
        registeredAt: Date.now(),
        txHash: txHash
    };

    // Award L1 referral points to inviter
    if (!pointsData[inviterLower]) pointsData[inviterLower] = { points: 0, history: [] };
    pointsData[inviterLower].points += REFERRAL_POINTS_L1;
    pointsData[inviterLower].history.push({
        type: 'referral_l1',
        from: userLower,
        points: REFERRAL_POINTS_L1,
        timestamp: Date.now(),
        txHash: txHash
    });

    // L2 referral (inviter's inviter) — award points
    const l2Inviter = referralData.users[inviterLower]?.inviter;
    if (l2Inviter) {
        if (!pointsData[l2Inviter]) pointsData[l2Inviter] = { points: 0, history: [] };
        pointsData[l2Inviter].points += REFERRAL_POINTS_L2;
        pointsData[l2Inviter].history.push({
            type: 'referral_l2',
            from: userLower,
            via: inviterLower,
            points: REFERRAL_POINTS_L2,
            timestamp: Date.now(),
            txHash: txHash
        });
    }

    saveReferralData();
    savePoints();
    log.important(`[Referral] ${userLower} invited by ${inviterLower}, awarded ${REFERRAL_POINTS_L1} points (L1)`);
    return true;
}

// Get referral stats for a user
function getReferralStats(address) {
    const addrLower = address.toLowerCase();
    const user = referralData.users[addrLower];
    const userPoints = pointsData[addrLower] || { points: 0, history: [] };

    // Count invitees
    const invitees = Object.entries(referralData.users)
        .filter(([_, data]) => data.inviter === addrLower)
        .map(([addr, data]) => ({ address: addr, registeredAt: data.registeredAt }));

    // Sum referral points from history
    const referralPointsL1 = userPoints.history
        .filter(h => h.type === 'referral_l1')
        .reduce((sum, h) => sum + (h.points || 0), 0);
    const referralPointsL2 = userPoints.history
        .filter(h => h.type === 'referral_l2')
        .reduce((sum, h) => sum + (h.points || 0), 0);

    return {
        hasInviter: !!user,
        inviter: user?.inviter || null,
        registeredAt: user?.registeredAt || null,
        invitees: invitees,
        inviteeCount: invitees.length,
        rewards: {
            l1Points: referralPointsL1,
            l2Points: referralPointsL2,
            totalPoints: referralPointsL1 + referralPointsL2
        },
        history: userPoints.history.filter(h => h.type === 'referral_l1' || h.type === 'referral_l2')
    };
}

// High-contrast color palette (16 distinct colors)
const SNAKE_COLORS = [
    '#FF0000', // Red
    '#00FF00', // Lime Green
    '#0088FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FF8800', // Orange
    '#88FF00', // Chartreuse
    '#FF0088', // Hot Pink
    '#00FF88', // Spring Green
    '#8800FF', // Purple
    '#FFFFFF', // White
    '#FF6666', // Light Red
    '#66FF66', // Light Green
    '#6666FF', // Light Blue
    '#FFAA00', // Amber
];
let colorIndex = 0;
function getNextColor() {
    const color = SNAKE_COLORS[colorIndex % SNAKE_COLORS.length];
    colorIndex++;
    return color;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Security Config ---
const ADMIN_KEY = process.env.ADMIN_KEY || null;
const BOT_UPLOAD_KEY = process.env.BOT_UPLOAD_KEY || ADMIN_KEY;
const MAX_NAME_LEN = 32;
const MAX_BOT_ID_LEN = 32;

function getClientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return xf.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max }) {
    const store = new Map();
    return (req, res, next) => {
        const ip = getClientIp(req);
        const now = Date.now();
        let entry = store.get(ip) || { count: 0, reset: now + windowMs };
        if (now > entry.reset) {
            entry = { count: 0, reset: now + windowMs };
        }
        entry.count += 1;
        store.set(ip, entry);
        if (entry.count > max) {
            return res.status(429).json({ error: 'rate_limited' });
        }
        next();
    };
}

function requireAdminKey(req, res, next) {
    if (!ADMIN_KEY) return next();
    const key = req.header('x-api-key');
    if (!key || key !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
}

function requireUploadKey(req, res, next) {
    if (!BOT_UPLOAD_KEY) return next();
    const key = req.header('x-api-key');
    if (!key || key !== BOT_UPLOAD_KEY) return res.status(401).json({ error: 'unauthorized' });
    next();
}

app.use((req, res, next) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json({ limit: '200kb' }));

// API rate limiting
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));

// --- Global History ---
const HISTORY_FILE = 'history.json';
let matchHistory = [];
let matchNumber = 0;
if (fs.existsSync(HISTORY_FILE)) {
    try {
        matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE));
        if (matchHistory.length > 0 && matchHistory[0].matchId) {
            matchNumber = matchHistory[0].matchId + 1;
        }
    } catch (e) {}
}

function nextMatchId() {
    const id = matchNumber;
    matchNumber++;
    return id;
}

// Per-type display counters (reset daily at UTC midnight)
let perfMatchCounter = 1;
let compMatchCounter = 1;
let lastResetDate = new Date().toISOString().slice(0, 10);

// Map displayMatchId → numeric matchId (for pool lookup)
const displayIdToMatchId = {};

function getNextDisplayId(type) {
    const displayId = type === 'competitive' ? ('A' + compMatchCounter++) : ('P' + perfMatchCounter++);
    return displayId;
}

function registerDisplayId(displayId, matchId) {
    displayIdToMatchId[displayId] = matchId;
    // Keep only last 200 entries
    const keys = Object.keys(displayIdToMatchId);
    if (keys.length > 200) delete displayIdToMatchId[keys[0]];
}

// --- Sequential blockchain TX queue (prevents nonce collisions) ---
// fn receives txOverrides = { nonce } so each call uses the correct pending nonce
const _txQueue = [];
let _txRunning = false;
function enqueueTx(label, fn) {
    _txQueue.push({ label, fn });
    if (!_txRunning) _drainTxQueue();
}
async function _drainTxQueue() {
    _txRunning = true;
    try {
        while (_txQueue.length > 0) {
            const { label, fn } = _txQueue.shift();
            try {
                // Use 'pending' nonce so we don't collide with stuck mempool txs
                // Also use 3x gas to ensure fast inclusion and avoid replacement-fee issues
                let overrides = {};
                if (backendWallet) {
                    const pendingNonce = await backendWallet.provider.getTransactionCount(backendWallet.address, 'pending');
                    const feeData = await backendWallet.provider.getFeeData();
                    overrides = {
                        nonce: pendingNonce,
                        maxFeePerGas: (feeData.maxFeePerGas || ethers.parseUnits('10', 'gwei')) * 3n,
                        maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas || ethers.parseUnits('2', 'gwei')) * 3n,
                    };
                }
                await fn(overrides);
            } catch (e) {
                log.warn('[TxQueue] ' + label + ' failed: ' + e.message);
            }
        }
    } finally {
        // Always reset _txRunning so future enqueued items can start the drain
        _txRunning = false;
    }
}

function checkDailyReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastResetDate) {
        lastResetDate = today;
        perfMatchCounter = 1;
        compMatchCounter = 1;
        for (const [, room] of rooms) {
            if (room.type === 'competitive') {
                room.paidEntries = {};
            }
        }
        log.important('[DailyReset] Match counters reset for: ' + today);
    }
}
setInterval(checkDailyReset, 60_000);

function saveHistory(arenaId, winnerName, score) {
    matchHistory.unshift({
        matchId: nextMatchId(),
        arenaId,
        timestamp: new Date().toISOString(),
        winner: winnerName,
        score: score,
    });
    // Keep all history (no limit)
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
}

// --- Game Config ---
const CONFIG = { gridSize: 30 };
const MATCH_DURATION = 180; // 3 minutes in seconds
const MAX_FOOD = 5;
const DEATH_BLINK_TURNS = 24;

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
    performance: 10,
    competitive: 2,
};
const ROOM_MAX_PLAYERS = {
    performance: 10,
    competitive: 10,
};

// --- Sandbox Management ---
let performancePaused = false;

function checkWorkerLoad() {
    const count = activeWorkers.size;
    if (count > MAX_WORKERS && !performancePaused) {
        console.log(`[Load] Active workers (${count}) > ${MAX_WORKERS}. Pausing performance rooms.`);
        performancePaused = true;
    } else if (count <= MAX_WORKERS && performancePaused) {
        console.log(`[Load] Active workers (${count}) <= ${MAX_WORKERS}. Resuming performance rooms.`);
        performancePaused = false;
    }
}

function stopBotWorker(botId, markStopped = true) {
    if (activeWorkers.has(botId)) {
        console.log(`[Worker] Stopping bot ${botId}`);
        const worker = activeWorkers.get(botId);
        worker.terminate();
        activeWorkers.delete(botId);
        checkWorkerLoad();
    }
    // Mark as not running (unless called during restart)
    if (markStopped && botRegistry[botId]) {
        botRegistry[botId].running = false;
        saveBotRegistry();
    }
}

function startBotWorker(botId, overrideArenaId) {
    // Stop existing if any (don't mark as stopped since we're restarting)
    stopBotWorker(botId, false);

    const bot = botRegistry[botId];
    if (!bot || !bot.scriptPath) {
        log.error(`[Worker] Cannot start bot ${botId}: No script found.`);
        return;
    }

    // Static Scan - Check for dangerous globals
    try {
        const content = fs.readFileSync(bot.scriptPath, 'utf8');
        // Only block truly dangerous patterns (not common words like 'process' in comments)
        const forbidden = ['require(', 'import ', 'child_process', '__dirname', '__filename'];
        const risk = forbidden.find(k => content.includes(k));
        if (risk) {
            log.error(`[Worker] Bot ${botId} blocked. Found forbidden pattern: ${risk}`);
            return;
        }
    } catch (e) {
        log.error(`[Worker] Error scanning script for bot ${botId}:`, e);
        return;
    }

    const arenaId = overrideArenaId || bot.preferredArenaId || 'performance-1';
    log.important(`[Worker] Starting bot ${botId} for arena ${arenaId}`);
    const worker = new Worker(path.join(__dirname, 'sandbox-worker.js'), {
        workerData: {
            scriptPath: bot.scriptPath,
            botId: botId,
            serverUrl: `ws://127.0.0.1:${PORT}?arenaId=${arenaId}` // Use explicit IPv4 loopback
        }
    });

    worker.on('message', (msg) => {
        if (msg.type === 'log') console.log(`[Bot ${botId}]`, msg.message);
        if (msg.type === 'error') log.error(`[Bot ${botId}] Error: ${msg.message}`);
        if (msg.type === 'status') log.important(`[Worker] Bot ${botId} status: ${msg.status}`);
    });

    worker.on('error', (err) => {
        log.error(`[Worker] Bot ${botId} thread error:`, err);
        stopBotWorker(botId);
    });

    worker.on('exit', (code) => {
        if (code !== 0) {
            log.error(`[Worker] Bot ${botId} CRASHED with exit code ${code}`);
        } else {
            log.important(`[Worker] Bot ${botId} stopped cleanly`);
        }
        activeWorkers.delete(botId);
        checkWorkerLoad();
    });

    activeWorkers.set(botId, worker);
    checkWorkerLoad();
    
    // Mark as running
    bot.running = true;
    saveBotRegistry();
}

// --- Bot Registry (MVP, local JSON) ---
const BOT_DB_FILE = path.join(__dirname, 'data', 'bots.json');
let botRegistry = {};

function loadBotRegistry() {
    try {
        if (fs.existsSync(BOT_DB_FILE)) {
            botRegistry = JSON.parse(fs.readFileSync(BOT_DB_FILE));
        }
    } catch (e) {
        botRegistry = {};
    }
}

// Auto-restart bots that were running before server restart
function resumeRunningBots() {
    const runningBots = Object.keys(botRegistry).filter(id => botRegistry[id].running);
    if (runningBots.length > 0) {
        log.important(`[Resume] Restarting ${runningBots.length} bots that were running...`);
        runningBots.forEach((botId, i) => {
            // Stagger restarts to avoid overwhelming the server
            setTimeout(() => {
                log.info(`[Resume] Restarting bot ${botId}`);
                startBotWorker(botId);
            }, i * 500);
        });
    }
}

// Add text parser for upload
app.use(bodyParser.text({ type: 'text/javascript', limit: '200kb' }));
app.use(bodyParser.text({ type: 'application/javascript', limit: '200kb' }));
app.use(bodyParser.text({ type: 'text/plain', limit: '200kb' }));

function saveBotRegistry() {
    try {
        const dir = path.dirname(BOT_DB_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(BOT_DB_FILE, JSON.stringify(botRegistry, null, 2));
    } catch (e) {}
}

loadBotRegistry();

function isOpposite(dir1, dir2) {
    if (!dir1 || !dir2 || typeof dir1.x !== 'number' || typeof dir2.x !== 'number') return false;
    return dir1.x === -dir2.x && dir1.y === -dir2.y;
}

function randomDirection() {
    const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
    ];
    return dirs[Math.floor(Math.random() * dirs.length)];
}

class GameRoom {
    constructor({ id, type }) {
        this.id = id;
        this.type = type; // performance | competitive
        this.maxPlayers = ROOM_MAX_PLAYERS[type] || 10;
        this.clients = new Set();

        // per-room state
        this.players = {};
        this.food = [];
        this.turn = 0;
        this.matchTimeLeft = MATCH_DURATION;
        this.waitingRoom = {};
        this.spawnIndex = 0;
        this.gameState = 'COUNTDOWN';
        this.winner = null;
        this.timerSeconds = 5;
        this.currentMatchId = nextMatchId();
        this.displayMatchId = getNextDisplayId(type);
        registerDisplayId(this.displayMatchId, this.currentMatchId);
        this.victoryPauseTimer = 0;
        this.lastSurvivorForVictory = null;
        this.replayFrames = []; // Record frames for replay

        // Competitive arena fields
        this.obstacles = [];          // { x, y, solid: bool, blinkTimer: int }
        this.obstacleTick = 0;        // Counts ticks for obstacle spawn timing
        this.matchNumber = 0;         // Total match count for this room
        this.paidEntries = {};        // { matchNumber: [botId, ...] } - paid entries for specific matches

        this.startLoops();
    }

    startLoops() {
        setInterval(() => {
            if (this.type === 'performance' && typeof performancePaused !== 'undefined' && performancePaused) {
                // If paused, skip tick but maybe broadcast "paused" state?
                // For MVP, just skip. Clients will see freeze.
                return; 
            }

            if (this.gameState === 'PLAYING') {
                this.tick();
            } else {
                this.broadcastState();
            }
        }, 125);

        setInterval(() => {
            if (this.gameState === 'PLAYING') {
                if (this.matchTimeLeft > 0) {
                    this.matchTimeLeft--;
                    if (this.matchTimeLeft <= 0) {
                        this.endMatchByTime();
                    }
                }
            } else if (this.gameState !== 'PLAYING') {
                if (this.timerSeconds > 0) {
                    this.timerSeconds--;
                } else {
                    if (this.gameState === 'GAMEOVER') {
                        this.startCountdown();
                    } else if (this.gameState === 'COUNTDOWN') {
                        this.startGame();
                    }
                }
            }
        }, 1000);
    }

    sendEvent(type, payload = {}) {
        const msg = JSON.stringify({ type, ...payload });
        this.clients.forEach((c) => {
            if (c.readyState === 1) c.send(msg);
        });
    }

    getSpawnPosition() {
        // Collect occupied spawn positions
        const occupied = new Set();
        Object.values(this.players).forEach(p => {
            if (p.body && p.body[0]) {
                // Check if any spawn point is too close to this player's head
                SPAWN_POINTS.forEach((sp, idx) => {
                    const dist = Math.abs(sp.x - p.body[0].x) + Math.abs(sp.y - p.body[0].y);
                    if (dist < 5) occupied.add(idx);
                });
            }
        });
        
        // Get available spawn points
        const available = SPAWN_POINTS.map((sp, idx) => idx).filter(idx => !occupied.has(idx));
        
        // Random selection from available, or fallback to any random
        let spawnIdx;
        if (available.length > 0) {
            spawnIdx = available[Math.floor(Math.random() * available.length)];
        } else {
            spawnIdx = Math.floor(Math.random() * SPAWN_POINTS.length);
        }
        
        const spawn = SPAWN_POINTS[spawnIdx];
        const body = [
            { x: spawn.x, y: spawn.y },
            { x: spawn.x - spawn.dir.x, y: spawn.y - spawn.dir.y },
            { x: spawn.x - spawn.dir.x * 2, y: spawn.y - spawn.dir.y * 2 },
        ];
        return { body, direction: spawn.dir };
    }

    isCellOccupied(x, y) {
        for (const p of Object.values(this.players)) {
            for (const seg of p.body || []) {
                if (seg.x === x && seg.y === y) return true;
            }
        }
        return false;
    }

    tick() {
        if (this.victoryPauseTimer > 0) {
            this.victoryPauseTimer--;
            this.broadcastState();
            if (this.victoryPauseTimer <= 0) {
                this.startGameOver(this.lastSurvivorForVictory);
            }
            return;
        }

        this.turn++;

        // --- Competitive: Obstacle System ---
        if (this.type === 'competitive' && this.gameState === 'PLAYING') {
            this.obstacleTick++;
            
            // Update blink timers
            for (const obs of this.obstacles) {
                if (!obs.solid && obs.blinkTimer > 0) {
                    obs.blinkTimer--;
                    if (obs.blinkTimer <= 0) {
                        obs.solid = true;
                    }
                }
            }
            
            // Spawn new obstacle every 80 ticks (10 seconds at 125ms/tick)
            if (this.obstacleTick % 80 === 0) {
                this.spawnObstacle();
            }
        }

        // Auto-move for bots without ws connection (flood-fill AI)
        Object.values(this.players).forEach((p) => {
            if (!p.ws && p.alive) {
                const head = p.body[0];
                const G = CONFIG.gridSize;
                const dirs = [
                    { x: 1, y: 0 }, { x: -1, y: 0 },
                    { x: 0, y: 1 }, { x: 0, y: -1 }
                ];
                
                // Build grid: 0=empty, 1=blocked
                const grid = [];
                for (let y = 0; y < G; y++) {
                    grid[y] = new Uint8Array(G);
                }
                Object.values(this.players).forEach(other => {
                    if (!other.body) return;
                    other.body.forEach(seg => {
                        if (seg.x >= 0 && seg.x < G && seg.y >= 0 && seg.y < G)
                            grid[seg.y][seg.x] = 1;
                    });
                });
                // Add solid obstacles
                if (this.obstacles) {
                    this.obstacles.forEach(obs => {
                        if (obs.solid && obs.x >= 0 && obs.x < G && obs.y >= 0 && obs.y < G)
                            grid[obs.y][obs.x] = 1;
                    });
                }
                
                // Mark enemy head adjacent cells as dangerous
                const enemyHeadDanger = new Set();
                Object.values(this.players).forEach(other => {
                    if (other.id === p.id || !other.alive || !other.body || !other.body[0]) return;
                    const oh = other.body[0];
                    for (const d of dirs) {
                        const ex = oh.x + d.x, ey = oh.y + d.y;
                        if (ex >= 0 && ex < G && ey >= 0 && ey < G) {
                            if (other.body.length >= p.body.length) {
                                enemyHeadDanger.add(ex + ',' + ey);
                            }
                        }
                    }
                });
                
                // Flood fill from a position
                const floodFill = (sx, sy) => {
                    if (sx < 0 || sx >= G || sy < 0 || sy >= G || grid[sy][sx] === 1) return 0;
                    const visited = [];
                    for (let y = 0; y < G; y++) visited[y] = new Uint8Array(G);
                    const queue = [{ x: sx, y: sy }];
                    visited[sy][sx] = 1;
                    let count = 0;
                    while (queue.length > 0) {
                        const cur = queue.shift();
                        count++;
                        for (const d of dirs) {
                            const nx = cur.x + d.x, ny = cur.y + d.y;
                            if (nx >= 0 && nx < G && ny >= 0 && ny < G && !visited[ny][nx] && grid[ny][nx] !== 1) {
                                visited[ny][nx] = 1;
                                queue.push({ x: nx, y: ny });
                            }
                        }
                    }
                    return count;
                };
                
                // Score each direction
                const candidates = dirs
                    .filter(d => !isOpposite(d, p.direction))
                    .map(d => {
                        const nx = head.x + d.x;
                        const ny = head.y + d.y;
                        if (nx < 0 || nx >= G || ny < 0 || ny >= G) return null;
                        if (grid[ny][nx] === 1) return null;
                        
                        let score = 0;
                        
                        // Flood fill space
                        const space = floodFill(nx, ny);
                        if (space < p.body.length) score -= 10000;
                        else if (space < p.body.length * 2) score -= 2000;
                        score += space * 2;
                        
                        // Enemy head danger
                        if (enemyHeadDanger.has(nx + ',' + ny)) score -= 5000;
                        
                        // Food attraction (lower weight when long)
                        const foodWeight = p.body.length < 8 ? 8 : 3;
                        let bestFoodDist = G * 2;
                        for (const f of (this.food || [])) {
                            const fd = Math.abs(nx - f.x) + Math.abs(ny - f.y);
                            if (fd < bestFoodDist) bestFoodDist = fd;
                        }
                        score += (G * 2 - bestFoodDist) * foodWeight;
                        
                        // Prefer center
                        const centerDist = Math.abs(nx - G / 2) + Math.abs(ny - G / 2);
                        score -= centerDist * 0.3;
                        
                        // Penalize walls
                        if (nx === 0 || nx === G - 1) score -= 30;
                        if (ny === 0 || ny === G - 1) score -= 30;
                        
                        return { d, score };
                    })
                    .filter(Boolean);
                
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    p.nextDirection = candidates[0].d;
                } else {
                    const any = dirs.filter(d => !isOpposite(d, p.direction));
                    p.nextDirection = any.length > 0 ? any[Math.floor(Math.random() * any.length)] : p.direction;
                }
            }
        });

        while (this.food.length < MAX_FOOD) {
            let tries = 0;
            let fx, fy;
            do {
                fx = Math.floor(Math.random() * CONFIG.gridSize);
                fy = Math.floor(Math.random() * CONFIG.gridSize);
                tries++;
                if (tries > 200) break;
            } while (this.isCellOccupied(fx, fy) || this.food.some(f => f.x === fx && f.y === fy) || (this.obstacles && this.obstacles.some(o => o.x === fx && o.y === fy)));

            if (tries <= 200) {
                this.food.push({ x: fx, y: fy });
            } else {
                break;
            }
        }

        Object.values(this.players).forEach((p) => {
            if (!p.alive) return;
            p.direction = p.nextDirection;
            const head = p.body[0];
            const newHead = { x: head.x + p.direction.x, y: head.y + p.direction.y };

            if (
                newHead.x < 0 ||
                newHead.x >= CONFIG.gridSize ||
                newHead.y < 0 ||
                newHead.y >= CONFIG.gridSize
            ) {
                this.killPlayer(p, 'wall');
                return;
            }

            const foodIndex = this.food.findIndex((f) => f.x === newHead.x && f.y === newHead.y);
            if (foodIndex !== -1) {
                this.food.splice(foodIndex, 1);
                p.score++;
            } else {
                p.body.pop();
            }

            p.body.unshift(newHead);
        });

        Object.values(this.players).forEach((p) => {
            if (!p.alive) return;
            const head = p.body[0];

            for (let i = 1; i < p.body.length; i++) {
                if (p.body[i].x === head.x && p.body[i].y === head.y) {
                    this.killPlayer(p, 'self');
                    return;
                }
            }

            Object.values(this.players).forEach((other) => {
                if (other.id === p.id || other.alive) return;
                if (other.deathType === 'eaten') return;

                for (const seg of other.body) {
                    if (seg.x === head.x && seg.y === head.y) {
                        this.killPlayer(p, 'corpse');
                        return;
                    }
                }
            });

            // Competitive: Check obstacle collision
            if (this.type === 'competitive' && p.alive) {
                for (const obs of this.obstacles) {
                    if (obs.solid && obs.x === head.x && obs.y === head.y) {
                        this.killPlayer(p, 'obstacle');
                        break;
                    }
                }
            }
        });

        const alivePlayers = Object.values(this.players).filter((p) => p.alive);
        const processed = new Set();

        for (const p of alivePlayers) {
            if (!p.alive || processed.has(p.id)) continue;
            const pHead = p.body[0];

            for (const other of alivePlayers) {
                if (other.id === p.id || !other.alive || processed.has(other.id)) continue;
                const oHead = other.body[0];

                if (pHead.x === oHead.x && pHead.y === oHead.y) {
                    if (p.body.length > other.body.length) {
                        this.killPlayer(other, 'eaten');
                        processed.add(other.id);
                    } else if (other.body.length > p.body.length) {
                        this.killPlayer(p, 'eaten');
                        processed.add(p.id);
                    } else {
                        this.killPlayer(p, 'headon');
                        this.killPlayer(other, 'headon');
                        processed.add(p.id);
                        processed.add(other.id);
                    }
                    continue;
                }

                for (let i = 1; i < other.body.length; i++) {
                    if (other.body[i].x === pHead.x && other.body[i].y === pHead.y) {
                        if (p.body.length > other.body.length) {
                            const eaten = other.body.length - i;
                            other.body = other.body.slice(0, i);
                            const tail = p.body[p.body.length - 1];
                            for (let j = 0; j < eaten; j++) {
                                p.body.push({ ...tail });
                            }
                            p.score += eaten;
                            if (other.body.length < 1) {
                                this.killPlayer(other, 'eaten');
                                processed.add(other.id);
                            }
                        } else {
                            this.killPlayer(p, 'collision');
                            processed.add(p.id);
                        }
                        break;
                    }
                }

                if (!p.alive || processed.has(p.id)) continue;
                for (let i = 1; i < p.body.length; i++) {
                    if (p.body[i].x === oHead.x && p.body[i].y === oHead.y) {
                        if (other.body.length > p.body.length) {
                            const eaten = p.body.length - i;
                            p.body = p.body.slice(0, i);
                            const tail = other.body[other.body.length - 1];
                            for (let j = 0; j < eaten; j++) {
                                other.body.push({ ...tail });
                            }
                            other.score += eaten;
                            if (p.body.length < 1) {
                                this.killPlayer(p, 'eaten');
                                processed.add(p.id);
                            }
                        } else {
                            this.killPlayer(other, 'collision');
                            processed.add(other.id);
                        }
                        break;
                    }
                }
            }
        }

        Object.values(this.players).forEach((p) => {
            if (!p.alive && p.deathTimer !== undefined) {
                if (p.deathTimer > 0) p.deathTimer--;
                if (p.deathTimer <= 0) p.deathTimer = DEATH_BLINK_TURNS;
            }
        });

        let aliveCount = 0;
        let lastSurvivor = null;
        Object.values(this.players).forEach((p) => {
            if (p.alive) {
                aliveCount++;
                lastSurvivor = p;
            }
        });

        const totalPlayers = Object.keys(this.players).length;
        if (totalPlayers > 1 && aliveCount === 1) {
            this.victoryPauseTimer = 24;
            this.lastSurvivorForVictory = lastSurvivor;
        } else if (totalPlayers > 1 && aliveCount === 0) {
            this.startGameOver(null);
        }

        this.broadcastState();
    }

    spawnObstacle() {
        const size = Math.floor(Math.random() * 16) + 1; // 1 to 16 cells
        const maxSize = Math.min(size, 12); // cap at 12 to not be too crazy
        
        // Pick a random seed position (avoid edges and existing obstacles)
        let seedX, seedY, tries = 0;
        do {
            seedX = Math.floor(Math.random() * (CONFIG.gridSize - 4)) + 2;
            seedY = Math.floor(Math.random() * (CONFIG.gridSize - 4)) + 2;
            tries++;
        } while (tries < 50 && this.isCellBlocked(seedX, seedY));
        
        if (tries >= 50) return; // Couldn't find a good spot
        
        // BFS expand from seed to create irregular shape
        const cells = [{ x: seedX, y: seedY }];
        const visited = new Set();
        visited.add(seedX + ',' + seedY);
        const queue = [{ x: seedX, y: seedY }];
        
        const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
        
        while (cells.length < maxSize && queue.length > 0) {
            // Random pick from queue for irregular shapes
            const idx = Math.floor(Math.random() * queue.length);
            const current = queue[idx];
            queue.splice(idx, 1);
            
            // Shuffle directions for randomness
            const shuffled = dirs.slice().sort(() => Math.random() - 0.5);
            
            for (const d of shuffled) {
                if (cells.length >= maxSize) break;
                const nx = current.x + d.x;
                const ny = current.y + d.y;
                const key = nx + ',' + ny;
                
                if (nx >= 1 && nx < CONFIG.gridSize - 1 && ny >= 1 && ny < CONFIG.gridSize - 1 
                    && !visited.has(key) && !this.isCellBlocked(nx, ny)) {
                    visited.add(key);
                    cells.push({ x: nx, y: ny });
                    queue.push({ x: nx, y: ny });
                }
            }
        }
        
        // Add obstacle cells with blink timer (16 ticks = 2 seconds)
        for (const cell of cells) {
            this.obstacles.push({
                x: cell.x,
                y: cell.y,
                solid: false,
                blinkTimer: 16
            });
            // Remove any food on this cell
            this.food = this.food.filter(f => !(f.x === cell.x && f.y === cell.y));
        }
        
        log.info('[Competitive] Spawned obstacle with ' + cells.length + ' cells at (' + seedX + ',' + seedY + ')');
    }

    isCellBlocked(x, y) {
        // Check if cell has a solid obstacle
        for (const obs of this.obstacles) {
            if (obs.x === x && obs.y === y) return true;
        }
        // Check if cell has a player body
        for (const p of Object.values(this.players)) {
            if (!p.body) continue;
            for (const seg of p.body) {
                if (seg.x === x && seg.y === y) return true;
            }
        }
        // Check food
        for (const f of this.food) {
            if (f.x === x && f.y === y) return true;
        }
        return false;
    }

    endMatchByTime() {
        let longest = null;
        let maxLen = 0;

        Object.values(this.players).forEach((p) => {
            if (p.alive && p.body.length > maxLen) {
                maxLen = p.body.length;
                longest = p;
            }
        });

        this.startGameOver(longest);
    }

    killPlayer(p, deathType = 'default') {
        p.alive = false;
        p.deathTimer = DEATH_BLINK_TURNS;
        p.deathTime = Date.now();
        p.deathType = deathType;
        
        log.info(`[Death] Player "${p.name}" (${p.id}) died: ${deathType} in room ${this.id}`);

        if (deathType === 'eaten') {
            p.body = [p.body[0]];
        }

        // Competitive arena: dead snake body becomes obstacles
        if (this.type === 'competitive' && deathType !== 'eaten' && p.body && p.body.length > 0) {
            for (const seg of p.body) {
                this.obstacles.push({
                    x: seg.x,
                    y: seg.y,
                    solid: true,
                    blinkTimer: 0,
                    fromCorpse: true,
                });
            }
            // Remove food that overlaps with new obstacles
            this.food = this.food.filter(f => !p.body.some(seg => seg.x === f.x && seg.y === f.y));
            log.info('[Competitive] Dead snake ' + p.name + ' body (' + p.body.length + ' cells) became obstacles');
        }
    }

    startGameOver(survivor) {
        this.gameState = 'GAMEOVER';
        this.winner = survivor ? survivor.name : 'No Winner';
        this.timerSeconds = 5;
        saveHistory(this.id, this.winner, survivor ? survivor.score : 0);

        // Save replay
        this.saveReplay(survivor);

        // Determine top 3 placements for betting settlement
        // 1st = survivor, 2nd/3rd = last to die (by deathTime descending)
        const allPlayers = Object.values(this.players);
        const dead = allPlayers
            .filter(p => !p.alive && p.deathTime && p.botId)
            .sort((a, b) => b.deathTime - a.deathTime); // most recently dead first

        const placements = [];
        if (survivor && survivor.botId) placements.push(survivor.botId);
        for (const p of dead) {
            if (placements.length >= 3) break;
            if (p.botId && !placements.includes(p.botId)) placements.push(p.botId);
        }

        this.sendEvent('match_end', {
            matchId: this.currentMatchId,
            winnerBotId: survivor ? survivor.botId || null : null,
            winnerName: this.winner,
            arenaId: this.id,
            arenaType: this.type,
            placements, // [1st botId, 2nd botId, 3rd botId]
        });

        // Settle match on-chain for betting payouts
        if (pariMutuelContract && (this.type === 'performance' || this.type === 'competitive') && placements.length > 0) {
            const matchId = this.currentMatchId;
            const arenaType = this.type;
            const winnersBytes32 = placements.map(id => {
                try { return ethers.encodeBytes32String(id.slice(0, 31)); }
                catch { return ethers.ZeroHash; }
            }).filter(h => h !== ethers.ZeroHash);

            if (winnersBytes32.length > 0) {
                enqueueTx(`settleMatch #${matchId}`, async (overrides) => {
                    const tx = await pariMutuelContract.settleMatch(matchId, winnersBytes32, overrides);
                    await tx.wait(1, 120000);
                    log.important(`[Betting] Match #${matchId} (${arenaType}) settled on-chain. Placements: ${placements.join(', ')}`);
                    // Award points for competitive arena bets that picked the winner
                    if (arenaType === 'competitive' && placements.length > 0) {
                        const winnerBotId = placements[0];
                        const bets = betRecords[matchId] || [];
                        let pointsAwarded = 0;
                        for (const bet of bets) {
                            if (bet.botId === winnerBotId && bet.bettor && bet.bettor !== 'anonymous') {
                                const addr = bet.bettor.toLowerCase();
                                const usdcAmount = Math.floor(Number(bet.amount) / 1e6);
                                if (usdcAmount > 0) {
                                    if (!pointsData[addr]) pointsData[addr] = { points: 0, history: [] };
                                    pointsData[addr].points += usdcAmount;
                                    pointsData[addr].history.push({
                                        matchId, amount: usdcAmount, type: 'bet_win', ts: Date.now()
                                    });
                                    pointsAwarded += usdcAmount;
                                }
                            }
                        }
                        if (pointsAwarded > 0) {
                            savePoints();
                            log.important(`[Points] Awarded ${pointsAwarded} points for match #${matchId}`);
                        }
                    }
                });
            }
        }
    }

    saveReplay(survivor) {
        if (this.replayFrames.length === 0) return;
        
        const replay = {
            matchId: this.currentMatchId,
            arenaId: this.id,
            arenaType: this.type,
            gridSize: CONFIG.gridSize,
            timestamp: new Date().toISOString(),
            winner: this.winner,
            winnerScore: survivor ? survivor.score : 0,
            totalFrames: this.replayFrames.length,
            frames: this.replayFrames,
        };
        
        // Ensure replays directory exists
        const replayDir = path.join(__dirname, 'replays');
        if (!fs.existsSync(replayDir)) {
            fs.mkdirSync(replayDir, { recursive: true });
        }
        
        const filename = `match-${this.currentMatchId}.json`;
        fs.writeFileSync(path.join(replayDir, filename), JSON.stringify(replay));
        log.info(`[Replay] Saved ${filename} (${this.replayFrames.length} frames)`);
        
        // Clear frames for next match
        this.replayFrames = [];
    }

    startCountdown() {
        this.gameState = 'COUNTDOWN';
        this.timerSeconds = 5;
        this.food = [];
        this.spawnIndex = 0;
        
        // Clear obstacles for competitive
        if (this.type === 'competitive') {
            this.obstacles = [];
            this.obstacleTick = 0;
            this.matchNumber++;
        }

        // Preserve queued bots and re-queue current players for next match
        const preserved = this.waitingRoom || {};
        Object.values(this.players).forEach((p) => {
            if (p.kicked) return;
            preserved[p.id] = {
                id: p.id,
                name: p.name,
                color: p.color,
                ws: p.ws,
                botType: p.botType,
                botId: p.botId || null,
                botPrice: 0,
                entryPrice: p.entryPrice || 0,
            };
        });
        this.waitingRoom = preserved;

        // Enforce maxPlayers cap on next match
        const allIds = Object.keys(this.waitingRoom);
        if (allIds.length > this.maxPlayers) {
            // Remove normals first, then random until within cap
            let overflow = allIds.length - this.maxPlayers;
            const normals = allIds.filter(id => this.waitingRoom[id].botType === 'normal');
            while (overflow > 0 && normals.length > 0) {
                const victimId = normals.pop();
                delete this.waitingRoom[victimId];
                overflow--;
            }
            const remaining = Object.keys(this.waitingRoom);
            while (overflow > 0 && remaining.length > 0) {
                const victimId = remaining.pop();
                delete this.waitingRoom[victimId];
                overflow--;
            }
        }

        this.players = {};
        this.currentMatchId = nextMatchId();
        this.displayMatchId = getNextDisplayId(this.type);
        registerDisplayId(this.displayMatchId, this.currentMatchId);
        this.victoryPauseTimer = 0;
        this.lastSurvivorForVictory = null;
        this.matchTimeLeft = MATCH_DURATION;
        colorIndex = 0;
        
        // Competitive: re-seed with normal bots if room is empty/low
        if (this.type === 'competitive') {
            const currentCount = Object.keys(this.waitingRoom).length;
            if (currentCount < this.maxPlayers) {
                const needed = this.maxPlayers - currentCount;
                for (let i = 0; i < needed; i++) {
                    const id = 'normal_' + Math.random().toString(36).slice(2, 7);
                    this.waitingRoom[id] = {
                        id,
                        name: 'Normal-' + id.slice(-3),
                        color: getNextColor(),
                        ws: null,
                        botType: 'normal',
                        botId: null,
                        botPrice: 0,
                    };
                }
            }
        }
    }

    startGame() {
        this.spawnIndex = 0;
        log.important(`[Room ${this.id}] Starting match with ${Object.keys(this.waitingRoom).length} players`);
        
        const usedSpawnIndices = new Set();
        
        Object.keys(this.waitingRoom).forEach((id) => {
            const w = this.waitingRoom[id];
            
            // Get available spawn points (not close to existing players AND not used in this startGame batch)
            const occupied = new Set();
            Object.values(this.players).forEach(p => {
                if (p.body && p.body[0]) {
                    SPAWN_POINTS.forEach((sp, idx) => {
                        const dist = Math.abs(sp.x - p.body[0].x) + Math.abs(sp.y - p.body[0].y);
                        if (dist < 5) occupied.add(idx);
                    });
                }
            });
            
            let spawnIdx = -1;
            const available = SPAWN_POINTS.map((_, i) => i).filter(i => !occupied.has(i) && !usedSpawnIndices.has(i));
            
            if (available.length > 0) {
                spawnIdx = available[Math.floor(Math.random() * available.length)];
            } else {
                // Fallback to any not used in this batch
                const notUsedInBatch = SPAWN_POINTS.map((_, i) => i).filter(i => !usedSpawnIndices.has(i));
                spawnIdx = notUsedInBatch.length > 0 ? notUsedInBatch[0] : Math.floor(Math.random() * SPAWN_POINTS.length);
            }
            
            usedSpawnIndices.add(spawnIdx);
            const spawn = SPAWN_POINTS[spawnIdx];
            const body = [
                { x: spawn.x, y: spawn.y },
                { x: spawn.x - spawn.dir.x, y: spawn.y - spawn.dir.y },
                { x: spawn.x - spawn.dir.x * 2, y: spawn.y - spawn.dir.y * 2 },
            ];

            log.info(`[Spawn] Player "${w.name}" (${id}) at (${spawn.x}, ${spawn.y})`);
            
            this.players[id] = {
                id: id,
                name: w.name,
                color: w.color,
                body: body,
                direction: spawn.dir,
                nextDirection: spawn.dir,
                alive: true,
                score: 0,
                ws: w.ws,
                botType: w.botType,
                botId: w.botId || id,
                entryPrice: w.entryPrice || 0,
            };
            if (w.ws && w.ws.readyState === 1) {
                w.ws.send(JSON.stringify({ type: 'init', id: id, botId: w.botId || id, gridSize: CONFIG.gridSize }));
            }
        });

        this.waitingRoom = {};
        this.gameState = 'PLAYING';
        this.turn = 0;
        this.timerSeconds = 0;
        this.matchTimeLeft = MATCH_DURATION;
        this.sendEvent('match_start', { matchId: this.currentMatchId, arenaId: this.id, arenaType: this.type });

        // Create match on-chain for betting (queued to avoid nonce collisions)
        if (pariMutuelContract && (this.type === 'performance' || this.type === 'competitive')) {
            const matchId = this.currentMatchId;
            const startTime = Math.floor(Date.now() / 1000) + 30; // +30s buffer so block.timestamp check passes
            enqueueTx(`createMatch #${matchId}`, async (overrides) => {
                const tx = await pariMutuelContract.createMatch(matchId, startTime, overrides);
                await tx.wait(1, 120000);
                log.important(`[Betting] Match #${matchId} (${this.type}) created on-chain`);
            });
        }
    }

    broadcastState() {
        const displayPlayers = Object.values(this.players).map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            body: p.body,
            head: p.body && p.body.length > 0 ? p.body[0] : null,
            direction: p.direction,
            score: p.score,
            alive: p.alive,
            blinking: !p.alive && p.deathTimer > 0,
            deathTimer: p.deathTimer,
            deathType: p.deathType,
            length: p.body.length,
            botType: p.botType,
            botId: p.botId || p.id,
        }));

        const waitingPlayers = Object.values(this.waitingRoom).map((w) => ({
            id: w.id,
            name: w.name,
            color: w.color,
            body: null,
            head: null,
            score: 0,
            alive: true,
            waiting: true,
            botType: w.botType,
            botId: w.botId || w.id,
        }));

        const state = {
            matchId: this.currentMatchId,
            arenaId: this.id,
            arenaType: this.type,
            gridSize: CONFIG.gridSize,
            turn: this.turn,
            gameState: this.gameState,
            winner: this.winner,
            timeLeft: this.timerSeconds,
            matchTimeLeft: this.matchTimeLeft,
            players: displayPlayers,
            waitingPlayers: waitingPlayers,
            food: this.food,
            obstacles: this.type === 'competitive' ? this.obstacles : [],
            matchNumber: this.matchNumber || 1,
            displayMatchId: this.displayMatchId,
            victoryPause: this.victoryPauseTimer > 0,
            victoryPauseTime: Math.ceil(this.victoryPauseTimer / 8),
        };

        // Record frame for replay (only during PLAYING)
        if (this.gameState === 'PLAYING') {
            this.replayFrames.push({
                turn: this.turn,
                matchTimeLeft: this.matchTimeLeft,
                players: displayPlayers.map(p => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    body: p.body,
                    score: p.score,
                    alive: p.alive,
                    botType: p.botType,
                })),
                food: this.food,
                obstacles: this.type === 'competitive' ? this.obstacles.filter(o => o.solid || o.blinkTimer > 0) : [],
            });
        }

        const msg = JSON.stringify({ type: 'update', state });
        this.clients.forEach((c) => {
            if (c.readyState === 1) c.send(msg);
        });
    }

    hasSpace() {
        return Object.keys(this.waitingRoom).length < this.maxPlayers;
    }

    capacityRemaining() {
        const playing = Object.keys(this.players).length;
        const waiting = Object.keys(this.waitingRoom).length;
        return this.maxPlayers - playing - waiting;
    }

    findKickableNormal() {
        const ids = Object.keys(this.waitingRoom).filter((id) => this.waitingRoom[id].botType === 'normal');
        if (ids.length === 0) return null;
        const victimId = ids[Math.floor(Math.random() * ids.length)];
        return victimId || null;
    }

    findKickableOldAgent() {
        const ids = Object.keys(this.waitingRoom);
        // Prefer kicking low-price/old agents (<=0.01)
        const victimId = ids.find((id) => this.waitingRoom[id].botType === 'agent' && (this.waitingRoom[id].botPrice || 0) <= 0.01);
        return victimId || null;
    }

    handleJoin(data, ws) {
        let name = (data.name || 'Bot').toString().slice(0, MAX_NAME_LEN);
        const isHero = name && name.includes('HERO');
        if (data.botId && String(data.botId).length > MAX_BOT_ID_LEN) {
            return { ok: false, reason: 'invalid_bot_id' };
        }
        let botType = data.botType || (isHero ? 'hero' : 'normal');
        const botMeta = data.botId && botRegistry[data.botId] ? botRegistry[data.botId] : null;
        if (botMeta) {
            name = botMeta.name || name;
            botType = botMeta.botType || botType;
        }

        if (this.type === 'performance' && botType === 'agent' && botMeta) {
            if (botMeta.credits <= 0) return { ok: false, reason: 'trial_exhausted', message: 'Trial plays used up. Register your bot (mint NFT) for unlimited plays.' };
            botMeta.credits -= 1;
            saveBotRegistry();
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'credits', remaining: botMeta.credits }));
            }
        }

        const gameInProgress = this.gameState !== 'COUNTDOWN';

        // Check capacity - but allow agent/hero to queue during match (overflow handled at startCountdown)
        if (this.capacityRemaining() <= 0) {
            if (gameInProgress && (botType === 'agent' || isHero)) {
                // Allow agent/hero to queue even if over capacity during match
                // startCountdown() will trim normals before next match
                console.log(`[Join] Allowing ${botType} "${name}" to queue during match (will trim normals later)`);
            } else if (this.type === 'performance' && botType === 'agent') {
                const victim = this.findKickableNormal();
                if (victim) delete this.waitingRoom[victim];
                if (this.capacityRemaining() <= 0) return { ok: false, reason: 'full' };
            } else if (isHero) {
                const victim = Object.keys(this.waitingRoom).find((id) => this.waitingRoom[id].botType !== 'hero');
                if (victim) delete this.waitingRoom[victim];
                if (this.capacityRemaining() <= 0) return { ok: false, reason: 'full' };
            } else {
                return { ok: false, reason: 'full' };
            }
        }

        // Record entry price for agent/hero
        const entryPrice = (this.type === 'competitive' && (botType === 'agent' || botType === 'hero')) ? currentEntryFee : 0;

        const id = Math.random().toString(36).substr(2, 5);
        this.waitingRoom[id] = {
            id: id,
            name: name,
            color: getNextColor(),
            ws: ws,
            botType,
            botId: data.botId || null,
            botPrice: data.botPrice || 0,
            entryPrice: entryPrice,
        };
        ws.send(JSON.stringify({ type: 'queued', id: id, botId: data.botId || null, entryPrice }));
        
        // Check if we should increase entry fee
        checkAndIncreaseFee();
        
        return { ok: true, id };
    }

    handleMove(playerId, data) {
        if (playerId && this.players[playerId] && this.players[playerId].alive) {
            const p = this.players[playerId];
            const newDir = data.direction;
            if (!isOpposite(newDir, p.direction)) {
                p.nextDirection = newDir;
            }
        }
    }

    handleDisconnect(playerId) {
        if (playerId) {
            if (this.players[playerId]) this.killPlayer(this.players[playerId], 'disconnect');
            if (this.waitingRoom[playerId]) delete this.waitingRoom[playerId];
        }
    }
}

// --- Room Manager ---
const rooms = new Map();
const performanceRooms = [];
const competitiveRooms = [];

function createRoom(type) {
    const index = type === 'performance' ? performanceRooms.length + 1 : competitiveRooms.length + 1;
    const id = `${type}-${index}`;
    const room = new GameRoom({ id, type });
    rooms.set(id, room);
    if (type === 'performance') {
        performanceRooms.push(room);
        // Default: fill with normal bots
        seedNormalBots(room, ROOM_MAX_PLAYERS.performance);
    } else {
        competitiveRooms.push(room);
    }
    return room;
}

// init rooms
createRoom('performance');

// Auto-create additional performance rooms based on registered agent bots
const agentCount = Object.values(botRegistry).filter(b => b.botType === 'agent' && b.scriptPath).length;
const roomsNeeded = Math.min(ROOM_LIMITS.performance, Math.ceil(agentCount / 8));
for (let i = performanceRooms.length; i < roomsNeeded; i++) {
    createRoom('performance');
}
if (performanceRooms.length > 1) {
    log.important(`[Init] Created ${performanceRooms.length} performance rooms for ${agentCount} bots`);
}

// Competitive arena - only one room, seeded with normal bots
function createCompetitiveRoom() {
    const id = 'competitive-1';
    const room = new GameRoom({ id, type: 'competitive' });
    rooms.set(id, room);
    competitiveRooms.push(room);
    seedNormalBots(room, 10);
    
    // Periodically check and auto-fill with registered agent bots
    setInterval(() => {
        if (room.gameState === 'COUNTDOWN' && room.timerSeconds > 3) {
            autoFillCompetitiveRoom(room);
        }
    }, 2000);
    
    return room;
}

function autoFillCompetitiveRoom(room) {
    const currentPlayers = { ...room.waitingRoom, ...room.players };
    const currentBotIds = new Set();
    Object.values(currentPlayers).forEach(p => {
        if (p.botId) currentBotIds.add(p.botId);
    });
    
    // Check paid entries for this match (keyed by displayMatchId string)
    const paidForMatch = room.paidEntries[room.displayMatchId] || [];
    
    // Add paid entries first
    for (const botId of paidForMatch) {
        if (currentBotIds.has(botId)) continue;
        if (Object.keys(room.waitingRoom).length >= room.maxPlayers) break;
        
        const meta = botRegistry[botId];
        if (!meta || meta.botType !== 'agent') continue;
        
        const id = 'comp_' + Math.random().toString(36).slice(2, 7);
        room.waitingRoom[id] = {
            id,
            name: meta.name || 'Agent-' + botId.slice(-4),
            color: getNextColor(),
            ws: null,
            botType: 'agent',
            botId: botId,
            botPrice: 0,
            paidEntry: true,
        };
        currentBotIds.add(botId);
        log.important('[Competitive] Paid entry: ' + meta.name + ' (' + botId + ') for match #' + room.matchNumber);
    }
    
    // Random fill remaining slots with registered agent bots
    const agentBotIds = Object.keys(botRegistry).filter(id => 
        botRegistry[id].botType === 'agent' && 
        botRegistry[id].scriptPath && 
        !currentBotIds.has(id)
    );
    
    // Shuffle
    for (let i = agentBotIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [agentBotIds[i], agentBotIds[j]] = [agentBotIds[j], agentBotIds[i]];
    }
    
    // Replace normal bots with agents
    const normalIds = Object.keys(room.waitingRoom).filter(id => room.waitingRoom[id].botType === 'normal');
    let replaced = 0;
    
    for (const botId of agentBotIds) {
        if (replaced >= normalIds.length) break;
        if (Object.keys(room.waitingRoom).length >= room.maxPlayers && normalIds.length <= replaced) break;
        
        // Kick a normal bot to make room
        if (normalIds[replaced]) {
            delete room.waitingRoom[normalIds[replaced]];
        }
        
        const meta = botRegistry[botId];
        const id = 'comp_' + Math.random().toString(36).slice(2, 7);
        room.waitingRoom[id] = {
            id,
            name: meta.name || 'Agent-' + botId.slice(-4),
            color: getNextColor(),
            ws: null,
            botType: 'agent',
            botId: botId,
            botPrice: 0,
        };
        currentBotIds.add(botId);
        replaced++;
    }
}

createCompetitiveRoom();

function seedNormalBots(room, count = 10) {
    for (let i = 0; i < count; i++) {
        const id = 'normal_' + Math.random().toString(36).slice(2, 7);
        room.waitingRoom[id] = {
            id,
            name: 'Normal-' + id.slice(-3),
            color: getNextColor(),
            ws: null,
            botType: 'normal',
            botId: null,
            botPrice: 0,
        };
    }
}

function countAgentsInRoom(room) {
    let count = 0;
    Object.values(room.waitingRoom).forEach((w) => {
        if (w.botType === 'agent' || w.botType === 'hero') count++;
    });
    Object.values(room.players).forEach((p) => {
        if (p.botType === 'agent' || p.botType === 'hero') count++;
    });
    return count;
}

// Count total agents/heroes across all performance rooms
function countTotalAgents() {
    let total = 0;
    for (const room of performanceRooms) {
        total += countAgentsInRoom(room);
    }
    return total;
}

// --- Entry Fee System ---
// Entry fee starts at 0.01 ETH, increases by 0.01 each time all 60 slots are filled
let currentEntryFee = 0.01;
const ENTRY_FEE_FILE = path.join(__dirname, 'data', 'entry-fee.json');

function loadEntryFee() {
    try {
        if (fs.existsSync(ENTRY_FEE_FILE)) {
            const data = JSON.parse(fs.readFileSync(ENTRY_FEE_FILE));
            currentEntryFee = data.currentEntryFee || 0.01;
        }
    } catch (e) {
        currentEntryFee = 0.01;
    }
}

function saveEntryFee() {
    try {
        const dir = path.dirname(ENTRY_FEE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ENTRY_FEE_FILE, JSON.stringify({ currentEntryFee }, null, 2));
    } catch (e) {}
}

loadEntryFee();

// Count agents who paid >= currentEntryFee
function countCurrentPriceAgents() {
    let count = 0;
    for (const room of performanceRooms) {
        Object.values(room.waitingRoom).forEach((w) => {
            if ((w.botType === 'agent' || w.botType === 'hero') && (w.entryPrice || 0) >= currentEntryFee) count++;
        });
        Object.values(room.players).forEach((p) => {
            if ((p.botType === 'agent' || p.botType === 'hero') && (p.entryPrice || 0) >= currentEntryFee) count++;
        });
    }
    return count;
}

// Check if all 60 slots are filled with current-price agents
function allSlotsFilled() {
    const maxSlots = ROOM_LIMITS.performance * 10; // 60
    return countCurrentPriceAgents() >= maxSlots;
}

// Check and increase entry fee if all slots filled
function checkAndIncreaseFee() {
    if (allSlotsFilled()) {
        currentEntryFee = Math.round((currentEntryFee + 0.01) * 100) / 100;
        console.log(`[EntryFee] All slots filled! New entry fee: ${currentEntryFee} ETH`);
        saveEntryFee();
    }
}

// Find a kickable agent (paid less than current fee)
function findKickableAgent() {
    for (const room of performanceRooms) {
        // Check waitingRoom first
        for (const [id, w] of Object.entries(room.waitingRoom)) {
            if ((w.botType === 'agent' || w.botType === 'hero') && (w.entryPrice || 0) < currentEntryFee) {
                return { room, id, inWaiting: true };
            }
        }
        // Check players
        for (const [id, p] of Object.entries(room.players)) {
            if ((p.botType === 'agent' || p.botType === 'hero') && (p.entryPrice || 0) < currentEntryFee) {
                return { room, id, inWaiting: false };
            }
        }
    }
    return null;
}

function getEntryFee() {
    return currentEntryFee;
}

function kickRandomNormal(room) {
    const normals = Object.keys(room.waitingRoom).filter((id) => room.waitingRoom[id].botType === 'normal');
    if (normals.length > 0) {
        const victimId = normals[Math.floor(Math.random() * normals.length)];
        delete room.waitingRoom[victimId];
        return victimId;
    }

    const liveNormals = Object.keys(room.players).filter((id) => room.players[id].botType === 'normal');
    if (liveNormals.length > 0) {
        const victimId = liveNormals[Math.floor(Math.random() * liveNormals.length)];
        const victim = room.players[victimId];
        if (victim) {
            victim.kicked = true;
            room.killPlayer(victim, 'kicked');
            return victimId;
        }
    }

    return null;
}

function prepareRoomForAgentUpload(botId) {
    let targetRoom = null;
    for (const room of performanceRooms) {
        if (countAgentsInRoom(room) < room.maxPlayers) {
            targetRoom = room;
            break;
        }
    }

    if (!targetRoom && performanceRooms.length < ROOM_LIMITS.performance) {
        targetRoom = createRoom('performance');
    }

    if (!targetRoom) return null;

    if (Object.keys(targetRoom.waitingRoom).length === 0) {
        seedNormalBots(targetRoom, targetRoom.maxPlayers);
    }

    kickRandomNormal(targetRoom);
    botRegistry[botId].preferredArenaId = targetRoom.id;
    saveBotRegistry();
    return targetRoom;
}

function assignRoomForJoin(data) {
    const botType = data.botType || (data.name && data.name.includes('HERO') ? 'hero' : 'normal');
    const arenaType = data.arenaType || 'performance';

    if (arenaType === 'competitive') {
        return competitiveRooms[0];
    }

    // performance - agent or hero
    if (botType === 'agent' || botType === 'hero') {
        // Prefer a pre-assigned arena if present
        if (data.botId && botRegistry[data.botId] && botRegistry[data.botId].preferredArenaId) {
            const pref = botRegistry[data.botId].preferredArenaId;
            if (rooms.has(pref)) {
                const prefRoom = rooms.get(pref);
                // Only use preferred room if it still has capacity
                if (countAgentsInRoom(prefRoom) < prefRoom.maxPlayers) {
                    return prefRoom;
                }
            }
        }

        // Fill rooms in order: find first room with agent/hero capacity
        for (const room of performanceRooms) {
            if (countAgentsInRoom(room) < room.maxPlayers) return room;
        }

        // Create new performance room if allowed (up to 6)
        if (performanceRooms.length < ROOM_LIMITS.performance) {
            const newRoom = createRoom('performance');
            return newRoom;
        }

        // All 6 rooms full - try to find a kickable agent (paid less than current fee)
        const kickable = findKickableAgent();
        if (kickable) {
            const { room, id, inWaiting } = kickable;
            if (inWaiting) {
                console.log(`[Kick] Kicking ${room.waitingRoom[id].name} (paid ${room.waitingRoom[id].entryPrice || 0} ETH) from waiting room`);
                if (room.waitingRoom[id].ws) {
                    room.waitingRoom[id].ws.send(JSON.stringify({ type: 'kicked', reason: 'outbid' }));
                }
                delete room.waitingRoom[id];
            } else {
                console.log(`[Kick] Kicking ${room.players[id].name} (paid ${room.players[id].entryPrice || 0} ETH) from game`);
                room.players[id].kicked = true;
                room.killPlayer(room.players[id], 'kicked');
            }
            return room;
        }

        // No kickable agent found - truly full at current price
        console.log(`[Join] All 60 slots filled at ${currentEntryFee} ETH, no lower-price agents to kick`);
        return null;
    }

    // normal - go to first room with any capacity
    for (const room of performanceRooms) {
        if (room.capacityRemaining() > 0) return room;
    }
    return performanceRooms[0];
}

// --- WebSocket ---
wss.on('connection', (ws, req) => {
    let playerId = null;
    let room = null;
    let msgCount = 0;
    let msgWindow = Date.now();

    // auto-attach spectators by arenaId
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const arenaId = url.searchParams.get('arenaId');
        if (arenaId && rooms.has(arenaId)) {
            room = rooms.get(arenaId);
            room.clients.add(ws);
        }
    } catch (e) {}

    ws.on('message', (msg) => {
        try {
            const now = Date.now();
            if (now - msgWindow > 1000) {
                msgWindow = now;
                msgCount = 0;
            }
            msgCount++;
            if (msgCount > 20) {
                // Too chatty, drop message
                return;
            }
            const data = JSON.parse(msg);

            if (data.type === 'join') {
                const url = new URL(req.url, `http://${req.headers.host}`);
                const arenaId = url.searchParams.get('arenaId');
                const botMeta = data.botId && botRegistry[data.botId] ? botRegistry[data.botId] : null;
                if (botMeta) {
                    data.name = botMeta.name;
                    data.botType = botMeta.botType;
                    data.botPrice = botMeta.price || 0;
                }
                
                // Log level based on bot type - agents/heroes are important, normals are debug
                const isImportant = data.botType === 'agent' || data.botType === 'hero' || data.botId;
                if (isImportant) {
                    log.important(`[Join] ${data.name} (${data.botType || 'player'}) requesting join`);
                } else {
                    log.debug(`[Join] ${data.name || 'unknown'} (normal) requesting join`);
                }

                if (arenaId && rooms.has(arenaId)) {
                    room = rooms.get(arenaId);
                } else {
                    room = assignRoomForJoin(data);
                }

                if (!room) {
                    log.debug(`[Join] Rejected ${data.name}: no room available`);
                    ws.send(JSON.stringify({ type: 'queued', id: null, reason: 'payment_required_or_full' }));
                    return;
                }

                // Ensure client is only in the correct room's client set
                rooms.forEach(r => r.clients.delete(ws));
                room.clients.add(ws);
                
                const res = room.handleJoin(data, ws);
                if (isImportant) {
                    log.important(`[Join] ${data.name} result: ${res.ok ? 'OK' : res.reason}`);
                } else {
                    log.debug(`[Join] ${data.name} result: ${res.ok ? 'OK' : res.reason}`);
                }
                if (res.ok) {
                    playerId = res.id;
                } else {
                    ws.send(JSON.stringify({ type: 'queued', id: null, reason: res.reason }));
                }
                return;
            }

            if (data.type === 'move' && room) {
                room.handleMove(playerId, data);
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        if (room) {
            room.clients.delete(ws);
            room.handleDisconnect(playerId);
        }
    });
});

// --- API (MVP) ---
function createBotId() {
    return 'bot_' + Math.random().toString(36).slice(2, 8);
}

function generateRegCode() {
    // Generate 8-character alphanumeric code (uppercase)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getRoomStatus(room) {
    return {
        id: room.id,
        type: room.type,
        gameState: room.gameState,
        waiting: Object.keys(room.waitingRoom).length,
        playing: Object.keys(room.players).length,
        maxPlayers: room.maxPlayers
    };
}

function leaderboardFromHistory(filterArenaId = null) {
    const counts = {};
    matchHistory.forEach(h => {
        if (filterArenaId && h.arenaId !== filterArenaId) return;
        // Skip empty matches (no players = No Winner with score 0)
        if (h.winner === 'No Winner' && h.score === 0) return;
        const key = h.winner || 'No Winner';
        counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
        .map(([name, wins]) => ({ name, wins }))
        .sort((a,b)=>b.wins-a.wins)
        .slice(0, 30);
}

app.post('/api/bot/register', rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    const { name, price, owner, botType, regCode } = req.body || {};

    // If regCode provided, look up existing bot by its registration code
    if (regCode) {
        const cleanCode = regCode.toString().toUpperCase().slice(0, 8);
        const found = Object.entries(botRegistry).find(([, m]) => m.regCode === cleanCode);
        if (!found) {
            return res.status(400).json({ error: 'invalid_code', message: 'Invalid or expired registration code' });
        }
        const [botId, botMeta] = found;
        if (owner) {
            botMeta.owner = owner.toString().slice(0, 64);
            saveBotRegistry();
        }
        log.important('[Register] Bot ' + botMeta.name + ' (' + botId + ') claimed via regCode by ' + (owner || 'unknown'));
        return res.json({ ok: true, botId, name: botMeta.name });
    }

    const safeName = (name || 'AgentBot').toString().slice(0, MAX_NAME_LEN);

    // Check name uniqueness
    const existingName = Object.values(botRegistry).find(m => m.name === safeName);
    if (existingName) {
        return res.status(400).json({ error: 'name_taken', message: 'Bot name "' + safeName + '" is already in use' });
    }
    const safePrice = Number(price || 0);
    const id = createBotId();
    const newRegCode = generateRegCode();
    botRegistry[id] = {
        id,
        name: safeName,
        owner: (owner || 'unknown').toString().slice(0, 64),
        price: isNaN(safePrice) ? 0 : safePrice,
        botType: botType || 'agent',
        credits: 20,
        createdAt: Date.now(),
        regCode: newRegCode
    };
    saveBotRegistry();

    // Create bot on-chain (non-blocking)
    if (botRegistryContract) {
        botRegistryContract.createBot(
            ethers.encodeBytes32String(id),
            safeName,
            ethers.ZeroAddress
        ).then(tx => tx.wait()).then(() => {
            log.important(`[Blockchain] Bot ${id} created on-chain via /register`);
        }).catch(err => {
            log.warn('[Blockchain] Failed to create bot on-chain via /register:', err.message);
        });
    }

    // auto-assign room on register (performance by default)
    const room = assignRoomForJoin({ name: botRegistry[id].name, botType: botRegistry[id].botType, botPrice: botRegistry[id].price || 0, arenaType: 'performance' });
    const payload = { ...botRegistry[id] };
    payload.regCode = regCode;
    if (room) {
        payload.arenaId = room.id;
        payload.wsUrl = 'ws://' + req.headers.host + '?arenaId=' + room.id;
    } else {
        payload.arenaId = null;
        payload.error = 'full_or_payment_required';
    }
    res.json(payload);
});

app.post('/api/bot/set-price', requireAdminKey, (req, res) => {
    const { botId, newPrice } = req.body || {};
    if (!botRegistry[botId]) return res.status(404).json({ error: 'bot_not_found' });
    botRegistry[botId].price = newPrice;
    saveBotRegistry();
    res.json({ ok: true, bot: botRegistry[botId] });
});

// --- Bot Lookup by Name (must be before :botId route) ---
app.get('/api/bot/lookup', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'missing_name' });
    const entry = Object.entries(botRegistry).find(([_, m]) => m.name === name.toString());
    if (!entry) return res.status(404).json({ error: 'bot_not_found' });
    res.json({ botId: entry[0], name: entry[1].name, credits: entry[1].credits });
});

// Get registration fee - MUST be before /api/bot/:botId
app.get('/api/bot/registration-fee', async (req, res) => {
    try {
        if (!botRegistryContract) {
            return res.status(503).json({ error: 'contracts_not_initialized' });
        }
        const fee = await botRegistryContract.registrationFee();
        res.json({ fee: ethers.formatEther(fee), feeWei: fee.toString() });
    } catch (e) {
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

app.get('/api/bot/:botId', (req, res) => {
    const bot = botRegistry[req.params.botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    res.json(bot);
});

app.post('/api/bot/topup', requireAdminKey, (req, res) => {
    const { botId, amount } = req.body || {};
    const bot = botRegistry[botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    const packs = Math.max(1, Math.floor((amount || 0.01) / 0.01));
    bot.credits += packs * 5;
    saveBotRegistry();
    res.json({ ok: true, credits: bot.credits });
});

app.get('/api/bot/:botId/credits', (req, res) => {
    const bot = botRegistry[req.params.botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    res.json({ credits: bot.credits });
});

app.get('/api/arena/status', (req, res) => {
    res.json({
        performance: performanceRooms.map(r => ({
            id: r.id,
            players: Object.keys(r.players).length,
            waiting: Object.keys(r.waitingRoom).length,
            gameState: r.gameState,
        })),
        competitive: competitiveRooms.map(r => ({
            id: r.id,
            matchNumber: r.matchNumber,
            players: Object.keys(r.players).length,
            waiting: Object.keys(r.waitingRoom).length,
            gameState: r.gameState,
            obstacleCount: r.obstacles ? r.obstacles.filter(o => o.solid).length : 0,
        })),
        workers: {
            count: activeWorkers.size,
            ids: Array.from(activeWorkers.keys()),
            details: Array.from(activeWorkers.entries()).map(([id, w]) => ({
                id,
                threadId: w.threadId,
            }))
        }
    });
})

app.post('/api/arena/join', (req, res) => {
    const { botId, arenaType } = req.body || {};
    const bot = botRegistry[botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });

    if ((arenaType || 'performance') === 'performance' && bot.botType === 'agent') {
        if (bot.credits <= 0) return res.status(402).json({ error: 'topup_required' });
    }

    const room = assignRoomForJoin({ name: bot.name, botType: bot.botType, botPrice: bot.price || 0, arenaType: arenaType || 'performance' });
    if (!room) return res.status(409).json({ error: 'full_or_payment_required' });

    res.json({
        arenaId: room.id,
        wsUrl: 'ws://' + req.headers.host + '?arenaId=' + room.id
    });
});

app.post('/api/arena/kick', requireAdminKey, (req, res) => {
    const { arenaId, targetBotId } = req.body || {};
    const room = rooms.get(arenaId);
    if (!room) return res.status(404).json({ error: 'arena_not_found' });
    const victimId = Object.keys(room.waitingRoom).find(id => room.waitingRoom[id].id === targetBotId || room.waitingRoom[id].name === targetBotId);
    if (!victimId) return res.status(404).json({ error: 'target_not_found_or_in_game' });
    delete room.waitingRoom[victimId];
    res.json({ ok: true });
});

// --- Bot Registration (unlimited plays) ---
app.post('/api/bot/register-unlimited', requireAdminKey, (req, res) => {
    const { botId, txHash } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'missing_botId' });
    
    const bot = botRegistry[botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    
    // Mark bot as unlimited (no credit consumption)
    bot.unlimited = true;
    bot.credits = 999999;
    bot.registeredTxHash = txHash || null;
    saveBotRegistry();
    
    log.important('[Register] Bot ' + bot.name + ' (' + botId + ') registered as unlimited. tx:' + (txHash || 'none'));
    
    res.json({ ok: true, botId, message: 'Bot registered with unlimited plays' });
});


// --- Edit Token (NFT-gated bot code editing) ---
app.post('/api/bot/edit-token', rateLimit({ windowMs: 60_000, max: 20 }), async (req, res) => {
    try {
        const { botId, address, signature, timestamp } = req.body || {};
        if (!botId || !address || !signature || !timestamp) {
            return res.status(400).json({ error: 'missing_params', message: 'botId, address, signature, timestamp required' });
        }

        // 1. Check timestamp freshness (within 5 minutes)
        const ts = parseInt(timestamp);
        if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
            return res.status(400).json({ error: 'expired_timestamp', message: 'Timestamp must be within 5 minutes' });
        }

        // 2. Verify wallet signature
        const message = `Snake Arena Edit: ${botId} at ${timestamp}`;
        let recovered;
        try {
            recovered = ethers.verifyMessage(message, signature);
        } catch (e) {
            return res.status(400).json({ error: 'invalid_signature' });
        }
        if (recovered.toLowerCase() !== address.toLowerCase()) {
            return res.status(403).json({ error: 'signature_mismatch', message: 'Signature does not match address' });
        }

        // 3. Verify NFT ownership on-chain
        if (!snakeBotNFTContract) {
            return res.status(503).json({ error: 'contract_not_ready' });
        }
        try {
            const tokenId = await snakeBotNFTContract.botToTokenId(ethers.encodeBytes32String(botId));
            if (tokenId === 0n) {
                return res.status(403).json({ error: 'not_registered', message: 'Bot not registered (no NFT)' });
            }
            const nftOwner = await snakeBotNFTContract.ownerOf(tokenId);
            if (nftOwner.toLowerCase() !== address.toLowerCase()) {
                return res.status(403).json({ error: 'not_nft_owner', message: 'Address does not own the NFT for this bot' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'nft_check_failed', message: e.message });
        }

        // 4. Generate edit token (valid 24 hours)
        const { randomBytes } = require('crypto');
        const token = randomBytes(32).toString('hex');
        const expires = Date.now() + 24 * 3600 * 1000;
        editTokens.set(token, { botId, address: address.toLowerCase(), expires });

        log.important(`[EditToken] Issued for bot ${botId} to ${address}`);
        res.json({ token, expires, botId, validHours: 24 });
    } catch (e) {
        res.status(500).json({ error: 'server_error', message: e.message });
    }
});

// Look up numeric matchId by displayMatchId (e.g. "P2" → 5)
app.get('/api/match/by-display-id', (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'missing id' });
    const matchId = displayIdToMatchId[id.toUpperCase()];
    if (matchId == null) return res.status(404).json({ error: 'not_found', message: 'No match found for ' + id });
    res.json({ displayMatchId: id.toUpperCase(), matchId });
});

// --- Competitive Arena API ---
app.get('/api/competitive/status', (req, res) => {
    const room = rooms.get('competitive-1');
    if (!room) return res.status(404).json({ error: 'no_competitive_room' });
    
    // Use matchId from room (this is the global match ID)
    // room.currentMatchId is set to nextMatchId() in constructor
    const currentMatchId = room.currentMatchId || 0;
    
    res.json({
        displayMatchId: room.displayMatchId,
        matchNumber: currentMatchId,
        internalMatchNumber: room.matchNumber,
        matchId: currentMatchId,
        gameState: room.gameState,
        timeLeft: room.timerSeconds,
        matchTimeLeft: room.matchTimeLeft,
        obstacleCount: room.obstacles.filter(o => o.solid).length,
        playerCount: Object.keys(room.players).length + Object.keys(room.waitingRoom).length,
        maxPlayers: room.maxPlayers,
        entryFee: currentEntryFee,
    });
});

app.get('/api/competitive/registered', (req, res) => {
    const agents = Object.entries(botRegistry)
        .filter(([_, meta]) => meta.botType === 'agent' && meta.scriptPath)
        .map(([id, meta]) => ({
            botId: id,
            name: meta.name,
            credits: meta.credits,
        }));
    res.json(agents);
});

app.post('/api/competitive/enter', (req, res) => {
    const { botId, displayMatchId, txHash } = req.body || {};

    if (!botId || !displayMatchId || !txHash) {
        return res.status(400).json({ error: 'missing_params', message: 'botId, displayMatchId and txHash required' });
    }

    const meta = botRegistry[botId];
    if (!meta || meta.botType !== 'agent') {
        return res.status(404).json({ error: 'bot_not_found', message: 'Bot must be a registered agent' });
    }

    const room = rooms.get('competitive-1');
    if (!room) return res.status(500).json({ error: 'no_competitive_room' });

    // Compare numeric part: "A4" vs "A3" → 4 >= 3 ✓
    const parseNum = (s) => parseInt(String(s).replace(/^[A-Za-z]+/, '')) || 0;
    if (parseNum(displayMatchId) < parseNum(room.displayMatchId)) {
        return res.status(400).json({ error: 'invalid_match', message: 'Match must be >= current ' + room.displayMatchId });
    }

    // Record paid entry keyed by displayMatchId string
    if (!room.paidEntries[displayMatchId]) {
        room.paidEntries[displayMatchId] = [];
    }
    room.paidEntries[displayMatchId].push(botId);

    // Clean up past entries
    const currentNum = parseNum(room.displayMatchId);
    for (const key of Object.keys(room.paidEntries)) {
        if (parseNum(key) < currentNum) {
            delete room.paidEntries[key];
        }
    }

    log.important('[Competitive] Paid entry registered: ' + meta.name + ' (' + botId + ') for ' + displayMatchId + ' tx:' + txHash);

    res.json({ ok: true, displayMatchId, botId, message: 'Entry confirmed for ' + displayMatchId });
});

app.post("/api/admin/reset-leaderboard", requireAdminKey, (req, res) => {    matchHistory = [];    matchNumber = 0;    fs.writeFileSync(HISTORY_FILE, "[]");    log.important("[Admin] Leaderboard reset");    res.json({ ok: true, message: "Leaderboard reset" });});

// Admin: create bot on-chain for an existing local bot that missed the createBot tx
app.post('/api/admin/create-on-chain', requireAdminKey, async (req, res) => {
    const { botId } = req.body || {};
    if (!botId) return res.status(400).json({ error: 'missing_botId' });
    const bot = botRegistry[botId];
    if (!bot) return res.status(404).json({ error: 'bot_not_found' });
    if (!botRegistryContract) return res.status(503).json({ error: 'contract_not_ready' });
    try {
        const tx = await botRegistryContract.createBot(
            ethers.encodeBytes32String(botId),
            bot.name,
            ethers.ZeroAddress
        );
        const receipt = await tx.wait();
        log.important(`[Admin] Bot ${botId} (${bot.name}) created on-chain. tx: ${receipt.hash}`);
        res.json({ ok: true, botId, name: bot.name, txHash: receipt.hash });
    } catch (e) {
        log.warn('[Admin] createBot on-chain failed:', e.message);
        res.status(500).json({ error: 'tx_failed', message: e.message });
    }
});
app.get('/api/leaderboard/global', (req, res) => {
    res.json(leaderboardFromHistory());
});

app.get('/api/leaderboard/performance', (req, res) => {
    // Filter for all performance arenas
    const counts = {};
    matchHistory.forEach(h => {
        if (!h.arenaId || !h.arenaId.startsWith('performance')) return;
        if (h.winner === 'No Winner' && h.score === 0) return;
        const key = h.winner || 'No Winner';
        counts[key] = (counts[key] || 0) + 1;
    });
    res.json(Object.entries(counts).map(([name, wins]) => ({ name, wins })).sort((a,b)=>b.wins-a.wins).slice(0, 30));
});

app.get('/api/leaderboard/competitive', (req, res) => {
    const counts = {};
    matchHistory.forEach(h => {
        if (!h.arenaId || !h.arenaId.startsWith('competitive')) return;
        if (h.winner === 'No Winner' && h.score === 0) return;
        const key = h.winner || 'No Winner';
        counts[key] = (counts[key] || 0) + 1;
    });
    res.json(Object.entries(counts).map(([name, wins]) => ({ name, wins })).sort((a,b)=>b.wins-a.wins).slice(0, 30));
});

app.get('/api/leaderboard/arena/:arenaId', (req, res) => {
    res.json(leaderboardFromHistory(req.params.arenaId));
});

// --- Bot Upload & Sandbox API ---
app.post('/api/bot/upload', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
    try {
        const { botId, name } = req.query;
        let scriptContent = req.body;
        
        // If body-parser failed or body is empty
        if (!scriptContent || typeof scriptContent !== 'string') {
            return res.status(400).json({ error: 'invalid_script_content', message: 'Send script as text/javascript body' });
        }
        if (scriptContent.length > 200_000) {
            return res.status(413).json({ error: 'payload_too_large' });
        }

        // 0. If updating existing bot, verify edit token
        if (botId) {
            const token = req.headers['x-edit-token'];
            if (!token) {
                return res.status(401).json({ error: 'auth_required', message: 'x-edit-token header required to update existing bot' });
            }
            const tokenData = editTokens.get(token);
            if (!tokenData) {
                return res.status(403).json({ error: 'invalid_token', message: 'Invalid edit token' });
            }
            if (tokenData.botId !== botId) {
                return res.status(403).json({ error: 'token_bot_mismatch', message: 'Token is for a different bot' });
            }
            if (tokenData.expires < Date.now()) {
                editTokens.delete(token);
                return res.status(403).json({ error: 'token_expired', message: 'Edit token expired, please re-authenticate' });
            }
        }

        // 1. Static Scan
        const forbidden = ['require', 'import', 'process', 'fs', 'net', 'http', 'https', 'child_process', 'eval', 'Function', 'constructor', 'global', 'Buffer'];
        // Use a regex to check for word boundaries to avoid false positives on variable names like "processData"
        // But block properties like "process.env"
        // Simple heuristic: if it matches \bkeyword\b it is risky.
        const risk = forbidden.find(k => new RegExp(`\\b${k}\\b`).test(scriptContent));
        if (risk) {
            return res.status(400).json({ error: 'security_violation', message: `Forbidden keyword found: ${risk}` });
        }
        
        // 2. Check name uniqueness
        if (name) {
            const safeName = name.toString().slice(0, 32);
            const existing = Object.entries(botRegistry).find(([id, m]) => m.name === safeName && id !== botId);
            if (existing) {
                return res.status(400).json({ error: 'name_taken', message: 'Bot name "' + safeName + '" is already in use by ' + existing[0] });
            }
        }

        // Get owner from query (optional, for tracking who uploaded)
        const owner = req.query.owner?.toString().toLowerCase() || null;

        // 3. Resolve Bot ID
        let targetBotId = botId;
        let isNewBot = false;
        if (!targetBotId) {
            // Create new bot if no ID provided
            targetBotId = createBotId();
            isNewBot = true;
            botRegistry[targetBotId] = {
                id: targetBotId,
                name: (name || 'Bot-' + targetBotId.substr(-4)).toString().slice(0, 32),
                credits: 20,
                botType: 'agent',
                createdAt: Date.now(),
                owner: owner,
                regCode: generateRegCode() // Generate registration code for new bots
            };
        } else if (!botRegistry[targetBotId]) {
            return res.status(404).json({ error: 'bot_not_found' });
        }

        // 3. Save Script
        const scriptPath = path.join(BOTS_DIR, `${targetBotId}.js`);
        fs.writeFileSync(scriptPath, scriptContent);
        
        botRegistry[targetBotId].scriptPath = scriptPath;
        // Update name if provided
        if (name) botRegistry[targetBotId].name = name.toString().slice(0, 32);
        // Update owner if provided and not already set
        if (owner && !botRegistry[targetBotId].owner) botRegistry[targetBotId].owner = owner;
        saveBotRegistry();

        // 4. Create bot on-chain (if new bot)
        if (botRegistryContract && !botId) {
            try {
                const botName = botRegistry[targetBotId].name;
                const tx = await botRegistryContract.createBot(
                    ethers.encodeBytes32String(targetBotId),
                    botName,
                    ethers.ZeroAddress // Initially unclaimed
                );
                await tx.wait();
                log.important(`[Blockchain] Bot ${targetBotId} created on-chain`);
            } catch (chainErr) {
                log.warn('[Blockchain] Failed to create bot on-chain:', chainErr.message);
                // Non-blocking: bot still works locally even if chain fails
            }
        }

        // Auto-assign/kick rule: each uploaded agent bot kicks one normal bot
        if ((botRegistry[targetBotId].botType || 'agent') === 'agent') {
            prepareRoomForAgentUpload(targetBotId);
        }

        // 4. Auto-start bot (restart if already running, start if new)
        startBotWorker(targetBotId);

        const response = { 
            ok: true, 
            botId: targetBotId, 
            name: botRegistry[targetBotId].name,
            owner: botRegistry[targetBotId].owner,
            running: botRegistry[targetBotId].running || false,
            message: 'Bot uploaded and started successfully.' 
        };
        
        // Include registration code for new bots
        if (isNewBot && botRegistry[targetBotId].regCode) {
            response.regCode = botRegistry[targetBotId].regCode;
        }
        
        res.json(response);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'upload_failed' });
    }
});

app.post('/api/bot/start', requireAdminKey, (req, res) => {
    const { botId } = req.body;
    if (!botRegistry[botId]) return res.status(404).json({ error: 'bot_not_found' });
    
    // Check if worker is actually alive, not just in the map
    if (activeWorkers.has(botId)) {
        const existingWorker = activeWorkers.get(botId);
        // Worker threads don't have a direct isRunning property, 
        // but we can check if it's still in the map after a small delay
        // For now, force restart by terminating existing worker
        console.log(`[Worker] Bot ${botId} already in map, force restarting...`);
        try {
            existingWorker.terminate();
        } catch (e) {
            // Ignore terminate errors
        }
        activeWorkers.delete(botId);
    }
    
    startBotWorker(botId);
    res.json({ ok: true, message: 'Bot started' });
});

app.post('/api/bot/stop', requireAdminKey, (req, res) => {
    const { botId } = req.body;
    if (!botRegistry[botId]) return res.status(404).json({ error: 'bot_not_found' });
    
    stopBotWorker(botId);
    res.json({ ok: true, message: 'Bot stopped' });
});

// Get user's bots (by owner address)
app.get('/api/user/bots', (req, res) => {
    const { address } = req.query;
    if (!address) {
        return res.status(400).json({ error: 'Missing address parameter' });
    }
    
    const normalizedAddress = address.toString().toLowerCase();
    
    // Find all bots owned by this address
    const userBots = Object.entries(botRegistry)
        .filter(([id, bot]) => bot.owner?.toLowerCase() === normalizedAddress)
        .map(([id, bot]) => ({
            botId: id,
            name: bot.name,
            credits: bot.credits,
            running: bot.running || false,
            botType: bot.botType || 'agent',
            createdAt: bot.createdAt,
            preferredArenaId: bot.preferredArenaId || null
        }));
    
    res.json({ ok: true, bots: userBots, count: userBots.length });
});

// Get bot by name (for claiming)
app.get('/api/bot/by-name/:name', (req, res) => {
    const { name } = req.params;
    if (!name) {
        return res.status(400).json({ error: 'Missing name parameter' });
    }
    
    // Find bot by name (case insensitive)
    const botEntry = Object.entries(botRegistry).find(([id, bot]) => 
        bot.name.toLowerCase() === name.toLowerCase()
    );
    
    if (!botEntry) {
        return res.status(404).json({ error: 'bot_not_found', message: 'Bot not found' });
    }
    
    const [botId, bot] = botEntry;
    
    res.json({
        ok: true,
        botId: botId,
        name: bot.name,
        owner: bot.owner,
        credits: bot.credits,
        running: bot.running || false,
        botType: bot.botType || 'agent',
        createdAt: bot.createdAt
    });
});

// Claim bot ownership
app.post('/api/bot/claim', async (req, res) => {
    const { name, address, signature, timestamp } = req.body;

    if (!name || !address || !signature || !timestamp) {
        return res.status(400).json({ error: 'Missing name, address, signature or timestamp' });
    }

    // Reject stale signatures (5 minute window)
    const ts = parseInt(timestamp);
    if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return res.status(401).json({ error: 'auth_expired', message: 'Signature expired' });
    }

    // Verify wallet signature
    try {
        const message = `Claim Snake Arena Bot\nName: ${name}\nAddress: ${address}\nTimestamp: ${timestamp}`;
        const recovered = ethers.verifyMessage(message, signature);
        if (recovered.toLowerCase() !== address.toLowerCase()) {
            return res.status(401).json({ error: 'invalid_signature' });
        }
    } catch (e) {
        return res.status(401).json({ error: 'invalid_signature' });
    }

    // Find bot by name
    const botEntry = Object.entries(botRegistry).find(([id, bot]) =>
        bot.name.toLowerCase() === name.toLowerCase()
    );

    if (!botEntry) {
        return res.status(404).json({ error: 'bot_not_found' });
    }

    const [botId, bot] = botEntry;

    // Check if already owned
    if (bot.owner && bot.owner !== 'unknown') {
        return res.status(400).json({ error: 'already_claimed', message: 'This bot is already claimed' });
    }

    // Claim ownership
    botRegistry[botId].owner = address.toLowerCase();
    saveBotRegistry();

    res.json({
        ok: true,
        message: 'Bot claimed successfully',
        botId: botId,
        name: bot.name,
        owner: address.toLowerCase()
    });
});

// --- Betting ---
const betPools = {}; // matchId -> { total: 0, bets: [] } (mirrors on-chain for fast reads)
const betRecords = {}; // matchId -> [{bettor, botId, amount (USDC units)}] for points calculation

// Get on-chain pool info for a match
app.get('/api/bet/pool', async (req, res) => {
    const { matchId } = req.query;
    if (!matchId) return res.status(400).json({ error: 'missing matchId' });
    const mid = parseInt(matchId);
    if (isNaN(mid)) return res.status(400).json({ error: 'invalid matchId' });

    if (!pariMutuelContract) {
        return res.json({ matchId: mid, totalPool: '0', settled: false, exists: false });
    }
    try {
        const m = await pariMutuelContract.matches(mid);
        const exists = Number(m.matchId) !== 0;
        res.json({
            matchId: mid,
            totalPool: ethers.formatUnits(m.totalPool, 6), // USDC has 6 decimals
            totalPoolWei: m.totalPool.toString(),
            settled: m.settled,
            cancelled: m.cancelled,
            exists,
            startTime: Number(m.startTime),
            bettingOpen: exists && !m.settled && !m.cancelled && (Date.now() / 1000 < Number(m.startTime) + 300)
        });
    } catch (e) {
        res.json({ matchId: mid, totalPool: '0', settled: false, exists: false, error: e.message });
    }
});

// Get user's potential winnings for a match
app.get('/api/bet/winnings', async (req, res) => {
    const { matchId, address } = req.query;
    if (!matchId || !address) return res.status(400).json({ error: 'missing matchId or address' });
    const mid = parseInt(matchId);
    if (!pariMutuelContract) return res.json({ winnings: '0' });
    try {
        const w = await pariMutuelContract.getUserPotentialWinnings(mid, address);
        res.json({ winnings: ethers.formatUnits(w, 6), winningsWei: w.toString() }); // USDC 6 decimals
    } catch (e) {
        res.json({ winnings: '0', error: e.message });
    }
});

const handleBetPlace = (req, res) => {
    // bettor is the wallet address, txHash is the transaction hash on Base Sepolia
    const { matchId, botId, amount, txHash, bettor, arenaType } = req.body || {};

    if (!matchId || !botId || !amount) {
        return res.status(400).json({ error: 'Missing required fields: matchId, botId, amount' });
    }

    // Initialize pool for this match if not exists
    if (!betPools[matchId]) {
        betPools[matchId] = { total: 0, bets: [] };
    }

    const betAmount = Number(amount);
    if (isNaN(betAmount) || betAmount <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
    }

    // Record the bet
    betPools[matchId].bets.push({
        botId,
        amount: betAmount,
        bettor: bettor || 'anonymous',
        txHash: txHash || null,
        arenaType: arenaType || null,
        timestamp: Date.now()
    });

    betPools[matchId].total += betAmount;

    // Also record in betRecords for points system (amount stored in raw units from chain)
    if (!betRecords[matchId]) betRecords[matchId] = [];
    betRecords[matchId].push({
        bettor: bettor || 'anonymous',
        botId,
        amount: betAmount, // raw USDC units (6 decimals) as passed from frontend
        txHash: txHash || null,
        arenaType: arenaType || null,
        timestamp: Date.now()
    });

    console.log(`[Prediction] New prediction on match #${matchId}: ${betAmount} USDC units on ${botId} by ${bettor} (Tx: ${txHash}, arena: ${arenaType || 'unknown'})`);

    res.json({
        ok: true,
        total: betPools[matchId].total,
        matchId,
        yourBet: { botId, amount: betAmount }
    });
};

const handleBetStatus = (req, res) => {
    const matchId = req.query.matchId;
    if (!matchId || !betPools[matchId]) return res.json({ total: 0, bets: [] });
    res.json(betPools[matchId]);
};

app.post('/api/bet/place', handleBetPlace);
app.get('/api/bet/status', handleBetStatus);
// Prediction aliases (same handlers, new naming)
app.post('/api/prediction/place', handleBetPlace);
app.get('/api/prediction/status', handleBetStatus);

app.post('/api/bet/claim', (req, res) => {
    res.json({ ok: true });
});

// --- Points API ---
app.get('/api/points/my', (req, res) => {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'missing address' });
    const addr = address.toLowerCase();
    const data = pointsData[addr] || { points: 0, history: [] };
    // Include rank
    const sorted = Object.entries(pointsData)
        .sort(([, a], [, b]) => b.points - a.points);
    const rank = sorted.findIndex(([a]) => a === addr) + 1;
    res.json({
        address: addr,
        points: data.points,
        rank: rank > 0 ? rank : null,
        history: (data.history || []).slice(-20).reverse() // last 20, newest first
    });
});

app.get('/api/points/leaderboard', (req, res) => {
    const sorted = Object.entries(pointsData)
        .sort(([, a], [, b]) => b.points - a.points)
        .slice(0, 20)
        .map(([address, data], idx) => ({
            rank: idx + 1,
            address,
            points: data.points
        }));
    res.json(sorted);
});

// Replay APIs
app.get('/api/replays', (req, res) => {
    const replayDir = path.join(__dirname, 'replays');
    if (!fs.existsSync(replayDir)) {
        return res.json([]);
    }
    const files = fs.readdirSync(replayDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const data = JSON.parse(fs.readFileSync(path.join(replayDir, f)));
            return {
                matchId: data.matchId,
                arenaId: data.arenaId,
                timestamp: data.timestamp,
                winner: data.winner,
                winnerScore: data.winnerScore,
                totalFrames: data.totalFrames,
            };
        })
        .sort((a, b) => b.matchId - a.matchId)
        .slice(0, 50); // Latest 50 replays
    res.json(files);
});

app.get('/api/replay/:matchId', (req, res) => {
    const matchId = req.params.matchId;
    const replayPath = path.join(__dirname, 'replays', `match-${matchId}.json`);
    if (!fs.existsSync(replayPath)) {
        return res.status(404).json({ error: 'Replay not found' });
    }
    const replay = JSON.parse(fs.readFileSync(replayPath));
    res.json(replay);
});

app.get('/history', (req, res) => res.json(matchHistory));

// --- NEW: Blockchain Integration APIs ---

// Get on-chain bot info
app.get('/api/bot/onchain/:botId', async (req, res) => {
    try {
        const { botId } = req.params;
        if (!botRegistryContract) {
            return res.status(503).json({ error: 'contracts_not_initialized' });
        }
        
        const bot = await botRegistryContract.getBotById(ethers.encodeBytes32String(botId));
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
        log.error('[API] /api/bot/onchain error:', e.message);
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Get user's on-chain bots
// Uses local botRegistry as source of truth for ownership (bypasses broken ownerBots mapping in contract)
app.get('/api/user/onchain-bots', async (req, res) => {
    try {
        const { wallet } = req.query;
        if (!wallet || !ethers.isAddress(wallet)) {
            return res.status(400).json({ error: 'invalid_wallet_address' });
        }

        const walletLower = wallet.toString().toLowerCase();

        // Find bots in local registry owned by this wallet
        const localBots = Object.entries(botRegistry)
            .filter(([, m]) => m.owner && m.owner.toLowerCase() === walletLower);

        const bots = await Promise.all(localBots.map(async ([id, meta]) => {
            let registered = false;
            let salePrice = '0';
            let forSale = false;
            let matchesPlayed = 0;
            let totalEarnings = '0';

            // Try to get on-chain status for this bot
            if (botRegistryContract) {
                try {
                    const onchain = await botRegistryContract.getBotById(ethers.encodeBytes32String(id));
                    registered = onchain.registered;
                    salePrice = ethers.formatEther(onchain.salePrice);
                    forSale = onchain.salePrice > 0n;
                    matchesPlayed = Number(onchain.matchesPlayed);
                    totalEarnings = ethers.formatEther(onchain.totalEarnings);
                } catch (e) {
                    // Bot not on chain yet — registered stays false
                }
            }

            return {
                botId: id,
                name: meta.name,       // BotSlot uses .name for display
                botName: meta.name,
                owner: meta.owner,     // BotSlot needs .owner for isOwner check
                registered,
                salePrice,
                forSale,
                matchesPlayed,
                totalEarnings
            };
        }));

        res.json({ bots });
    } catch (e) {
        log.error('[API] /api/user/onchain-bots error:', e.message);
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Get marketplace listings
app.get('/api/marketplace/listings', async (req, res) => {
    try {
        const { offset = 0, limit = 20 } = req.query;
        if (!botRegistryContract) {
            return res.status(503).json({ error: 'contracts_not_initialized' });
        }
        
        const listings = await botRegistryContract.getBotsForSale(offset, limit);
        const formatted = listings.map(bot => ({
            botId: ethers.decodeBytes32String(bot.botId).replace(/\0/g, ''),
            botName: bot.botName,
            owner: bot.owner,
            registered: bot.registered,
            matchesPlayed: Number(bot.matchesPlayed),
            totalEarnings: ethers.formatEther(bot.totalEarnings),
            price: ethers.formatEther(bot.salePrice),
            priceWei: bot.salePrice.toString()
        }));
        res.json({ listings: formatted });
    } catch (e) {
        log.error('[API] /api/marketplace/listings error:', e.message);
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Get bot NFT info
app.get('/api/bot/nft/:botId', async (req, res) => {
    try {
        const { botId } = req.params;
        if (!snakeBotNFTContract) {
            return res.status(503).json({ error: 'nft_contract_not_initialized' });
        }
        
        // Get tokenId for this bot
        const tokenId = await snakeBotNFTContract.botToTokenId(ethers.encodeBytes32String(botId));
        
        if (tokenId === 0n) {
            return res.json({ hasNFT: false, botId });
        }
        
        // Get tokenURI
        const tokenURI = await snakeBotNFTContract.tokenURI(tokenId);
        const owner = await snakeBotNFTContract.ownerOf(tokenId);
        
        res.json({
            hasNFT: true,
            botId,
            tokenId: Number(tokenId),
            tokenURI,
            owner
        });
    } catch (e) {
        log.error('[API] /api/bot/nft error:', e.message);
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// Get pending rewards for a bot
app.get('/api/bot/rewards/:botId', async (req, res) => {
    try {
        const { botId } = req.params;
        if (!rewardDistributorContract) {
            return res.status(503).json({ error: 'contracts_not_initialized' });
        }
        
        const pending = await rewardDistributorContract.pendingRewards(ethers.encodeBytes32String(botId));
        const threshold = await rewardDistributorContract.MIN_CLAIM_THRESHOLD();
        
        res.json({
            botId,
            pendingRewards: ethers.formatEther(pending),
            canClaim: pending >= threshold,
            threshold: ethers.formatEther(threshold)
        });
    } catch (e) {
        log.error('[API] /api/bot/rewards error:', e.message);
        res.status(500).json({ error: 'query_failed', message: e.message });
    }
});

// ============ REFERRAL SYSTEM APIs ============
// Note: These APIs require wallet signature for authentication

// EIP-712 domain for signature verification
const REFERRAL_DOMAIN = {
    name: 'SnakeArenaReferral',
    version: '1',
    chainId: 84532 // Base Sepolia
};

// Verify wallet signature
async function verifyWalletSignature(address, message, signature) {
    try {
        const recovered = ethers.verifyMessage(message, signature);
        return recovered.toLowerCase() === address.toLowerCase();
    } catch (e) {
        return false;
    }
}

// Middleware: Require signature auth
function requireSignatureAuth(req, res, next) {
    const { address, signature, timestamp } = req.body || req.query || {};
    
    if (!address || !signature) {
        return res.status(401).json({ error: 'auth_required', message: 'Wallet signature required' });
    }
    
    // Check timestamp (prevent replay attacks) - 5 minute window
    const ts = parseInt(timestamp);
    if (!ts || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
        return res.status(401).json({ error: 'auth_expired', message: 'Signature expired' });
    }
    
    // Verify signature
    const message = `SnakeArena Referral Auth\nAddress: ${address}\nTimestamp: ${timestamp}`;
    if (!verifyWalletSignature(address, message, signature)) {
        return res.status(401).json({ error: 'auth_invalid', message: 'Invalid signature' });
    }
    
    req.authenticatedAddress = address.toLowerCase();
    next();
}

// Get my referral stats (requires signature)
app.post('/api/referral/my-stats', requireSignatureAuth, (req, res) => {
    try {
        const stats = getReferralStats(req.authenticatedAddress);
        res.json({ ok: true, ...stats });
    } catch (e) {
        log.error('[Referral] my-stats error:', e.message);
        res.status(500).json({ error: 'query_failed' });
    }
});

// Generate claim signature (requires signature auth)
app.post('/api/referral/claim-proof', requireSignatureAuth, async (req, res) => {
    res.status(410).json({
        error: 'deprecated',
        message: 'Cash rewards have been replaced by points. Referral rewards are now awarded as points automatically.'
    });
});

// Record referral registration (called by frontend after successful registerBot)
// This is public but requires valid transaction proof
app.post('/api/referral/record', async (req, res) => {
    try {
        const { user, inviter, txHash, amount } = req.body || {};
        
        if (!user || !inviter || !txHash) {
            return res.status(400).json({ error: 'missing_params' });
        }
        
        // Verify transaction exists and is valid
        try {
            const tx = await provider.getTransaction(txHash);
            if (!tx || tx.to?.toLowerCase() !== CONTRACTS.botRegistry.toLowerCase()) {
                return res.status(400).json({ error: 'invalid_tx' });
            }
            // Wait for confirmation
            const receipt = await provider.waitForTransaction(txHash, 1, 30000);
            if (!receipt || receipt.status !== 1) {
                return res.status(400).json({ error: 'tx_failed' });
            }
        } catch (e) {
            return res.status(400).json({ error: 'tx_verification_failed' });
        }
        
        const success = recordReferral(user, inviter, txHash, parseFloat(amount) || 0.01);
        
        if (success) {
            res.json({ ok: true, message: 'Referral recorded' });
        } else {
            res.status(400).json({ error: 'referral_failed', message: 'Already has inviter or invalid' });
        }
    } catch (e) {
        log.error('[Referral] record error:', e.message);
        res.status(500).json({ error: 'server_error' });
    }
});

// Get public referral info (no auth required - for invite link)
app.get('/api/referral/info/:address', (req, res) => {
    try {
        const address = req.params.address.toLowerCase();
        const stats = getReferralStats(address);
        
        // Only return public info
        res.json({
            ok: true,
            address: address,
            inviteeCount: stats.inviteeCount,
            code: address // Invite code is just the address
        });
    } catch (e) {
        res.status(500).json({ error: 'query_failed' });
    }
});

// Admin: Get all referral stats (protected by admin key)
app.get('/api/admin/referral-stats', requireAdminKey, (req, res) => {
    try {
        const totalUsers = Object.keys(referralData.users).length;
        const totalRewards = Object.values(referralData.rewards).reduce((sum, r) => sum + r.l1 + r.l2, 0);
        
        res.json({
            ok: true,
            totalUsers,
            totalRewards,
            users: referralData.users,
            rewards: referralData.rewards
        });
    } catch (e) {
        res.status(500).json({ error: 'query_failed' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    log.important(`🚀 Snake Arena running on port ${PORT}`);
    // Initialize blockchain contracts
    initContracts();
    // Resume bots after a short delay (let rooms initialize)
    setTimeout(resumeRunningBots, 3000);
    // One-time purge of all existing replays (runs once, then flag file prevents re-run)
    const replayDir = path.join(__dirname, 'replays');
    const replayPurgeFlag = path.join(__dirname, 'data', 'replay-purged.flag');
    if (!fs.existsSync(replayPurgeFlag)) {
        try {
            if (fs.existsSync(replayDir)) {
                const allFiles = fs.readdirSync(replayDir);
                allFiles.forEach(f => fs.unlinkSync(path.join(replayDir, f)));
                log.important(`[Cleanup] One-time purge: deleted ${allFiles.length} replay files`);
            }
            const flagDir = path.dirname(replayPurgeFlag);
            if (!fs.existsSync(flagDir)) fs.mkdirSync(flagDir, { recursive: true });
            fs.writeFileSync(replayPurgeFlag, new Date().toISOString());
        } catch (e) {
            log.warn('[Cleanup] One-time replay purge failed:', e.message);
        }
    }

    // Auto-cleanup replays: delete files older than 96 hours, run every 24h
    const REPLAY_RETENTION_MS = 96 * 60 * 60 * 1000; // 96 hours
    const cleanupReplays = () => {
        try {
            if (!fs.existsSync(replayDir)) return;
            const now = Date.now();
            const files = fs.readdirSync(replayDir)
                .map(f => ({ name: f, mtime: fs.statSync(path.join(replayDir, f)).mtimeMs }));
            const toDelete = files.filter(f => f.mtime < now - REPLAY_RETENTION_MS);
            toDelete.forEach(f => fs.unlinkSync(path.join(replayDir, f.name)));
            if (toDelete.length > 0) log.important(`[Cleanup] Deleted ${toDelete.length} replays older than 96 hours`);
        } catch (e) {
            log.warn('[Cleanup] Replay cleanup failed:', e.message);
        }
    };
    cleanupReplays();
    setInterval(cleanupReplays, 24 * 60 * 60 * 1000);
});