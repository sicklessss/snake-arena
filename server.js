
const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- Persistence ---
const HISTORY_FILE = 'history.json';
let matchHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
    try { matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE)); } catch(e){}
}

function saveHistory(winnerName, score) {
    matchHistory.unshift({ timestamp: new Date().toISOString(), winner: winnerName, score: score });
    if(matchHistory.length>100) matchHistory.pop();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
}

// --- Game Config ---
const CONFIG = { gridSize: 30 };
let players = {}; 
let food = [];
let turn = 0;
const MAX_FOOD = 5;

// --- State Machine ---
let gameState = 'PLAYING'; // PLAYING, GAMEOVER, COUNTDOWN
let winner = null;
let timerSeconds = 0; // Unified timer for states

// Force Loop (125ms)
setInterval(() => {
    // 1. Game Logic
    if (gameState === 'PLAYING') {
        tick();
    } 
    // 2. State Timers (Run logic every ~1 second approx)
    else {
        // We broadcast state frequently so UI is responsive
        broadcastState(); 
    }
}, 125);

// 1s Timer Loop for countdowns
setInterval(() => {
    if (gameState !== 'PLAYING') {
        if (timerSeconds > 0) {
            timerSeconds--;
        } else {
            // Timer finished, switch state
            if (gameState === 'GAMEOVER') {
                startCountdown(); // Go to betting phase
            } else if (gameState === 'COUNTDOWN') {
                startGame(); // Go to fighting phase
            }
        }
    }
}, 1000);

function tick() {
    turn++;
    
    // Spawn food
    while (food.length < MAX_FOOD) {
        food.push({
            x: Math.floor(Math.random() * CONFIG.gridSize),
            y: Math.floor(Math.random() * CONFIG.gridSize)
        });
    }
    
    // Move players
    Object.values(players).forEach(p => {
        if (!p.alive) return;
        
        // Update direction
        p.direction = p.nextDirection;
        
        // Calculate new head position
        const head = p.body[0];
        const newHead = {
            x: (head.x + p.direction.x + CONFIG.gridSize) % CONFIG.gridSize,
            y: (head.y + p.direction.y + CONFIG.gridSize) % CONFIG.gridSize
        };
        
        // Check food collision
        const foodIndex = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
        if (foodIndex !== -1) {
            food.splice(foodIndex, 1);
            p.score++;
        } else {
            p.body.pop(); // Remove tail if no food eaten
        }
        
        // Add new head
        p.body.unshift(newHead);
    });
    
    // Check collisions
    Object.values(players).forEach(p => {
        if (!p.alive) return;
        const head = p.body[0];
        
        // Self collision
        for (let i = 1; i < p.body.length; i++) {
            if (p.body[i].x === head.x && p.body[i].y === head.y) {
                p.alive = false;
                return;
            }
        }
        
        // Collision with others
        Object.values(players).forEach(other => {
            if (other.id === p.id) return;
            for (const seg of other.body) {
                if (seg.x === head.x && seg.y === head.y) {
                    p.alive = false;
                    return;
                }
            }
        });
    });
    
    // Calculate alive count and last survivor
    let aliveCount = 0;
    let lastSurvivor = null;
    Object.values(players).forEach(p => {
        if (p.alive) {
            aliveCount++;
            lastSurvivor = p;
        }
    });
    
    // Win Condition
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && aliveCount <= 1) {
        startGameOver(lastSurvivor);
    }

    broadcastState();
}

function startGameOver(survivor) {
    gameState = 'GAMEOVER';
    winner = survivor ? survivor.name : "No Winner";
    timerSeconds = 180; // 3 Minutes Showdown
    console.log(`🏆 GAME OVER! Winner: ${winner}`);
    saveHistory(winner, survivor ? survivor.score : 0);
}

function startCountdown() {
    console.log("Starting Countdown...");
    gameState = 'COUNTDOWN';
    timerSeconds = 30; // 30s Betting Phase
    players = {}; // Clear arena
    food = [];
}

function startGame() {
    console.log("🏁 GO!");
    gameState = 'PLAYING';
    turn = 0;
    timerSeconds = 0;
    // Bots will auto-rejoin
}

function broadcastState() {
    const state = {
        gridSize: CONFIG.gridSize,
        turn: turn,
        gameState: gameState,
        winner: winner,
        timeLeft: timerSeconds, // Send precise time to client
        players: Object.values(players).map(p => ({
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

// --- WebSocket ---
wss.on('connection', (ws) => {
    let playerId = null;
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (data.type === 'join') {
                if (gameState !== 'PLAYING') return; // Can't join during cooldown

                // VIP Kick Logic
                const isHero = data.name && data.name.includes('HERO');
                if (Object.keys(players).length >= 20) {
                    if (isHero) {
                        const victim = Object.keys(players).find(id => !players[id].name.includes('HERO'));
                        if (victim) delete players[victim];
                    } else {
                        return; // Full
                    }
                }

                const id = Math.random().toString(36).substr(2, 5);
                playerId = id;
                players[id] = {
                    id: id,
                    name: data.name || 'Bot',
                    color: `hsl(${Math.random()*360}, 100%, 50%)`,
                    body: [{x:5,y:5}, {x:5,y:6}, {x:5,y:7}], // Simplified spawn (collisions will resolve themselves)
                    direction: {x:0,y:-1},
                    nextDirection: {x:0,y:-1},
                    alive: true,
                    score: 0
                };
                ws.send(JSON.stringify({ type: 'init', id: id, gridSize: CONFIG.gridSize }));
            }
            if (data.type === 'move' && playerId && players[playerId]) {
                players[playerId].nextDirection = data.direction;
            }
        } catch(e){}
    });
    ws.on('close', () => {
        if(playerId && players[playerId]) players[playerId].alive = false;
    });
});

app.get('/history', (req, res) => res.json(matchHistory));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
