const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

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

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- Persistence ---
const HISTORY_FILE = 'history.json';
let matchHistory = [];
let matchNumber = 1;
if (fs.existsSync(HISTORY_FILE)) {
    try { 
        matchHistory = JSON.parse(fs.readFileSync(HISTORY_FILE)); 
        if (matchHistory.length > 0 && matchHistory[0].matchId) {
            matchNumber = matchHistory[0].matchId + 1;
        }
    } catch(e){}
}

function saveHistory(winnerName, score) {
    matchHistory.unshift({ 
        matchId: matchNumber,
        timestamp: new Date().toISOString(), 
        winner: winnerName, 
        score: score 
    });
    matchNumber++;
    if(matchHistory.length>100) matchHistory.pop();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(matchHistory));
}

// --- Game Config ---
const CONFIG = { gridSize: 30 };
const MATCH_DURATION = 180; // 3 minutes in seconds
let players = {}; 
let food = [];
let turn = 0;
let matchTimeLeft = MATCH_DURATION; // Countdown timer
const MAX_FOOD = 5;
const DEATH_BLINK_TURNS = 24;

// --- Waiting Room ---
let waitingRoom = {};

// --- Spawn Points ---
const SPAWN_POINTS = [
    { x: 5, y: 5, dir: {x:1, y:0} },
    { x: 25, y: 5, dir: {x:-1, y:0} },
    { x: 5, y: 25, dir: {x:1, y:0} },
    { x: 25, y: 25, dir: {x:-1, y:0} },
    { x: 15, y: 3, dir: {x:0, y:1} },
    { x: 15, y: 27, dir: {x:0, y:-1} },
    { x: 3, y: 15, dir: {x:1, y:0} },
    { x: 27, y: 15, dir: {x:-1, y:0} },
    { x: 10, y: 10, dir: {x:1, y:0} },
    { x: 20, y: 20, dir: {x:-1, y:0} },
];
let spawnIndex = 0;

function getSpawnPosition() {
    const spawn = SPAWN_POINTS[spawnIndex % SPAWN_POINTS.length];
    spawnIndex++;
    const body = [
        { x: spawn.x, y: spawn.y },
        { x: spawn.x - spawn.dir.x, y: spawn.y - spawn.dir.y },
        { x: spawn.x - spawn.dir.x * 2, y: spawn.y - spawn.dir.y * 2 }
    ];
    return { body, direction: spawn.dir };
}

// --- State Machine ---
let gameState = 'COUNTDOWN';
let winner = null;
let timerSeconds = 15;
let currentMatchId = matchNumber;
let victoryPauseTimer = 0;
let lastSurvivorForVictory = null;

// Main Loop (125ms = 8 ticks per second)
setInterval(() => {
    if (gameState === 'PLAYING') {
        tick();
    } else {
        broadcastState(); 
    }
}, 125);

// 1s Timer Loop - handles countdown and match time
setInterval(() => {
    if (gameState === 'PLAYING') {
        // Count down match time
        if (matchTimeLeft > 0) {
            matchTimeLeft--;
            if (matchTimeLeft <= 0) {
                // Time's up! Longest snake wins
                endMatchByTime();
            }
        }
    } else if (gameState !== 'PLAYING') {
        if (timerSeconds > 0) {
            timerSeconds--;
        } else {
            if (gameState === 'GAMEOVER') {
                startCountdown();
            } else if (gameState === 'COUNTDOWN') {
                startGame();
            }
        }
    }
}, 1000);

function tick() {
    // Victory pause
    if (victoryPauseTimer > 0) {
        victoryPauseTimer--;
        broadcastState();
        if (victoryPauseTimer <= 0) {
            startGameOver(lastSurvivorForVictory);
        }
        return;
    }
    
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
        
        // Apply next direction (already validated)
        p.direction = p.nextDirection;
        const head = p.body[0];
        const newHead = {
            x: head.x + p.direction.x,
            y: head.y + p.direction.y
        };
        
        // Wall collision
        if (newHead.x < 0 || newHead.x >= CONFIG.gridSize ||
            newHead.y < 0 || newHead.y >= CONFIG.gridSize) {
            killPlayer(p, 'wall');
            return;
        }
        
        // Eat food
        const foodIndex = food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
        if (foodIndex !== -1) {
            food.splice(foodIndex, 1);
            p.score++;
        } else {
            p.body.pop();
        }
        
        p.body.unshift(newHead);
    });
    
    // --- Collision Detection ---
    Object.values(players).forEach(p => {
        if (!p.alive) return;
        const head = p.body[0];
        
        // Self collision
        for (let i = 1; i < p.body.length; i++) {
            if (p.body[i].x === head.x && p.body[i].y === head.y) {
                killPlayer(p, 'self');
                return;
            }
        }
        
        // Dead snake collision (obstacles)
        Object.values(players).forEach(other => {
            if (other.id === p.id || other.alive) return;
            if (other.deathType === 'eaten') return;
            
            for (const seg of other.body) {
                if (seg.x === head.x && seg.y === head.y) {
                    killPlayer(p, 'corpse');
                    return;
                }
            }
        });
    });
    
    // --- Snake vs Snake (New Rules) ---
    const alivePlayers = Object.values(players).filter(p => p.alive);
    const processed = new Set();
    
    for (const p of alivePlayers) {
        if (!p.alive || processed.has(p.id)) continue;
        const pHead = p.body[0];
        
        for (const other of alivePlayers) {
            if (other.id === p.id || !other.alive || processed.has(other.id)) continue;
            const oHead = other.body[0];
            
            // Head-on collision
            if (pHead.x === oHead.x && pHead.y === oHead.y) {
                if (p.body.length > other.body.length) {
                    killPlayer(other, 'eaten');
                    processed.add(other.id);
                } else if (other.body.length > p.body.length) {
                    killPlayer(p, 'eaten');
                    processed.add(p.id);
                } else {
                    killPlayer(p, 'headon');
                    killPlayer(other, 'headon');
                    processed.add(p.id);
                    processed.add(other.id);
                }
                continue;
            }
            
            // P hits Other's body
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
                        console.log(`🍴 ${p.name} ate ${eaten} from ${other.name}`);
                        if (other.body.length < 1) {
                            killPlayer(other, 'eaten');
                            processed.add(other.id);
                        }
                    } else {
                        killPlayer(p, 'collision');
                        processed.add(p.id);
                    }
                    break;
                }
            }
            
            // Other hits P's body
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
                        console.log(`🍴 ${other.name} ate ${eaten} from ${p.name}`);
                        if (p.body.length < 1) {
                            killPlayer(p, 'eaten');
                            processed.add(p.id);
                        }
                    } else {
                        killPlayer(other, 'collision');
                        processed.add(other.id);
                    }
                    break;
                }
            }
        }
    }
    
    // Update blink timers
    Object.values(players).forEach(p => {
        if (!p.alive && p.deathTimer !== undefined) {
            if (p.deathTimer > 0) p.deathTimer--;
            if (p.deathTimer <= 0) p.deathTimer = DEATH_BLINK_TURNS;
        }
    });
    
    // Win condition - last snake standing
    let aliveCount = 0;
    let lastSurvivor = null;
    Object.values(players).forEach(p => {
        if (p.alive) { aliveCount++; lastSurvivor = p; }
    });
    
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && aliveCount === 1) {
        victoryPauseTimer = 24;
        lastSurvivorForVictory = lastSurvivor;
        console.log(`🎯 Last snake: ${lastSurvivor.name} - 3s pause...`);
    } else if (totalPlayers > 1 && aliveCount === 0) {
        startGameOver(null);
    }

    broadcastState();
}

function endMatchByTime() {
    // Find longest alive snake
    let longest = null;
    let maxLen = 0;
    
    Object.values(players).forEach(p => {
        if (p.alive && p.body.length > maxLen) {
            maxLen = p.body.length;
            longest = p;
        }
    });
    
    console.log(`⏰ Time's up! Winner by length: ${longest ? longest.name : 'No one'} (${maxLen})`);
    startGameOver(longest);
}

function killPlayer(p, deathType = 'default') {
    p.alive = false;
    p.deathTimer = DEATH_BLINK_TURNS;
    p.deathTime = Date.now();
    p.deathType = deathType;
    
    if (deathType === 'eaten') {
        p.body = [p.body[0]];
    }
}

function startGameOver(survivor) {
    gameState = 'GAMEOVER';
    winner = survivor ? survivor.name : "No Winner";
    timerSeconds = 30;
    console.log(`🏆 Match #${currentMatchId} OVER! Winner: ${winner}`);
    saveHistory(winner, survivor ? survivor.score : 0);
}

function startCountdown() {
    console.log("Starting Countdown...");
    gameState = 'COUNTDOWN';
    timerSeconds = 15;
    players = {};
    food = [];
    spawnIndex = 0;
    waitingRoom = {};
    currentMatchId = matchNumber;
    victoryPauseTimer = 0;
    lastSurvivorForVictory = null;
    matchTimeLeft = MATCH_DURATION;
    colorIndex = 0; // Reset color assignment for new match
}

function startGame() {
    console.log(`🐍 Match #${currentMatchId} GO! (${Object.keys(waitingRoom).length} players)`);
    
    spawnIndex = 0;
    Object.keys(waitingRoom).forEach(id => {
        const w = waitingRoom[id];
        const spawn = getSpawnPosition();
        players[id] = {
            id: id,
            name: w.name,
            color: w.color,
            body: spawn.body,
            direction: spawn.direction,
            nextDirection: spawn.direction,
            alive: true,
            score: 0,
            ws: w.ws
        };
        if (w.ws && w.ws.readyState === 1) {
            w.ws.send(JSON.stringify({ type: 'init', id: id, gridSize: CONFIG.gridSize }));
        }
    });
    
    waitingRoom = {};
    gameState = 'PLAYING';
    turn = 0;
    timerSeconds = 0;
    matchTimeLeft = MATCH_DURATION;
}

function broadcastState() {
    const displayPlayers = Object.values(players).map(p => ({
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
        length: p.body.length
    }));
    
    const waitingPlayers = Object.values(waitingRoom).map(w => ({
        id: w.id, name: w.name, color: w.color, body: [], score: 0, alive: true, waiting: true
    }));
    
    const state = {
        matchId: currentMatchId,
        gridSize: CONFIG.gridSize,
        turn: turn,
        gameState: gameState,
        winner: winner,
        timeLeft: timerSeconds,
        matchTimeLeft: matchTimeLeft, // 3-minute countdown
        players: displayPlayers,
        waitingPlayers: waitingPlayers,
        food: food,
        victoryPause: victoryPauseTimer > 0,
        victoryPauseTime: Math.ceil(victoryPauseTimer / 8)
    };
    const msg = JSON.stringify({ type: 'update', state });
    wss.clients.forEach(c => { if(c.readyState === 1) c.send(msg); });
}

// Check if direction is opposite (180 degree turn)
function isOpposite(dir1, dir2) {
    return dir1.x === -dir2.x && dir1.y === -dir2.y;
}

// --- WebSocket ---
wss.on('connection', (ws) => {
    let playerId = null;
    
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            
            if (data.type === 'join') {
                const isHero = data.name && data.name.includes('HERO');
                
                if (gameState === 'COUNTDOWN') {
                    if (playerId && waitingRoom[playerId]) return;
                    
                    if (Object.keys(waitingRoom).length >= 10) {
                        if (isHero) {
                            const victim = Object.keys(waitingRoom).find(id => !waitingRoom[id].name.includes('HERO'));
                            if (victim) delete waitingRoom[victim];
                        } else return;
                    }
                    const id = Math.random().toString(36).substr(2, 5);
                    playerId = id;
                    waitingRoom[id] = {
                        id: id,
                        name: data.name || 'Bot',
                        color: getNextColor(),
                        ws: ws
                    };
                    ws.send(JSON.stringify({ type: 'queued', id: id }));
                    return;
                }
                if (gameState === 'PLAYING') return;
            }
            
            if (data.type === 'move' && playerId && players[playerId] && players[playerId].alive) {
                const p = players[playerId];
                const newDir = data.direction;
                
                // Prevent 180 degree turn (going backwards)
                if (!isOpposite(newDir, p.direction)) {
                    p.nextDirection = newDir;
                }
            }
        } catch(e){}
    });
    
    ws.on('close', () => {
        if (playerId) {
            if (players[playerId]) killPlayer(players[playerId], 'disconnect');
            if (waitingRoom[playerId]) delete waitingRoom[playerId];
        }
    });
});

app.get('/history', (req, res) => res.json(matchHistory));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on ${PORT}`));
