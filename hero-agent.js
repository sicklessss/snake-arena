const WebSocket = require('ws');
const http = require('http');

const AGENT_NAME = 'HERO-AI'; 
const SERVER_URL = process.argv[2] || 'ws://localhost:3000';
const CONTROL_PORT = parseInt(process.argv[3]) || 4000;

let ws = null;
let myId = null;
let gridSize = 30;
let nextOverrideDir = null;

// Chase tracking
let chaseTarget = null;
let chaseTurns = 0;
const MAX_CHASE_TURNS = 50;

const DIRS = [
    { x: 0, y: -1, name: 'up' },
    { x: 0, y: 1, name: 'down' },
    { x: -1, y: 0, name: 'left' },
    { x: 1, y: 0, name: 'right' }
];

function connect() {
    ws = new WebSocket(SERVER_URL);
    
    ws.on('open', () => {
        console.log(`🧠 ${AGENT_NAME} connecting...`);
        ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME, botType: 'hero' }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'init') {
                myId = msg.id;
                gridSize = msg.gridSize;
                chaseTarget = null;
                chaseTurns = 0;
                console.log(`✅ Game started as ${myId}`);
            }
            if (msg.type === 'queued') {
                myId = msg.id;
                chaseTarget = null;
                chaseTurns = 0;
                console.log(`⏳ Queued as ${myId}`);
            }
            if (msg.type === 'update') {
                handleUpdate(msg.state);
            }
        } catch(e) {}
    });

    ws.on('close', () => {
        myId = null;
        console.log('❌ Disconnected, reconnecting...');
        setTimeout(connect, 1000);
    });
    
    ws.on('error', () => {});
}

function handleUpdate(state) {
    if (state.gameState === 'COUNTDOWN') {
        const inWaiting = state.waitingPlayers?.some(p => p.id === myId);
        if (!inWaiting) {
            myId = null;
            ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME, botType: 'hero' }));
        }
        return;
    }
    
    if (state.gameState !== 'PLAYING') return;
    
    const me = state.players.find(p => p.id === myId);
    if (!me || !me.alive) return;
    
    let move = null;
    
    if (nextOverrideDir) {
        move = nextOverrideDir;
        nextOverrideDir = null;
    } else {
        move = heroStrategy(state, me);
    }
    
    if (move) {
        ws.send(JSON.stringify({ type: 'move', direction: move }));
    }
}

function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isOpposite(dir1, dir2) {
    return dir1.x === -dir2.x && dir1.y === -dir2.y;
}

function heroStrategy(state, me) {
    const head = me.body[0];
    const myLen = me.body.length;
    
    // Build obstacle map
    const obstacles = new Set();
    
    // Dead snakes
    state.players.forEach(p => {
        if (!p.alive && p.deathType !== 'eaten') {
            p.body.forEach(seg => obstacles.add(`${seg.x},${seg.y}`));
        }
    });
    
    // My body
    for (let i = 1; i < me.body.length; i++) {
        obstacles.add(`${me.body[i].x},${me.body[i].y}`);
    }
    
    // Enemy bodies and heads
    const enemyHeads = new Map();
    state.players.forEach(p => {
        if (p.id === me.id || !p.alive) return;
        enemyHeads.set(`${p.body[0].x},${p.body[0].y}`, p);
        p.body.forEach((seg, i) => {
            if (i > 0) obstacles.add(`${seg.x},${seg.y}`);
        });
    });
    
    // Predict enemy next positions
    const dangerZone = new Set();
    state.players.forEach(p => {
        if (p.id === me.id || !p.alive) return;
        if (p.body.length >= myLen) {
            const h = p.body[0];
            DIRS.forEach(d => {
                dangerZone.add(`${h.x + d.x},${h.y + d.y}`);
            });
        }
    });
    
    // Find threats and prey
    const threats = [];
    const prey = [];
    
    state.players.forEach(p => {
        if (p.id === me.id || !p.alive) return;
        const dist = manhattan(head, p.body[0]);
        if (p.body.length > myLen) {
            threats.push({ player: p, dist });
        } else if (p.body.length < myLen) {
            prey.push({ player: p, dist });
        }
    });
    
    threats.sort((a, b) => a.dist - b.dist);
    prey.sort((a, b) => a.dist - b.dist);
    
    const nearestThreat = threats[0];
    const nearestPrey = prey[0];
    
    // Flood fill for space evaluation
    function floodFill(start) {
        const visited = new Set();
        const queue = [start];
        let count = 0;
        
        while (queue.length > 0 && count < 150) {
            const pos = queue.shift();
            const key = `${pos.x},${pos.y}`;
            if (visited.has(key)) continue;
            if (obstacles.has(key)) continue;
            if (pos.x < 0 || pos.x >= gridSize || pos.y < 0 || pos.y >= gridSize) continue;
            
            visited.add(key);
            count++;
            
            for (const dir of DIRS) {
                queue.push({ x: pos.x + dir.x, y: pos.y + dir.y });
            }
        }
        return count;
    }
    
    // Determine mode
    let mode = 'food';
    
    if (nearestThreat && nearestThreat.dist < 4) {
        mode = 'flee';
    } else if (nearestPrey && nearestPrey.dist < 6 && myLen > nearestPrey.player.body.length + 2) {
        if (chaseTarget === nearestPrey.player.id) {
            chaseTurns++;
            if (chaseTurns > MAX_CHASE_TURNS) {
                mode = 'food';
                chaseTarget = null;
                chaseTurns = 0;
            } else {
                mode = 'hunt';
            }
        } else {
            chaseTarget = nearestPrey.player.id;
            chaseTurns = 0;
            mode = 'hunt';
        }
    } else {
        chaseTarget = null;
        chaseTurns = 0;
    }
    
    // Valid directions (no 180 turn)
    const validDirs = DIRS.filter(d => !isOpposite(d, me.direction));
    
    const moves = [];
    
    for (const dir of validDirs) {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        const key = `${nx},${ny}`;
        
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
        if (obstacles.has(key)) continue;
        
        let score = 100;
        
        // Check head collision
        const enemy = enemyHeads.get(key);
        if (enemy) {
            if (myLen > enemy.body.length + 2) {
                score = 600; // Safe kill
            } else if (myLen > enemy.body.length) {
                score = 100; // Risky kill
            } else if (myLen === enemy.body.length) {
                score = -800; // Mutual death - AVOID!
            } else {
                score = -1000; // We die
            }
        } else {
            // Space evaluation (critical!)
            const space = floodFill({ x: nx, y: ny });
            if (space < myLen * 1.5) {
                score -= (myLen * 1.5 - space) * 30;
            } else {
                score += Math.min(space, 80) * 2;
            }
            
            // Danger zone avoidance
            if (dangerZone.has(key)) {
                score -= 80;
            }
            
            // Future options
            let options = 0;
            for (const nd of DIRS) {
                const nnx = nx + nd.x;
                const nny = ny + nd.y;
                if (nnx >= 0 && nnx < gridSize && nny >= 0 && nny < gridSize) {
                    if (!obstacles.has(`${nnx},${nny}`)) options++;
                }
            }
            score += options * 15;
            
            // Mode-specific scoring
            if (mode === 'flee' && nearestThreat) {
                const threatHead = nearestThreat.player.body[0];
                const newDist = manhattan({ x: nx, y: ny }, threatHead);
                const oldDist = manhattan(head, threatHead);
                score += (newDist - oldDist) * 40;
                
                // Eat food while fleeing!
                state.food.forEach(f => {
                    const fd = manhattan({ x: nx, y: ny }, f);
                    if (fd <= 3) score += (4 - fd) * 30;
                });
            }
            else if (mode === 'hunt' && nearestPrey) {
                const preyHead = nearestPrey.player.body[0];
                const newDist = manhattan({ x: nx, y: ny }, preyHead);
                const oldDist = manhattan(head, preyHead);
                score += (oldDist - newDist) * 35;
                
                // Intercept prediction
                const pd = me.direction;
                const predictedPrey = {
                    x: preyHead.x + (pd.x || 0),
                    y: preyHead.y + (pd.y || 0)
                };
                const interceptDist = manhattan({ x: nx, y: ny }, predictedPrey);
                score += (10 - Math.min(interceptDist, 10)) * 10;
                
                // Still look for food
                state.food.forEach(f => {
                    const fd = manhattan({ x: nx, y: ny }, f);
                    if (fd <= 2) score += (3 - fd) * 20;
                });
            }
            else {
                // Food mode
                let closestFood = Infinity;
                state.food.forEach(f => {
                    const d = manhattan({ x: nx, y: ny }, f);
                    if (d < closestFood) closestFood = d;
                });
                if (closestFood < Infinity) {
                    score += (20 - Math.min(closestFood, 20)) * 12;
                }
                
                // Prefer center
                const center = gridSize / 2;
                const dc = Math.abs(nx - center) + Math.abs(ny - center);
                score -= dc * 2;
            }
        }
        
        moves.push({ dir, score, space: floodFill({ x: nx, y: ny }) });
    }
    
    if (moves.length === 0) {
        for (const dir of DIRS) {
            const nx = head.x + dir.x;
            const ny = head.y + dir.y;
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                return dir;
            }
        }
        return DIRS[0];
    }
    
    moves.sort((a, b) => b.score - a.score);
    
    // Prefer more space if scores are close
    if (moves.length > 1 && moves[0].score - moves[1].score < 30) {
        if (moves[1].space > moves[0].space * 1.3) {
            return moves[1].dir;
        }
    }
    
    return moves[0].dir;
}

// HTTP Control Server
const httpServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/command') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const cmd = JSON.parse(body);
                if (cmd.direction) {
                    const dir = DIRS.find(d => d.name === cmd.direction);
                    if (dir) {
                        nextOverrideDir = dir;
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }
                }
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid' }));
            } catch(e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200);
        res.end(JSON.stringify({ name: AGENT_NAME, id: myId, connected: ws?.readyState === 1 }));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

httpServer.listen(CONTROL_PORT, () => {
    console.log(`🎮 ${AGENT_NAME} v4 HTTP on port ${CONTROL_PORT}`);
});

connect();
