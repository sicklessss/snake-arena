
const http = require('http');

const AGENT_NAME = process.argv[2] || 'FastBot';
const BASE_URL = 'http://localhost:3000';

let myId = null;
let gridSize = 20;

// --- Networking Helper ---
function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            agent: new http.Agent({ keepAlive: true }) // Keep connection open for speed
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve({}); // Ignore parse errors
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

// --- Logic ---
async function run() {
    // 1. Join
    try {
        const joinRes = await request('POST', '/join', { name: AGENT_NAME });
        myId = joinRes.id;
        gridSize = joinRes.gridSize;
        console.log(`🚀 ${AGENT_NAME} joined as ${myId}`);
        
        gameLoop();
    } catch (e) {
        console.error("Connection failed", e.message);
    }
}

async function gameLoop() {
    while (true) {
        try {
            // 2. Get State
            const state = await request('GET', '/state');
            const me = state.players[myId];

            if (!me || !me.alive) {
                console.log(`💀 ${AGENT_NAME} died. Re-joining...`);
                // Simple respawn logic: wait and restart
                await new Promise(r => setTimeout(r, 1000));
                return run(); 
            }

            // 3. Think (The Brain)
            if (!me.hasMoved) {
                const move = decideMove(me, state);
                
                // 4. Act
                await request('POST', '/move', { id: myId, direction: move });
                // console.log(`Moved ${move.x},${move.y}`);
            } else {
                // Wait a tiny bit if we already moved this turn
                await new Promise(r => setTimeout(r, 10)); 
            }

        } catch (e) {
            // console.error("Error in loop", e.message);
            await new Promise(r => setTimeout(r, 100));
        }
    }
}

// --- Strategy (Same as before but HTTP optimized) ---
function decideMove(me, state) {
    const head = me.body[0];
    const food = findClosestFood(head, state.food);
    const moves = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];

    // Safety Filter
    const safeMoves = moves.filter(dir => isSafe(head, dir, state));

    if (safeMoves.length === 0) return moves[0]; // Panic

    // Food Seeking
    if (food) {
        let best = safeMoves[0];
        let min = Infinity;
        safeMoves.forEach(m => {
            const d = Math.abs((head.x+m.x) - food.x) + Math.abs((head.y+m.y) - food.y);
            if (d < min) { min = d; best = m; }
        });
        return best;
    }
    
    return safeMoves[Math.floor(Math.random() * safeMoves.length)];
}

function findClosestFood(head, foodList) {
    if (!foodList || foodList.length === 0) return null;
    let closest = null; let min = Infinity;
    foodList.forEach(f => {
        const d = Math.abs(head.x - f.x) + Math.abs(head.y - f.y);
        if (d < min) { min = d; closest = f; }
    });
    return closest;
}

function isSafe(head, dir, state) {
    const nx = head.x + dir.x;
    const ny = head.y + dir.y;
    if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) return false;
    
    // Collision with ANY snake body
    for (let id in state.players) {
        const p = state.players[id];
        if (!p.alive) continue;
        for (let part of p.body) {
            if (nx === part.x && ny === part.y) return false;
        }
    }
    return true;
}

run();
