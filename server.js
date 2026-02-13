const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const { Worker } = require('worker_threads');

// --- Sandbox Config ---
const BOTS_DIR = path.join(__dirname, 'bots');
if (!fs.existsSync(BOTS_DIR)) fs.mkdirSync(BOTS_DIR, { recursive: true });
const MAX_WORKERS = 300;
const activeWorkers = new Map(); // botId -> Worker instance

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
let matchNumber = 1;
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

function saveHistory(arenaId, winnerName, score) {
    matchHistory.unshift({
        matchId: nextMatchId(),
        arenaId,
        timestamp: new Date().toISOString(),
        winner: winnerName,
        score: score,
    });
    if (matchHistory.length > 100) matchHistory.pop();
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
    performance: 6,
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

function stopBotWorker(botId) {
    if (activeWorkers.has(botId)) {
        console.log(`[Worker] Stopping bot ${botId}`);
        const worker = activeWorkers.get(botId);
        worker.terminate();
        activeWorkers.delete(botId);
        checkWorkerLoad();
    }
}

function startBotWorker(botId) {
    // Stop existing if any
    stopBotWorker(botId);

    const bot = botRegistry[botId];
    if (!bot || !bot.scriptPath) {
        console.error(`[Worker] Cannot start bot ${botId}: No script found.`);
        return;
    }

    // Static Scan (Check before run)
    try {
        const content = fs.readFileSync(bot.scriptPath, 'utf8');
        const forbidden = ['require', 'import', 'process', 'fs', 'net', 'http', 'https', 'child_process', 'eval', 'Function', 'constructor', 'global', 'Buffer'];
        const found = forbidden.filter(k => content.includes(k));
        // Simple string check is prone to false positives (e.g. inside comments), but requested by prompt.
        // We will do a robust regex scan for word boundaries to avoid banning "processData".
        const risk = forbidden.find(k => new RegExp(`\\b${k}\\b`).test(content));
        
        if (risk) {
            console.error(`[Worker] Bot ${botId} blocked. Found forbidden keyword: ${risk}`);
            return;
        }
    } catch (e) {
        console.error(`[Worker] Error scanning script for bot ${botId}:`, e);
        return;
    }

    const arenaId = bot.preferredArenaId || 'performance-1';
    console.log(`[Worker] Starting bot ${botId} for arena ${arenaId}`);
    const worker = new Worker(path.join(__dirname, 'sandbox-worker.js'), {
        workerData: {
            scriptPath: bot.scriptPath,
            botId: botId,
            serverUrl: `ws://localhost:${PORT}?arenaId=${arenaId}` // Local loopback for bots
        }
    });

    worker.on('message', (msg) => {
        if (msg.type === 'log') console.log(`[Bot ${botId}]`, msg.message);
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
    });

    activeWorkers.set(botId, worker);
    checkWorkerLoad();
}

// --- Bot Registry (MVP, local JSON) ---
const BOT_DB_FILE = path.join(__dirname, 'data', 'bots.json');
let botRegistry = {};

function loadBotRegistry() {
    try {
        if (fs.existsSync(BOT_DB_FILE)) {
            botRegistry = JSON.parse(fs.readFileSync(BOT_DB_FILE));
            // Resume bots on server restart?
            // For MVP, we don't auto-restart, but we could.
        }
    } catch (e) {
        botRegistry = {};
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
        this.timerSeconds = 15;
        this.currentMatchId = nextMatchId();
        this.victoryPauseTimer = 0;
        this.lastSurvivorForVictory = null;

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
        const spawn = SPAWN_POINTS[this.spawnIndex % SPAWN_POINTS.length];
        this.spawnIndex++;
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

        // Auto-move for normal bots (no ws)
        Object.values(this.players).forEach((p) => {
            if (p.botType === 'normal' && !p.ws) {
                let dir = randomDirection();
                // Avoid reversing direction
                if (isOpposite(dir, p.direction)) {
                    dir = randomDirection();
                }
                p.nextDirection = dir;
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
            } while (this.isCellOccupied(fx, fy) || this.food.some(f => f.x === fx && f.y === fy));

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

        if (deathType === 'eaten') {
            p.body = [p.body[0]];
        }
    }

    startGameOver(survivor) {
        this.gameState = 'GAMEOVER';
        this.winner = survivor ? survivor.name : 'No Winner';
        this.timerSeconds = 30;
        saveHistory(this.id, this.winner, survivor ? survivor.score : 0);
        this.sendEvent('match_end', {
            matchId: this.currentMatchId,
            winnerBotId: survivor ? survivor.botId || null : null,
            winnerName: this.winner,
            arenaId: this.id,
            arenaType: this.type,
        });
    }

    startCountdown() {
        this.gameState = 'COUNTDOWN';
        this.timerSeconds = 15;
        this.food = [];
        this.spawnIndex = 0;

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
        this.victoryPauseTimer = 0;
        this.lastSurvivorForVictory = null;
        this.matchTimeLeft = MATCH_DURATION;
        colorIndex = 0;
    }

    startGame() {
        this.spawnIndex = 0;
        Object.keys(this.waitingRoom).forEach((id) => {
            const w = this.waitingRoom[id];
            const spawn = this.getSpawnPosition();
            this.players[id] = {
                id: id,
                name: w.name,
                color: w.color,
                body: spawn.body,
                direction: spawn.direction,
                nextDirection: spawn.direction,
                alive: true,
                score: 0,
                ws: w.ws,
                botType: w.botType,
                botId: w.botId || null,
            };
            if (w.ws && w.ws.readyState === 1) {
                w.ws.send(JSON.stringify({ type: 'init', id: id, botId: w.botId || null, gridSize: CONFIG.gridSize }));
            }
        });

        this.waitingRoom = {};
        this.gameState = 'PLAYING';
        this.turn = 0;
        this.timerSeconds = 0;
        this.matchTimeLeft = MATCH_DURATION;
        this.sendEvent('match_start', { matchId: this.currentMatchId, arenaId: this.id, arenaType: this.type });
    }

    broadcastState() {
        const displayPlayers = Object.values(this.players).map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            body: p.body,
            direction: p.direction,
            score: p.score,
            alive: p.alive,
            blinking: !p.alive && p.deathTimer > 0,
            deathTimer: p.deathTimer,
            deathType: p.deathType,
            length: p.body.length,
            botType: p.botType,
            botId: p.botId || null,
        }));

        const waitingPlayers = Object.values(this.waitingRoom).map((w) => ({
            id: w.id,
            name: w.name,
            color: w.color,
            body: [],
            score: 0,
            alive: true,
            waiting: true,
            botType: w.botType,
            botId: w.botId || null,
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
            victoryPause: this.victoryPauseTimer > 0,
            victoryPauseTime: Math.ceil(this.victoryPauseTimer / 8),
        };
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
            if (botMeta.credits <= 0) return { ok: false, reason: 'topup_required' };
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

        const id = Math.random().toString(36).substr(2, 5);
        this.waitingRoom[id] = {
            id: id,
            name: name,
            color: getNextColor(),
            ws: ws,
            botType,
            botId: data.botId || null,
            botPrice: data.botPrice || 0,
        };
        ws.send(JSON.stringify({ type: 'queued', id: id, botId: data.botId || null }));
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
createRoom('competitive');
createRoom('competitive');

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
        if (w.botType === 'agent') count++;
    });
    Object.values(room.players).forEach((p) => {
        if (p.botType === 'agent') count++;
    });
    return count;
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

    // performance
    if (botType === 'agent') {
        // Prefer a pre-assigned arena if present
        if (data.botId && botRegistry[data.botId] && botRegistry[data.botId].preferredArenaId) {
            const pref = botRegistry[data.botId].preferredArenaId;
            if (rooms.has(pref)) return rooms.get(pref);
        }

        // Fill rooms in order: keep replacing normals until a room has 10 agents
        for (const room of performanceRooms) {
            if (countAgentsInRoom(room) < room.maxPlayers) return room;
        }

        // Create new performance room if allowed
        if (performanceRooms.length < ROOM_LIMITS.performance) {
            const newRoom = createRoom('performance');
            return newRoom;
        }

        return null;
    }

    // normal/hero
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
                console.log(`[WS] Join request from ${data.name || 'unknown'} (botId: ${data.botId || 'none'})`);
                const url = new URL(req.url, `http://${req.headers.host}`);
                const arenaId = url.searchParams.get('arenaId');
                const botMeta = data.botId && botRegistry[data.botId] ? botRegistry[data.botId] : null;
                if (botMeta) {
                    data.name = botMeta.name;
                    data.botType = botMeta.botType;
                    data.botPrice = botMeta.price || 0;
                }

                if (arenaId && rooms.has(arenaId)) {
                    room = rooms.get(arenaId);
                } else {
                    room = assignRoomForJoin(data);
                }

                if (!room) {
                    console.log(`[WS] Join rejected: no room available`);
                    ws.send(JSON.stringify({ type: 'queued', id: null, reason: 'payment_required_or_full' }));
                    return;
                }

                room.clients.add(ws);
                const res = room.handleJoin(data, ws);
                console.log(`[WS] Join result for ${data.name}: ${JSON.stringify(res)}`);
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
        .sort((a,b)=>b.wins-a.wins);
}

app.post('/api/bot/register', requireUploadKey, (req, res) => {
    const { name, price, owner, botType } = req.body || {};
    const safeName = (name || 'AgentBot').toString().slice(0, MAX_NAME_LEN);
    const safePrice = Number(price || 0);
    const id = createBotId();
    botRegistry[id] = {
        id,
        name: safeName,
        owner: (owner || 'unknown').toString().slice(0, 64),
        price: isNaN(safePrice) ? 0 : safePrice,
        botType: botType || 'agent',
        credits: 1000,
        createdAt: Date.now()
    };
    saveBotRegistry();

    // auto-assign room on register (performance by default)
    const room = assignRoomForJoin({ name: botRegistry[id].name, botType: botRegistry[id].botType, botPrice: botRegistry[id].price || 0, arenaType: 'performance' });
    const payload = { ...botRegistry[id] };
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
        performance: performanceRooms.map(getRoomStatus),
        competitive: competitiveRooms.map(getRoomStatus)
    });
});

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

app.get('/api/leaderboard/global', (req, res) => {
    res.json(leaderboardFromHistory());
});

app.get('/api/leaderboard/arena/:arenaId', (req, res) => {
    res.json(leaderboardFromHistory(req.params.arenaId));
});

// --- Bot Upload & Sandbox API ---
app.post('/api/bot/upload', requireUploadKey, rateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
    try {
        const { botId } = req.query;
        let scriptContent = req.body;
        
        // If body-parser failed or body is empty
        if (!scriptContent || typeof scriptContent !== 'string') {
            return res.status(400).json({ error: 'invalid_script_content', message: 'Send script as text/javascript body' });
        }
        if (scriptContent.length > 200_000) {
            return res.status(413).json({ error: 'payload_too_large' });
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
        
        // 2. Resolve Bot ID
        let targetBotId = botId;
        if (!targetBotId) {
            // Create new bot if no ID provided
            targetBotId = createBotId();
            botRegistry[targetBotId] = {
                id: targetBotId,
                name: `Bot-${targetBotId.substr(-4)}`,
                credits: 5,
                botType: 'agent',
                createdAt: Date.now()
            };
        } else if (!botRegistry[targetBotId]) {
            return res.status(404).json({ error: 'bot_not_found' });
        }

        // 3. Save Script
        const scriptPath = path.join(BOTS_DIR, `${targetBotId}.js`);
        fs.writeFileSync(scriptPath, scriptContent);
        
        botRegistry[targetBotId].scriptPath = scriptPath;
        saveBotRegistry();

        // Auto-assign/kick rule: each uploaded agent bot kicks one normal bot
        if ((botRegistry[targetBotId].botType || 'agent') === 'agent') {
            prepareRoomForAgentUpload(targetBotId);
        }

        // 4. Restart if running
        if (activeWorkers.has(targetBotId)) {
            startBotWorker(targetBotId);
        }

        res.json({ ok: true, botId: targetBotId, message: 'Bot uploaded and scanned successfully.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'upload_failed' });
    }
});

app.post('/api/bot/start', requireAdminKey, (req, res) => {
    const { botId } = req.body;
    if (!botRegistry[botId]) return res.status(404).json({ error: 'bot_not_found' });
    
    if (activeWorkers.has(botId)) {
        return res.json({ ok: true, message: 'Already running' });
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

// --- Betting (MVP, in-memory) ---
const betPools = {}; // matchId -> { total: 0, bets: [] }

app.post('/api/bet/place', (req, res) => {
    // bettor is the wallet address, txHash is the transaction hash on Base Sepolia
    const { matchId, botId, amount, txHash, bettor } = req.body || {};
    
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
        timestamp: Date.now()
    });

    betPools[matchId].total += betAmount;

    console.log(`[Bet] New bet on match #${matchId}: ${betAmount} ETH on ${botId} by ${bettor} (Tx: ${txHash})`);

    res.json({ 
        ok: true, 
        total: betPools[matchId].total,
        matchId,
        yourBet: { botId, amount: betAmount }
    });
});

app.get('/api/bet/status', (req, res) => {
    const matchId = req.query.matchId;
    if (!matchId || !betPools[matchId]) return res.json({ total: 0, bets: [] });
    res.json(betPools[matchId]);
});

app.post('/api/bet/claim', (req, res) => {
    res.json({ ok: true });
});

app.get('/history', (req, res) => res.json(matchHistory));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));