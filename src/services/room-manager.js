const GameRoom = require('../game/room');
const log = require('../utils/logger');
const { getBot, getAllBots } = require('./bot-registry');
const { ROOM_MAX_PLAYERS, ROOM_LIMITS, CONFIG, SNAKE_COLORS } = require('../config/constants');
const fs = require('fs');
const path = require('path');

const rooms = new Map();
const performanceRooms = [];
const competitiveRooms = [];
let currentEntryFee = 0.01;
const ENTRY_FEE_FILE = path.join(__dirname, '../../data', 'entry-fee.json');

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
loadEntryFee();

function saveEntryFee() {
    try {
        const dir = path.dirname(ENTRY_FEE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ENTRY_FEE_FILE, JSON.stringify({ currentEntryFee }, null, 2));
    } catch (e) {}
}

function getNextColor() {
    // Basic random color for now, or cycle
    return SNAKE_COLORS[Math.floor(Math.random() * SNAKE_COLORS.length)];
}

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

function createRoom(type) {
    const index = type === 'performance' ? performanceRooms.length + 1 : competitiveRooms.length + 1;
    const id = `${type}-${index}`;
    const room = new GameRoom({ id, type });
    rooms.set(id, room);
    if (type === 'performance') {
        performanceRooms.push(room);
        seedNormalBots(room, ROOM_MAX_PLAYERS.performance);
    } else {
        competitiveRooms.push(room);
    }
    return room;
}

function createCompetitiveRoom() {
    const id = 'competitive-1';
    // Check if exists
    if (rooms.has(id)) return rooms.get(id);

    const room = new GameRoom({ id, type: 'competitive' });
    rooms.set(id, room);
    competitiveRooms.push(room);
    seedNormalBots(room, 6);
    
    // Auto-fill interval
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
    Object.values(currentPlayers).forEach(p => { if (p.botId) currentBotIds.add(p.botId); });
    
    const paidForMatch = room.paidEntries[room.matchNumber] || [];
    
    // 1. Paid entries
    for (const botId of paidForMatch) {
        if (currentBotIds.has(botId)) continue;
        if (Object.keys(room.waitingRoom).length >= room.maxPlayers) break;
        
        const meta = getBot(botId);
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
        log.important(`[Competitive] Paid entry: ${meta.name} (${botId}) match #${room.matchNumber}`);
    }
    
    // 2. Random fill from registered agents
    const allBots = getAllBots();
    const agentBotIds = Object.keys(allBots).filter(id => 
        allBots[id].botType === 'agent' && 
        allBots[id].scriptPath && 
        !currentBotIds.has(id)
    );
    
    // Shuffle
    for (let i = agentBotIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [agentBotIds[i], agentBotIds[j]] = [agentBotIds[j], agentBotIds[i]];
    }
    
    const normalIds = Object.keys(room.waitingRoom).filter(id => room.waitingRoom[id].botType === 'normal');
    let replaced = 0;
    
    for (const botId of agentBotIds) {
        if (replaced >= normalIds.length) break;
        if (Object.keys(room.waitingRoom).length >= room.maxPlayers && normalIds.length <= replaced) break;
        
        if (normalIds[replaced]) delete room.waitingRoom[normalIds[replaced]];
        
        const meta = allBots[botId];
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

function assignRoomForJoin(data) {
    const { arenaType } = data;
    
    if (arenaType === 'competitive') {
        const room = competitiveRooms[0];
        if (!room) return null;
        if (room.hasSpace()) return room;
        // Competitive allows queueing via paid entry API mostly, or luck here
        // If full, reject for now unless we implement queue logic
        return room.capacityRemaining() > 0 ? room : null;
    } else {
        // Performance: find room with space or create new
        for (const room of performanceRooms) {
            if (room.hasSpace()) return room;
            // Kick normal bot if needed
            const victim = room.findKickableNormal(); // Need to implement findKickableNormal on Room? Yes, was on prototype
            if (victim) {
                delete room.waitingRoom[victim];
                return room;
            }
        }
        
        // If all full, check limits
        if (performanceRooms.length < ROOM_LIMITS.performance) {
            return createRoom('performance');
        }
        
        // Fallback: Pick random performance room and kick normal if possible (already checked above),
        // or just pick one and let handleJoin try to squeeze/queue?
        return performanceRooms[Math.floor(Math.random() * performanceRooms.length)];
    }
}

// Logic for entry fee increase
function checkAndIncreaseFee() {
    let count = 0;
    for (const room of performanceRooms) {
        Object.values(room.waitingRoom).forEach((w) => {
            if ((w.botType === 'agent' || w.botType === 'hero') && (w.entryPrice || 0) >= currentEntryFee) count++;
        });
        Object.values(room.players).forEach((p) => {
            if ((p.botType === 'agent' || p.botType === 'hero') && (p.entryPrice || 0) >= currentEntryFee) count++;
        });
    }

    const totalCapacity = performanceRooms.length * ROOM_MAX_PLAYERS.performance;
    if (count >= totalCapacity * 0.9 && totalCapacity > 0) { // 90% full
        currentEntryFee += 0.01;
        saveEntryFee();
        log.important(`[Fee] Increased entry fee to ${currentEntryFee} ETH (Agents: ${count})`);
    }
}

// Helper to init default rooms
function initRooms() {
    if (performanceRooms.length === 0) createRoom('performance');
    if (competitiveRooms.length === 0) createCompetitiveRoom();
    
    // Check agents to maybe spawn more rooms
    const agentCount = Object.values(getAllBots()).filter(b => b.botType === 'agent' && b.scriptPath).length;
    if (agentCount > 5 && performanceRooms.length < 2) {
        createRoom('performance');
        log.important(`[Init] Created performance-2 (found ${agentCount} bots)`);
    }
}

module.exports = {
    initRooms,
    rooms,
    performanceRooms,
    competitiveRooms,
    createRoom,
    createCompetitiveRoom,
    assignRoomForJoin,
    checkAndIncreaseFee,
    currentEntryFee,
    getRoom: (id) => rooms.get(id)
};
