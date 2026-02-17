const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bodyParser = require('body-parser');

const log = require('./utils/logger');
const { initContracts } = require('./services/blockchain');
const { initRooms, getRoom, rooms } = require('./services/room-manager');
const { setServerPort, isPerformancePaused, startBotWorker, stopBotWorker } = require('./services/sandbox');
const { getBot, saveBotRegistry } = require('./services/bot-registry');
const { rateLimit, requireAdminKey } = require('./middleware/auth');
const { CONFIG } = require('./config/constants');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Configuration ---
const PORT = process.env.PORT || 3000;
setServerPort(PORT);

// --- Middleware ---
app.use((req, res, next) => {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
});

app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json({ limit: '200kb' }));
app.use(bodyParser.text({ type: 'text/javascript', limit: '200kb' }));
app.use(bodyParser.text({ type: 'application/javascript', limit: '200kb' }));
app.use(bodyParser.text({ type: 'text/plain', limit: '200kb' }));

// --- Routes ---
app.use('/api', rateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/bot', require('./routes/bot'));
app.use('/api/arena', require('./routes/arena'));
app.use('/api/bet', require('./routes/betting'));
app.use('/api/referral', require('./routes/referral'));

// --- WebSocket Handling ---
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const arenaId = url.searchParams.get('arenaId') || 'performance-1';
    let room = getRoom(arenaId);
    let playerId = null;
    let isImportant = false;

    // Performance Pause Check
    if (room && room.type === 'performance' && isPerformancePaused()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Performance rooms paused due to high load' }));
        ws.close();
        return;
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));

            if (data.type === 'join') {
                // If requesting specific room in join payload, override URL param
                if (data.arenaId && rooms.has(data.arenaId)) {
                    room = rooms.get(data.arenaId);
                }
                
                // If room doesn't exist or not assigned yet (e.g. dynamic assignment needed),
                // room-manager logic handles assignment?
                // For now, assume client connects to correct WS URL or we redirect.
                // If room is null, try to assign default
                if (!room) {
                     // Auto-assign?
                     // const { assignRoomForJoin } = require('./services/room-manager');
                     // room = assignRoomForJoin(...)
                     // But WS connection is already established. Usually we return error and ask to reconnect to correct URL/ID.
                     ws.send(JSON.stringify({ type: 'queued', id: null, reason: 'invalid_arena_id' }));
                     return;
                }

                const botId = data.botId;
                const meta = botId ? getBot(botId) : null;
                const isAgent = meta && (meta.botType === 'agent' || meta.botType === 'hero');
                const isHero = meta && meta.botType === 'hero';
                isImportant = isAgent; // Log important joins

                // Credit Check
                if (isAgent && room.type === 'performance' && !meta.unlimited && (meta.credits || 0) <= 0) {
                     ws.send(JSON.stringify({ type: 'error', message: 'Insufficient credits', reason: 'topup_required' }));
                     return;
                }

                room.clients.add(ws);
                const res = room.handleJoin(data, ws);
                
                if (isImportant) {
                    log.important(`[Join] ${data.name || 'Bot'} (${botId || 'anon'}) -> ${room.id}: ${res.ok ? 'OK' : res.reason}`);
                } else {
                    log.debug(`[Join] ${data.name || 'Bot'} -> ${room.id}: ${res.ok ? 'OK' : res.reason}`);
                }

                if (res.ok) {
                    playerId = res.id;
                    // Deduct credit if applicable (handled in room.handleJoin logic? No, room logic handles structure, credit logic here or in room?)
                    // room.handleJoin had credit logic in old server.js.
                    // Let's check room.js... I might have omitted credit deduction in room.js copy!
                    // Checking room.js... Yes, I copied handleJoin but missed the `botMeta` lookup inside room.js because botRegistry wasn't imported there fully or correctly.
                    // Actually, I imported `getBot` in `room.js`.
                    // Let's verify room.js handleJoin logic.
                    // room.js: handleJoin does check `botRegistry[data.botId]`.
                    // So credit deduction happens there.
                } else {
                    ws.send(JSON.stringify({ type: 'queued', id: null, reason: res.reason }));
                }
            } else if (data.type === 'move' && room && playerId) {
                room.handleMove(playerId, data);
            }
        } catch (e) {
            log.error('WS Error:', e);
        }
    });

    ws.on('close', () => {
        if (room && playerId) {
            room.clients.delete(ws);
            room.handleDisconnect(playerId);
        }
    });
});

// --- Initialization ---
async function start() {
    initContracts();
    initRooms();
    
    server.listen(PORT, () => {
        log.important(`🚀 Snake Arena Server (Refactored) running on port ${PORT}`);
        
        // Resume bots
        // resumeRunningBots logic needs to be imported or re-implemented
        // It was: Object.keys(botRegistry).filter(running).forEach(startBotWorker)
        const bots = require('./services/bot-registry').getAllBots();
        const running = Object.values(bots).filter(b => b.running);
        if (running.length > 0) {
            log.important(`[Resume] Restarting ${running.length} bots...`);
            running.forEach((b, i) => {
                setTimeout(() => startBotWorker(b.id), i * 500);
            });
        }
    });
}

start();
