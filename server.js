
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
let countdownVal = 0;

// Force Loop (125ms)
setInterval(() => {
    if (gameState === 'PLAYING') tick();
    if (gameState === 'COUNTDOWN') broadcastState(); // Keep updating countdown
}, 125);

function tick() {
    turn++;
    // Spawn Food
    while (food.length < MAX_FOOD) {
        food.push({ x: Math.floor(Math.random()*CONFIG.gridSize), y: Math.floor(Math.random()*CONFIG.gridSize) });
    }

    let aliveCount = 0;
    let lastSurvivor = null;

    Object.values(players).forEach(p => {
        if (!p.alive) return;
        aliveCount++;
        lastSurvivor = p;

        p.direction = p.nextDirection;
        const head = p.body[0];
        const newHead = { x: head.x + p.direction.x, y: head.y + p.direction.y };

        // Collision
        let crashed = false;
        if (newHead.x < 0 || newHead.x >= CONFIG.gridSize || newHead.y < 0 || newHead.y >= CONFIG.gridSize) crashed = true;
        
        if(!crashed) {
            for(let id in players) {
                const other = players[id];
                if(!other.alive) continue;
                for(let part of other.body) {
                    if(newHead.x === part.x && newHead.y === part.y) crashed = true;
                }
            }
        }

        if (crashed) {
            p.alive = false;
        } else {
            p.body.unshift(newHead);
            let ate = false;
            for(let i=0; i<food.length; i++) {
                if(food[i].x === newHead.x && food[i].y === newHead.y) {
                    food.splice(i,1); ate = true; p.score += 10; break;
                }
            }
            if(!ate) p.body.pop();
        }
    });

    // Win Condition
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && aliveCount <= 1) {
        gameState = 'GAMEOVER';
        winner = lastSurvivor ? lastSurvivor.name : "No Winner";
        console.log(`🏆 GAME OVER! Winner: ${winner}`);
        saveHistory(winner, lastSurvivor ? lastSurvivor.score : 0);
        
        // 3 Minutes Cooldown, then Countdown
        setTimeout(startCountdown, 180 * 1000);
    }

    broadcastState();
}

function startCountdown() {
    console.log("Starting Countdown...");
    gameState = 'COUNTDOWN';
    countdownVal = 30; // 30s Betting Phase
    players = {}; // Clear arena
    food = [];
    
    let timer = setInterval(() => {
        countdownVal--;
        if (countdownVal <= 0) {
            clearInterval(timer);
            gameState = 'PLAYING';
            turn = 0;
            console.log("GO!");
        }
    }, 1000);
}

function broadcastState() {
    const state = {
        gridSize: CONFIG.gridSize,
        turn: turn,
        gameState: gameState,
        winner: winner,
        countdown: countdownVal,
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
