const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

const BOT_DB_FILE = path.join(__dirname, '../../data', 'bots.json');
let botRegistry = {};

function loadBotRegistry() {
    try {
        if (fs.existsSync(BOT_DB_FILE)) {
            botRegistry = JSON.parse(fs.readFileSync(BOT_DB_FILE));
        }
    } catch (e) {
        log.error('[BotRegistry] Failed to load bots:', e);
        botRegistry = {};
    }
}

function saveBotRegistry() {
    try {
        const dir = path.dirname(BOT_DB_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(BOT_DB_FILE, JSON.stringify(botRegistry, null, 2));
    } catch (e) {
        log.error('[BotRegistry] Failed to save bots:', e);
    }
}

// Initialize
loadBotRegistry();

function getBot(id) {
    return botRegistry[id];
}

function getAllBots() {
    return botRegistry;
}

function updateBot(id, data) {
    if (!botRegistry[id]) {
        botRegistry[id] = {};
    }
    Object.assign(botRegistry[id], data);
    saveBotRegistry();
    return botRegistry[id];
}

function deleteBot(id) {
    delete botRegistry[id];
    saveBotRegistry();
}

function getBotsByOwner(owner) {
    return Object.values(botRegistry).filter(b => b.owner && b.owner.toLowerCase() === owner.toLowerCase());
}

function getBotByName(name) {
    return Object.values(botRegistry).find(b => b.name === name);
}

module.exports = {
    getBot,
    getAllBots,
    updateBot,
    deleteBot,
    getBotsByOwner,
    getBotByName,
    saveBotRegistry // Exported for manual saves if needed
};
