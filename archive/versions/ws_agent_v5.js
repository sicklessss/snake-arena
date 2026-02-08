const WebSocket = require('ws');

const BOT_NAME = process.argv[2] || 'SmartBot';
const SERVER_URL = process.argv[3] || 'ws://localhost:3000';

let ws = null;
let myId = null;
let gridSize = 30;

const DIRS = [
    { x: 0, y: -1, name: 'up' },
    { x: 0, y: 1, name: 'down' },
    { x: -1, y: 0, name: 'left' },
    { x: 1, y: 0, name: 'right' }
];

function connect() {
    ws = new WebSocket(SERVER_URL);
    
    ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'join', name: BOT_NAME }));
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.type === 'init' || msg.type === 'queued') {
                myId = msg.id;
                gridSize = msg.gridSize || 30;
            }
            if (msg.type === 'update') {
                handleUpdate(msg.state);
            }
        } catch(e) {}
    });

    ws.on('close', () => {
        myId = null;
        setTimeout(connect, 1000);
    });
    ws.on('error', () => {});
}

function handleUpdate(state) {
    if (state.gameState === 'COUNTDOWN') {
        const inWaiting = state.waitingPlayers?.some(p => p.id === myId);
        if (!inWaiting) {
            myId = null;
            ws.send(JSON.stringify({ type: 'join', name: BOT_NAME }));
        }
        return;
    }
    
    if (state.gameState !== 'PLAYING') return;
    
    const me = state.players.find(p => p.id === myId);
    if (!me || !me.alive) return;
    
    const move = smartStrategy(state, me);
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

function smartStrategy(state, me) {
    const head = me.body[0];
    const myLen = me.body.length;
    const myDir = me.direction;
    
    // Build obstacle map
    const obstacles = new Set();
    
    // Dead snakes (except eaten type)
    state.players.forEach(p => {
        if (!p.alive && p.deathType !== 'eaten') {
            p.body.forEach(seg => obstacles.add(`${seg.x},${seg.y}`));
        }
    });
    
    // My body (except tail which will move)
    for (let i = 1; i < me.body.length - 1; i++) {
        obstacles.add(`${me.body[i].x},${me.body[i].y}`);
    }
    
    // Enemy info
    const enemies = state.players.filter(p => p.id !== me.id && p.alive);
    
    // Enemy bodies (except tails)
    enemies.forEach(p => {
        for (let i = 1; i < p.body.length - 1; i++) {
            obstacles.add(`${p.body[i].x},${p.body[i].y}`);
        }
    });
    
    // Predict enemy head positions
    const enemyNextHeads = new Map(); // key -> enemy
    enemies.forEach(p => {
        const h = p.body[0];
        DIRS.forEach(d => {
            const nx = h.x + d.x;
            const ny = h.y + d.y;
            const key = `${nx},${ny}`;
            if (!enemyNextHeads.has(key)) {
                enemyNextHeads.set(key, []);
            }
            enemyNextHeads.get(key).push(p);
        });
    });
    
    // Get valid directions (no 180 turn)
    const validDirs = DIRS.filter(d => !isOpposite(d, myDir));
    
    const moves = [];
    
    for (const dir of validDirs) {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        const key = `${nx},${ny}`;
        
        // Wall check
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
        
        // Obstacle check
        if (obstacles.has(key)) continue;
        
        let score = 100;
        let killOpportunity = false;
        
        // Check enemy head collision
        const enemyHead = enemies.find(p => p.body[0].x === nx && p.body[0].y === ny);
        if (enemyHead) {
            const theirLen = enemyHead.body.length;
            if (myLen > theirLen) {
                score = 800; // KILL!
                killOpportunity = true;
            } else if (myLen === theirLen) {
                score = -1000; // Both die - AVOID!
            } else {
                score = -800; // We die
            }
        }
        
        // Check if enemy might move here (head collision risk)
        if (!killOpportunity && enemyNextHeads.has(key)) {
            const potentialColliders = enemyNextHeads.get(key);
            let dominated = true;
            for (const enemy of potentialColliders) {
                if (enemy.body.length >= myLen) {
                    dominated = false;
                    break;
                }
            }
            if (!dominated) {
                score -= 150; // Risk of collision with equal/longer snake
            }
        }
        
        // Check if we can attack enemy body (longer snake eats shorter)
        enemies.forEach(p => {
            for (let i = 1; i < p.body.length; i++) {
                if (p.body[i].x === nx && p.body[i].y === ny) {
                    if (myLen > p.body.length) {
                        // We can eat their tail!
                        const toEat = p.body.length - i;
                        score += 200 + toEat * 50;
                        killOpportunity = true;
                    } else {
                        // We die
                        score = -500;
                    }
                }
            }
        });
        
        // ** AGGRESSION: Check if enemy is adjacent and we're longer **
        if (!killOpportunity) {
            enemies.forEach(p => {
                if (p.body.length >= myLen) return; // Only attack shorter
                
                const enemyHead = p.body[0];
                
                // Check if turning would hit their body
                for (let i = 1; i < p.body.length; i++) {
                    const seg = p.body[i];
                    if (seg.x === nx && seg.y === ny) {
                        const toEat = p.body.length - i;
                        score += 300 + toEat * 40; // Aggressive attack!
                    }
                }
                
                // Check if we're parallel and can cut them off
                const dist = manhattan({x: nx, y: ny}, enemyHead);
                if (dist === 1 && myLen > p.body.length) {
                    score += 150; // Good position to attack
                }
            });
        }
        
        // Future options (survival)
        let futureOptions = 0;
        for (const nd of DIRS) {
            const nnx = nx + nd.x;
            const nny = ny + nd.y;
            if (nnx >= 0 && nnx < gridSize && nny >= 0 && nny < gridSize) {
                if (!obstacles.has(`${nnx},${nny}`)) {
                    futureOptions++;
                }
            }
        }
        if (futureOptions === 0) score -= 300;
        else if (futureOptions === 1) score -= 100;
        else score += futureOptions * 15;
        
        // Food seeking
        let closestFood = Infinity;
        (state.food || []).forEach(f => {
            const d = manhattan({x: nx, y: ny}, f);
            if (d < closestFood) closestFood = d;
        });
        if (closestFood < Infinity) {
            score += (12 - Math.min(closestFood, 12)) * 8;
        }
        
        // Slight center preference
        const center = gridSize / 2;
        const distToCenter = Math.abs(nx - center) + Math.abs(ny - center);
        score -= distToCenter * 0.5;
        
        moves.push({ dir, score });
    }
    
    if (moves.length === 0) {
        // Emergency: any direction
        for (const d of DIRS) {
            const nx = head.x + d.x;
            const ny = head.y + d.y;
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                return d;
            }
        }
        return DIRS[0];
    }
    
    moves.sort((a, b) => b.score - a.score);
    return moves[0].dir;
}

connect();
