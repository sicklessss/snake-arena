const WebSocket = require('ws');
const http = require('http');

const AGENT_NAME = 'HERO-AI'; 
const SERVER_URL = process.argv[2] || 'ws://localhost:3000';
const CONTROL_PORT = parseInt(process.argv[3]) || 4000;

let ws = null;
let myId = null;
let gridSize = 30;
let nextOverrideDir = null;

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
        ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'init') {
                myId = msg.id;
                gridSize = msg.gridSize;
                console.log(`✅ Registered as ${myId}`);
            }
            if (msg.type === 'queued') {
                myId = msg.id;
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
            ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
        }
        return;
    }
    
    if (state.gameState !== 'PLAYING') return;
    
    const me = state.players.find(p => p.id === myId);
    if (!me || !me.alive) return;
    
    let move = null;
    
    // Check for override from HTTP controller
    if (nextOverrideDir) {
        move = nextOverrideDir;
        nextOverrideDir = null;
    } else {
        move = smartHunterStrategy(state, me);
    }
    
    if (move) {
        ws.send(JSON.stringify({ type: 'move', direction: move }));
    }
}

function smartHunterStrategy(state, me) {
    const head = me.body[0];
    const myLen = me.body.length;
    const border = state.shrinkBorder || 0;
    const safeMin = border;
    const safeMax = gridSize - border - 1;
    
    // Build detailed obstacle map
    const obstacles = new Set();
    const dangerZone = new Set(); // Places that might become dangerous
    
    // Border + warning zone
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            if (x < border || x > safeMax || y < border || y > safeMax) {
                obstacles.add(`${x},${y}`);
            }
            // Warning zone if shrink is coming
            if (state.shrinkWarning) {
                if (x <= border || x >= safeMax || y <= border || y >= safeMax) {
                    dangerZone.add(`${x},${y}`);
                }
            }
        }
    }
    
    // Dead snakes as obstacles
    state.players.forEach(p => {
        if (!p.alive && p.deathType !== 'eaten') {
            p.body.forEach(seg => obstacles.add(`${seg.x},${seg.y}`));
        }
    });
    
    // My body
    for (let i = 1; i < me.body.length; i++) {
        obstacles.add(`${me.body[i].x},${me.body[i].y}`);
    }
    
    // Predict enemy head positions
    const enemyHeadPredictions = new Set();
    state.players.forEach(p => {
        if (p.id === me.id || !p.alive) return;
        const pHead = p.body[0];
        // Add current head
        obstacles.add(`${pHead.x},${pHead.y}`);
        // Add predicted next positions
        for (const dir of DIRS) {
            const nx = pHead.x + dir.x;
            const ny = pHead.y + dir.y;
            if (p.body.length >= myLen) {
                enemyHeadPredictions.add(`${nx},${ny}`);
            }
        }
        // Add body
        for (let i = 1; i < p.body.length; i++) {
            obstacles.add(`${p.body[i].x},${p.body[i].y}`);
        }
    });
    
    // Find targets (shorter snakes)
    const targets = state.players.filter(p => 
        p.id !== me.id && p.alive && p.body.length < myLen
    );
    
    // Find threats (longer snakes)
    const threats = state.players.filter(p =>
        p.id !== me.id && p.alive && p.body.length > myLen
    );
    
    // A* pathfinding to target
    function findPath(start, goal, maxSteps = 50) {
        const openSet = [{ pos: start, g: 0, h: manhattan(start, goal), path: [] }];
        const closedSet = new Set();
        
        while (openSet.length > 0 && openSet.length < 500) {
            openSet.sort((a, b) => (a.g + a.h) - (b.g + b.h));
            const current = openSet.shift();
            
            if (current.pos.x === goal.x && current.pos.y === goal.y) {
                return current.path;
            }
            
            if (current.g > maxSteps) continue;
            
            const key = `${current.pos.x},${current.pos.y}`;
            if (closedSet.has(key)) continue;
            closedSet.add(key);
            
            for (const dir of DIRS) {
                const nx = current.pos.x + dir.x;
                const ny = current.pos.y + dir.y;
                const nKey = `${nx},${ny}`;
                
                if (closedSet.has(nKey)) continue;
                if (obstacles.has(nKey) && !(nx === goal.x && ny === goal.y)) continue;
                if (nx < safeMin || nx > safeMax || ny < safeMin || ny > safeMax) continue;
                
                openSet.push({
                    pos: { x: nx, y: ny },
                    g: current.g + 1,
                    h: manhattan({ x: nx, y: ny }, goal),
                    path: [...current.path, dir]
                });
            }
        }
        return null;
    }
    
    function manhattan(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    
    // Flood fill to count accessible space
    function floodFill(start) {
        const visited = new Set();
        const queue = [start];
        let count = 0;
        
        while (queue.length > 0 && count < 200) {
            const pos = queue.shift();
            const key = `${pos.x},${pos.y}`;
            if (visited.has(key)) continue;
            if (obstacles.has(key)) continue;
            if (pos.x < safeMin || pos.x > safeMax || 
                pos.y < safeMin || pos.y > safeMax) continue;
            
            visited.add(key);
            count++;
            
            for (const dir of DIRS) {
                queue.push({ x: pos.x + dir.x, y: pos.y + dir.y });
            }
        }
        return count;
    }
    
    // Evaluate moves
    const moves = [];
    
    for (const dir of DIRS) {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        const key = `${nx},${ny}`;
        
        // Basic safety check
        if (obstacles.has(key)) continue;
        if (nx < safeMin || nx > safeMax || ny < safeMin || ny > safeMax) continue;
        
        let score = 100;
        
        // Check collision with enemy
        let collision = null;
        state.players.forEach(p => {
            if (p.id === me.id || !p.alive) return;
            
            if (p.body[0].x === nx && p.body[0].y === ny) {
                collision = { type: 'head', player: p };
            }
            for (let i = 1; i < p.body.length; i++) {
                if (p.body[i].x === nx && p.body[i].y === ny) {
                    collision = { type: 'body', player: p, index: i };
                }
            }
        });
        
        if (collision) {
            const theirLen = collision.player.body.length;
            
            if (collision.type === 'head') {
                if (myLen > theirLen) {
                    // KILL!
                    score = 1000 + (myLen - theirLen) * 100;
                } else if (myLen === theirLen) {
                    score = -500; // Mutual death
                } else {
                    score = -1000; // We die
                }
            } else {
                if (myLen > theirLen) {
                    // Eat their tail
                    const eaten = collision.player.body.length - collision.index;
                    score = 600 + eaten * 50;
                } else {
                    score = -600;
                }
            }
        } else {
            // Safe move evaluation
            
            // Space evaluation (don't get trapped!)
            const space = floodFill({ x: nx, y: ny });
            if (space < myLen * 2) {
                score -= (myLen * 2 - space) * 20; // Heavily penalize tight spaces
            } else {
                score += Math.min(space, 100) * 2;
            }
            
            // Avoid predicted enemy head positions
            if (enemyHeadPredictions.has(key)) {
                score -= 100;
            }
            
            // Avoid danger zone
            if (dangerZone.has(key)) {
                score -= 200;
            }
            
            // Food seeking
            let closestFood = Infinity;
            state.food.forEach(f => {
                const dist = manhattan({ x: nx, y: ny }, f);
                if (dist < closestFood) closestFood = dist;
            });
            if (closestFood < Infinity) {
                score += (20 - Math.min(closestFood, 20)) * 5;
            }
            
            // HUNT MODE: Chase shorter snakes aggressively
            if (targets.length > 0) {
                let closestTarget = Infinity;
                let bestTarget = null;
                
                targets.forEach(t => {
                    const dist = manhattan({ x: nx, y: ny }, t.body[0]);
                    if (dist < closestTarget) {
                        closestTarget = dist;
                        bestTarget = t;
                    }
                });
                
                if (bestTarget) {
                    const sizeDiff = myLen - bestTarget.body.length;
                    // More aggressive the bigger we are
                    score += (15 - Math.min(closestTarget, 15)) * (10 + sizeDiff * 5);
                    
                    // If we can intercept, even better
                    const path = findPath({ x: nx, y: ny }, bestTarget.body[0], 15);
                    if (path && path.length < 10) {
                        score += (10 - path.length) * 20;
                    }
                }
            }
            
            // ESCAPE MODE: Run from longer snakes
            threats.forEach(t => {
                const dist = manhattan({ x: nx, y: ny }, t.body[0]);
                if (dist < 6) {
                    const sizeDiff = t.body.length - myLen;
                    score -= (6 - dist) * (15 + sizeDiff * 10);
                }
            });
            
            // Stay toward center
            const center = gridSize / 2;
            const distToCenter = Math.abs(nx - center) + Math.abs(ny - center);
            score -= distToCenter;
            
            // If shrink warning, strongly prefer center
            if (state.shrinkWarning) {
                score -= distToCenter * 10;
            }
        }
        
        moves.push({ dir, score, space: floodFill({ x: nx, y: ny }) });
    }
    
    if (moves.length === 0) {
        // Desperate - try any direction
        for (const dir of DIRS) {
            const nx = head.x + dir.x;
            const ny = head.y + dir.y;
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                return dir;
            }
        }
        return DIRS[0];
    }
    
    // Sort by score
    moves.sort((a, b) => b.score - a.score);
    
    // If top scores are close, prefer the one with more space
    if (moves.length > 1 && moves[0].score - moves[1].score < 50) {
        if (moves[1].space > moves[0].space * 1.5) {
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
                        res.end(JSON.stringify({ ok: true, direction: cmd.direction }));
                        return;
                    }
                }
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid command' }));
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
    console.log(`🎮 ${AGENT_NAME} v3 starting... HTTP control on port ${CONTROL_PORT}`);
});

connect();
