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
let players = {}; 
let food = [];
let turn = 0;
const MAX_FOOD = 5;
const DEATH_BLINK_TURNS = 24; // ~3 seconds at 125ms tick
const SHRINK_INTERVAL = 160; // 20 seconds at 125ms tick
const SHRINK_WARNING = 16;   // 2 seconds warning before shrink

// --- Shrinking Border ---
let shrinkBorder = 0;  // How many cells from edge are deadly
let shrinkWarning = false; // Is border about to shrink?

// --- Waiting Room ---
let waitingRoom = {};

// --- Spawn Points (will be adjusted based on border) ---
function getSpawnPoints() {
    const margin = shrinkBorder + 3;
    const max = CONFIG.gridSize - margin - 1;
    return [
        { x: margin, y: margin, dir: {x:1, y:0} },
        { x: max, y: margin, dir: {x:-1, y:0} },
        { x: margin, y: max, dir: {x:1, y:0} },
        { x: max, y: max, dir: {x:-1, y:0} },
        { x: Math.floor(CONFIG.gridSize/2), y: margin, dir: {x:0, y:1} },
        { x: Math.floor(CONFIG.gridSize/2), y: max, dir: {x:0, y:-1} },
        { x: margin, y: Math.floor(CONFIG.gridSize/2), dir: {x:1, y:0} },
        { x: max, y: Math.floor(CONFIG.gridSize/2), dir: {x:-1, y:0} },
        { x: margin + 5, y: margin + 5, dir: {x:1, y:0} },
        { x: max - 5, y: max - 5, dir: {x:-1, y:0} },
    ];
}
let spawnIndex = 0;

function getSpawnPosition() {
    const points = getSpawnPoints();
    const spawn = points[spawnIndex % points.length];
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

// Main Loop (125ms)
setInterval(() => {
    if (gameState === 'PLAYING') {
        tick();
    } else {
        broadcastState(); 
    }
}, 125);

// 1s Timer Loop
setInterval(() => {
    if (gameState !== 'PLAYING') {
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

function isInBorder(x, y) {
    return x < shrinkBorder || x >= CONFIG.gridSize - shrinkBorder ||
           y < shrinkBorder || y >= CONFIG.gridSize - shrinkBorder;
}

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
    
    // --- Shrinking Border Logic ---
    const shrinkCycle = turn % SHRINK_INTERVAL;
    shrinkWarning = (shrinkCycle >= SHRINK_INTERVAL - SHRINK_WARNING);
    
    if (shrinkCycle === 0 && turn > 0) {
        // Time to shrink!
        const maxShrink = Math.floor(CONFIG.gridSize / 2) - 3;
        if (shrinkBorder < maxShrink) {
            shrinkBorder++;
            console.log(`🔥 Border shrinks! Now ${shrinkBorder} cells from edge are deadly`);
            
            // Kill anyone in the new border zone
            Object.values(players).forEach(p => {
                if (!p.alive) return;
                const head = p.body[0];
                if (isInBorder(head.x, head.y)) {
                    killPlayer(p, 'border');
                }
            });
        }
    }
    
    // Spawn food (only in safe zone)
    while (food.length < MAX_FOOD) {
        let fx, fy, attempts = 0;
        do {
            fx = shrinkBorder + Math.floor(Math.random() * (CONFIG.gridSize - 2 * shrinkBorder));
            fy = shrinkBorder + Math.floor(Math.random() * (CONFIG.gridSize - 2 * shrinkBorder));
            attempts++;
        } while (attempts < 50 && isInBorder(fx, fy));
        food.push({ x: fx, y: fy });
    }
    
    // Store new heads for collision detection
    const newHeads = {};
    
    // Move players
    Object.values(players).forEach(p => {
        if (!p.alive) return;
        
        p.direction = p.nextDirection;
        const head = p.body[0];
        const newHead = {
            x: head.x + p.direction.x,
            y: head.y + p.direction.y
        };
        
        // Border/Wall collision
        if (isInBorder(newHead.x, newHead.y)) {
            killPlayer(p, 'border');
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
        newHeads[p.id] = newHead;
    });
    
    // --- Collision Detection with New Rules ---
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
        
        // Collision with dead snakes (obstacles)
        Object.values(players).forEach(other => {
            if (other.id === p.id || other.alive) return;
            if (other.deathType === 'eaten') return; // Eaten snakes are not obstacles
            
            for (const seg of other.body) {
                if (seg.x === head.x && seg.y === head.y) {
                    killPlayer(p, 'corpse');
                    return;
                }
            }
        });
    });
    
    // --- Snake vs Snake Collision (New Rules) ---
    const alivePlayers = Object.values(players).filter(p => p.alive);
    const processed = new Set();
    
    for (const p of alivePlayers) {
        if (!p.alive || processed.has(p.id)) continue;
        const pHead = p.body[0];
        
        for (const other of alivePlayers) {
            if (other.id === p.id || !other.alive || processed.has(other.id)) continue;
            const oHead = other.body[0];
            
            // Head-on collision?
            if (pHead.x === oHead.x && pHead.y === oHead.y) {
                // Longer snake wins, equal = both die
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
            
            // P's head hits Other's body?
            for (let i = 1; i < other.body.length; i++) {
                if (other.body[i].x === pHead.x && other.body[i].y === pHead.y) {
                    if (p.body.length > other.body.length) {
                        // P eats part of Other's tail
                        const eaten = other.body.length - i;
                        other.body = other.body.slice(0, i);
                        // P grows by eaten amount
                        const tail = p.body[p.body.length - 1];
                        for (let j = 0; j < eaten; j++) {
                            p.body.push({ ...tail });
                        }
                        p.score += eaten;
                        console.log(`🍴 ${p.name} ate ${eaten} segments from ${other.name}`);
                        // If other is now too short, they die
                        if (other.body.length < 1) {
                            killPlayer(other, 'eaten');
                            processed.add(other.id);
                        }
                    } else {
                        // P dies (shorter or equal, hit body)
                        killPlayer(p, 'collision');
                        processed.add(p.id);
                    }
                    break;
                }
            }
            
            // Other's head hits P's body?
            if (!p.alive || processed.has(p.id)) continue;
            for (let i = 1; i < p.body.length; i++) {
                if (p.body[i].x === oHead.x && p.body[i].y === oHead.y) {
                    if (other.body.length > p.body.length) {
                        // Other eats part of P's tail
                        const eaten = p.body.length - i;
                        p.body = p.body.slice(0, i);
                        const tail = other.body[other.body.length - 1];
                        for (let j = 0; j < eaten; j++) {
                            other.body.push({ ...tail });
                        }
                        other.score += eaten;
                        console.log(`🍴 ${other.name} ate ${eaten} segments from ${p.name}`);
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
    
    // Win condition
    let aliveCount = 0;
    let lastSurvivor = null;
    Object.values(players).forEach(p => {
        if (p.alive) { aliveCount++; lastSurvivor = p; }
    });
    
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers > 1 && aliveCount === 1) {
        victoryPauseTimer = 24;
        lastSurvivorForVictory = lastSurvivor;
        console.log(`🎯 Last snake standing: ${lastSurvivor.name} - 3s victory pause...`);
    } else if (totalPlayers > 1 && aliveCount === 0) {
        startGameOver(null);
    }

    broadcastState();
}

function killPlayer(p, deathType = 'default') {
    p.alive = false;
    p.deathTimer = DEATH_BLINK_TURNS;
    p.deathTime = Date.now();
    p.deathType = deathType;
    
    // If eaten (head collision loss), only keep head as marker, not obstacle
    if (deathType === 'eaten') {
        p.body = [p.body[0]]; // Only head remains as blinking dot
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
    shrinkBorder = 0;
    shrinkWarning = false;
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
    shrinkBorder = 0;
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
        players: displayPlayers,
        waitingPlayers: waitingPlayers,
        food: food,
        victoryPause: victoryPauseTimer > 0,
        victoryPauseTime: Math.ceil(victoryPauseTimer / 8),
        shrinkBorder: shrinkBorder,
        shrinkWarning: shrinkWarning,
        nextShrinkIn: SHRINK_INTERVAL - (turn % SHRINK_INTERVAL)
    };
    const msg = JSON.stringify({ type: 'update', state });
    wss.clients.forEach(c => { if(c.readyState === 1) c.send(msg); });
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
                        color: `hsl(${Math.random()*360}, 100%, 50%)`,
                        ws: ws
                    };
                    ws.send(JSON.stringify({ type: 'queued', id: id }));
                    return;
                }
                if (gameState === 'PLAYING') return;
            }
            
            if (data.type === 'move' && playerId && players[playerId] && players[playerId].alive) {
                players[playerId].nextDirection = data.direction;
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
