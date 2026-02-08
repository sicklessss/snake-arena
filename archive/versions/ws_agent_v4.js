const WebSocket = require('ws');

const BOT_NAME = process.argv[2] || 'SmartBot';
const SERVER_URL = process.argv[3] || 'ws://localhost:3000';

let ws = null;
let myId = null;
let gridSize = 30;

// Track chase state
let chaseTarget = null;
let chaseTurns = 0;
const MAX_CHASE_TURNS = 40; // Give up after ~5 seconds

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
            if (msg.type === 'init') {
                myId = msg.id;
                gridSize = msg.gridSize;
                chaseTarget = null;
                chaseTurns = 0;
            }
            if (msg.type === 'queued') {
                myId = msg.id;
                chaseTarget = null;
                chaseTurns = 0;
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
    
    // Build obstacle map
    const obstacles = new Set();
    
    // Walls
    for (let i = -1; i <= gridSize; i++) {
        obstacles.add(`${-1},${i}`);
        obstacles.add(`${gridSize},${i}`);
        obstacles.add(`${i},${-1}`);
        obstacles.add(`${i},${gridSize}`);
    }
    
    // Dead snakes (except eaten)
    state.players.forEach(p => {
        if (!p.alive && p.deathType !== 'eaten') {
            p.body.forEach(seg => obstacles.add(`${seg.x},${seg.y}`));
        }
    });
    
    // My body
    for (let i = 1; i < me.body.length; i++) {
        obstacles.add(`${me.body[i].x},${me.body[i].y}`);
    }
    
    // Other snakes' bodies
    state.players.forEach(p => {
        if (p.id === me.id || !p.alive) return;
        p.body.forEach((seg, i) => {
            if (i > 0) obstacles.add(`${seg.x},${seg.y}`);
        });
    });
    
    // Find threats (longer snakes) and prey (shorter snakes)
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
    
    // Sort by distance
    threats.sort((a, b) => a.dist - b.dist);
    prey.sort((a, b) => a.dist - b.dist);
    
    // Determine mode
    const nearestThreat = threats[0];
    const nearestPrey = prey[0];
    
    let mode = 'food'; // Default: seek food
    
    // Check if being chased by a threat
    if (nearestThreat && nearestThreat.dist < 4) {
        mode = 'flee';
    }
    // Only hunt if we're significantly longer (safer)
    else if (nearestPrey && nearestPrey.dist < 6 && myLen > nearestPrey.player.body.length + 2) {
        // Check chase timeout
        if (chaseTarget === nearestPrey.player.id) {
            chaseTurns++;
            if (chaseTurns > MAX_CHASE_TURNS) {
                // Give up chase, go for food instead
                mode = 'food';
                chaseTarget = null;
                chaseTurns = 0;
            } else {
                mode = 'hunt';
            }
        } else {
            // New target
            chaseTarget = nearestPrey.player.id;
            chaseTurns = 0;
            mode = 'hunt';
        }
    } else {
        chaseTarget = null;
        chaseTurns = 0;
    }
    
    // Get valid moves (not opposite to current direction)
    const validDirs = DIRS.filter(d => !isOpposite(d, me.direction));
    
    // Evaluate each direction
    const moves = [];
    
    for (const dir of validDirs) {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        const key = `${nx},${ny}`;
        
        // Skip walls
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
        
        // Skip obstacles
        if (obstacles.has(key)) continue;
        
        let score = 50;
        
        // Check collision with enemy heads
        let hitEnemy = null;
        state.players.forEach(p => {
            if (p.id === me.id || !p.alive) return;
            if (p.body[0].x === nx && p.body[0].y === ny) {
                hitEnemy = p;
            }
        });
        
        if (hitEnemy) {
            if (myLen > hitEnemy.body.length + 1) {
                score = 300; // Safe kill (we're much longer)
            } else if (myLen > hitEnemy.body.length) {
                score = 50; // Risky kill (barely longer)
            } else if (myLen === hitEnemy.body.length) {
                score = -800; // Mutual death - avoid!
            } else {
                score = -500; // We die
            }
        }
        
        // Count future options (CRITICAL - avoid getting trapped!)
        let futureOptions = 0;
        for (const nextDir of DIRS) {
            const nnx = nx + nextDir.x;
            const nny = ny + nextDir.y;
            if (nnx >= 0 && nnx < gridSize && nny >= 0 && nny < gridSize) {
                if (!obstacles.has(`${nnx},${nny}`)) {
                    futureOptions++;
                }
            }
        }
        // Heavily penalize moves with few escape routes
        if (futureOptions === 0) {
            score -= 500; // Dead end!
        } else if (futureOptions === 1) {
            score -= 200; // Only one way out
        } else {
            score += futureOptions * 25;
        }
        
        // Mode-specific scoring
        if (mode === 'flee' && nearestThreat) {
            // Move away from threat
            const threatHead = nearestThreat.player.body[0];
            const currentDist = manhattan(head, threatHead);
            const newDist = manhattan({ x: nx, y: ny }, threatHead);
            score += (newDist - currentDist) * 30;
            
            // BUT ALSO look for food while fleeing!
            state.food.forEach(f => {
                const foodDist = manhattan({ x: nx, y: ny }, f);
                if (foodDist <= 3) {
                    score += (4 - foodDist) * 25; // Bonus for nearby food while fleeing
                }
            });
        }
        else if (mode === 'hunt' && nearestPrey) {
            // Move toward prey
            const preyHead = nearestPrey.player.body[0];
            const currentDist = manhattan(head, preyHead);
            const newDist = manhattan({ x: nx, y: ny }, preyHead);
            score += (currentDist - newDist) * 25;
            
            // Also consider food along the way
            state.food.forEach(f => {
                const foodDist = manhattan({ x: nx, y: ny }, f);
                if (foodDist <= 2) {
                    score += (3 - foodDist) * 15;
                }
            });
        }
        else {
            // Food mode - prioritize eating
            let closestFood = Infinity;
            state.food.forEach(f => {
                const dist = manhattan({ x: nx, y: ny }, f);
                if (dist < closestFood) closestFood = dist;
            });
            if (closestFood < Infinity) {
                score += (15 - Math.min(closestFood, 15)) * 10;
            }
            
            // Stay somewhat central
            const center = gridSize / 2;
            const distToCenter = Math.abs(nx - center) + Math.abs(ny - center);
            score -= distToCenter;
        }
        
        moves.push({ dir, score });
    }
    
    if (moves.length === 0) {
        // No valid moves, try any direction
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
    return moves[0].dir;
}

connect();
