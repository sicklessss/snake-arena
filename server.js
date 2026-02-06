
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- Game Configuration ---
const CONFIG = {
    gridSize: 30, // Larger map
};

// --- Game State ---
let players = {}; 
let food = [];
let turn = 0; // Turn counter
const MAX_FOOD = 5; // More food for 10 snakes

// --- Helper Functions ---
function spawnFood() {
    while (food.length < MAX_FOOD) {
        const x = Math.floor(Math.random() * CONFIG.gridSize);
        const y = Math.floor(Math.random() * CONFIG.gridSize);
        food.push({ x, y });
    }
}

function initPlayer(id, name) {
    // Random safe spawn
    const startX = Math.floor(Math.random() * (CONFIG.gridSize - 6)) + 3; 
    const startY = Math.floor(Math.random() * (CONFIG.gridSize - 6)) + 3;
    
    return {
        id: id,
        name: name,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`, // Unique rainbow colors
        body: [
            { x: startX, y: startY },
            { x: startX, y: startY + 1 },
            { x: startX, y: startY + 2 }
        ],
        direction: { x: 0, y: -1 },
        nextDirection: { x: 0, y: -1 },
        hasMoved: false, // For turn-based logic
        alive: true,
        score: 0
    };
}

let gameState = 'PLAYING'; // PLAYING, GAMEOVER
let winner = null;
let gameOverTimer = null;

const fs = require('fs');

// --- Persistence ---
const HISTORY_FILE = 'history.json';
let matchHistory = [];

// Load history on startup
if (fs.existsSync(HISTORY_FILE)) {
    try {
        matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE));
    } catch (e) { console.error("Failed to load history", e); }
}

function saveHistory(winnerName, score) {
    const record = {
        timestamp: new Date().toISOString(),
        winner: winnerName,
        score: score,
        id: Date.now()
    };
    matchHistory.unshift(record); // Add to top
    if (matchHistory.length > 100) matchHistory.pop(); // Keep last 100
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
}

// --- Game Logic ---
// Force game loop every 125ms
setInterval(() => {
    if (gameState === 'PLAYING') tick();
}, 125);

// API to get history
app.get('/history', (req, res) => {
    res.json(matchHistory);
});

function tick() {
    turn++; 
    spawnFood();

    let aliveCount = 0;
    let lastSurvivor = null;

    Object.values(players).forEach(p => {
        if (!p.alive) return;
        aliveCount++;
        lastSurvivor = p;

        // ... (Existing Move Logic) ...
        p.direction = p.nextDirection;
        const head = p.body[0];
        const newHead = { x: head.x + p.direction.x, y: head.y + p.direction.y };

        // Collision Checks
        let crashed = false;
        if (newHead.x < 0 || newHead.x >= CONFIG.gridSize || newHead.y < 0 || newHead.y >= CONFIG.gridSize) crashed = true;
        
        if (!crashed) {
            for (let otherId in players) {
                const other = players[otherId];
                if (!other.alive) continue;
                for (let part of other.body) {
                    if (newHead.x === part.x && newHead.y === part.y) crashed = true;
                }
            }
        }

        if (crashed) {
            p.alive = false; // Die
        } else {
            // Move & Eat
            p.body.unshift(newHead);
            let ate = false;
            for (let i = 0; i < food.length; i++) {
                if (food[i].x === newHead.x && food[i].y === newHead.y) {
                    food.splice(i, 1);
                    ate = true;
                    p.score += 10;
                    break;
                }
            }
            if (!ate) p.body.pop();
        }
        
        p.hasMoved = false; 
    });

    // --- Win Condition ---
    // If only 1 (or 0) left, triggers Game Over
    // Only check if we actually had players to begin with (>1)
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && aliveCount <= 1) {
        gameState = 'GAMEOVER';
        winner = lastSurvivor ? lastSurvivor.name : "No Winner";
        const score = lastSurvivor ? lastSurvivor.score : 0;
        
        console.log(`🏆 GAME OVER! Winner: ${winner}`);
        saveHistory(winner, score);
        
        // Reset after 3 minutes (180 seconds)
        setTimeout(resetGame, 180 * 1000);
    }

    broadcastState();
}

function resetGame() {
    console.log("🔄 Resetting Arena...");
    players = {}; // Kick everyone out (or keep them and respawn? Let's kick for new round)
    food = [];
    turn = 0;
    gameState = 'PLAYING';
    winner = null;
    // Note: Clients will need to re-join
}

function broadcastState() {
    const state = {
        gridSize: CONFIG.gridSize,
        turn: turn,
        gameState: gameState, // Send status
        winner: winner,       // Send winner name
        players: Object.values(players).map(p => ({ // Send ALL players (even dead ones) for scoreboard
            id: p.id,
            name: p.name,
            color: p.color,
            body: p.body,
            score: p.score,
            alive: p.alive
        })),
        food: food
    };
    const msg = JSON.stringify({ type: 'update', state });
    wss.clients.forEach(c => { if(c.readyState===WebSocket.OPEN) c.send(msg); });
}

// --- WebSocket Handling (Low Latency, Low Overhead) ---
wss.on('connection', (ws) => {
    let playerId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Join
            if (data.type === 'join') {
                const id = Math.random().toString(36).substr(2, 5);
                playerId = id;
                players[id] = initPlayer(id, data.name || 'WS-Bot');
                console.log(`🔌 WS Player joined: ${players[id].name} (${id})`);
                ws.send(JSON.stringify({ type: 'init', id: id, gridSize: CONFIG.gridSize }));
            }

            // 2. Move
            if (data.type === 'move' && playerId && players[playerId] && players[playerId].alive) {
                // Update direction immediately
                players[playerId].nextDirection = data.direction;
            }

        } catch (e) { console.error(e); }
    });

    ws.on('close', () => {
        if (playerId && players[playerId]) {
            players[playerId].alive = false; // Mark as dead on disconnect
        }
    });
});

// --- HTTP API for AI Agent (Legacy Support) ---
// 1. Register
app.post('/join', (req, res) => {
    const { name } = req.body;
    const id = Math.random().toString(36).substr(2, 5);
    players[id] = initPlayer(id, name);
    console.log(`Player registered: ${name} (${id})`);
    res.json({ id, gridSize: CONFIG.gridSize });
    broadcastState();
});

// 2. Get State (Eyes)
app.get('/state', (req, res) => {
    res.json({
        gridSize: CONFIG.gridSize,
        players: players, // Send full internal state including 'hasMoved'
        food: food
    });
});

// 3. Send Move (Hands)
app.post('/move', (req, res) => {
    const { id, direction } = req.body; // direction: {x, y}
    
    if (players[id] && players[id].alive) {
        // Prevent 180 (optional check, AI should know better)
        players[id].nextDirection = direction;
        players[id].hasMoved = true;
    }

    // Always return success immediately
    res.json({ status: 'accepted' });
});

// Use PORT from environment variable, or default to 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🐍 HTTP Snake Arena running on port ${PORT}`);
});
