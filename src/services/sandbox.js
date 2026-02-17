const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');
const { getBot, updateBot } = require('./bot-registry');
const { CONFIG } = require('../config/constants');

const activeWorkers = new Map(); // botId -> Worker
let performancePaused = false;
let SERVER_PORT = process.env.PORT || 3000;

function setServerPort(port) {
    SERVER_PORT = port;
}

function checkWorkerLoad() {
    const count = activeWorkers.size;
    if (count > CONFIG.maxWorkers && !performancePaused) {
        log.warn(`[Load] Active workers (${count}) > ${CONFIG.maxWorkers}. Pausing performance rooms.`);
        performancePaused = true;
    } else if (count <= CONFIG.maxWorkers && performancePaused) {
        log.info(`[Load] Active workers (${count}) <= ${CONFIG.maxWorkers}. Resuming performance rooms.`);
        performancePaused = false;
    }
}

function stopBotWorker(botId, markStopped = true) {
    if (activeWorkers.has(botId)) {
        log.info(`[Worker] Stopping bot ${botId}`);
        const worker = activeWorkers.get(botId);
        worker.terminate();
        activeWorkers.delete(botId);
        checkWorkerLoad();
    }
    if (markStopped) {
        updateBot(botId, { running: false });
    }
}

function startBotWorker(botId, overrideArenaId) {
    stopBotWorker(botId, false); // Don't mark stopped, restarting

    const bot = getBot(botId);
    if (!bot || !bot.scriptPath) {
        log.error(`[Worker] Cannot start bot ${botId}: No script found.`);
        return;
    }

    // Static Scan
    try {
        const content = fs.readFileSync(bot.scriptPath, 'utf8');
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
    
    const workerPath = path.resolve(__dirname, '../../sandbox-worker.js'); // Assuming it's in root
    
    // Check if worker file exists, if not look in src/game/ or similar?
    // The original code had it in __dirname (server.js dir).
    // Now server.js is in root, but we are in src/services. So '../../sandbox-worker.js'.
    
    const worker = new Worker(workerPath, {
        workerData: {
            scriptPath: bot.scriptPath,
            botId: botId,
            serverUrl: `ws://localhost:${SERVER_PORT}?arenaId=${arenaId}`
        }
    });

    worker.on('message', (msg) => {
        if (msg.type === 'log') console.log(`[Bot ${botId}]`, msg.message); // Could use logger
        if (msg.type === 'error') console.error(`[Bot ${botId}]`, msg.message);
    });

    worker.on('error', (err) => {
        console.error(`[Worker] Bot ${botId} error:`, err);
        stopBotWorker(botId);
    });

    worker.on('exit', (code) => {
        if (code !== 0) console.error(`[Worker] Bot ${botId} stopped with exit code ${code}`);
        activeWorkers.delete(botId);
        checkWorkerLoad();
        // Maybe auto-restart if it crashed?
    });

    activeWorkers.set(botId, worker);
    checkWorkerLoad();
    
    updateBot(botId, { running: true });
}

function getActiveWorkers() {
    return activeWorkers;
}

function isPerformancePaused() {
    return performancePaused;
}

module.exports = {
    startBotWorker,
    stopBotWorker,
    checkWorkerLoad,
    setServerPort,
    getActiveWorkers,
    isPerformancePaused
};
