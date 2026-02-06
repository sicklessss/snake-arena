
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

// --- Game Logic ---
// Force game loop every 250ms (High Speed!)
setInterval(tick, 250);

function tick() {
    turn++; // Increment turn
    spawnFood();

    Object.values(players).forEach(p => {
        if (!p.alive) return;

        // Apply intent
        p.direction = p.nextDirection;
        const head = p.body[0];
        const newHead = { x: head.x + p.direction.x, y: head.y + p.direction.y };

        // 1. Wall Collision
        if (newHead.x < 0 || newHead.x >= CONFIG.gridSize || 
            newHead.y < 0 || newHead.y >= CONFIG.gridSize) {
            p.alive = false;
            console.log(`💀 ${p.name} hit a wall`);
            return;
        }

        // 2. Body Collision (Self & Others)
        for (let otherId in players) {
            const other = players[otherId];
            if (!other.alive) continue;
            for (let part of other.body) {
                if (newHead.x === part.x && newHead.y === part.y) {
                    p.alive = false;
                    console.log(`💀 ${p.name} crashed`);
                    return;
                }
            }
        }

        // Move
        if (p.alive) {
            p.body.unshift(newHead);
            // Eat?
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

        p.hasMoved = false; // Reset turn flag
    });

    broadcastState();
}

function broadcastState() {
    const state = {
        gridSize: CONFIG.gridSize,
        turn: turn,
        players: Object.values(players).filter(p => p.alive).map(p => ({
            id: p.id,
            name: p.name,
            color: p.color,
            body: p.body,
            score: p.score
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

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🐍 HTTP Snake Arena running on port ${PORT}`);
});
