const WebSocket = require('ws');

const BOT_NAME = process.argv[2] || 'AggroBot';
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
            if (msg.type === 'init') {
                myId = msg.id;
                gridSize = msg.gridSize;
            }
            if (msg.type === 'queued') {
                myId = msg.id;
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
    // During countdown, try to join
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
    
    const move = aggressiveStrategy(state, me);
    if (move) {
        ws.send(JSON.stringify({ type: 'move', direction: move }));
    }
}

function aggressiveStrategy(state, me) {
    const head = me.body[0];
    const myLen = me.body.length;
    const border = state.shrinkBorder || 0;
    
    // Build obstacle map
    const obstacles = new Set();
    
    // Border zones
    for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
            if (x < border || x >= gridSize - border || 
                y < border || y >= gridSize - border) {
                obstacles.add(`${x},${y}`);
            }
        }
    }
    
    // Dead snakes (except eaten ones)
    state.players.forEach(p => {
        if (!p.alive && p.deathType !== 'eaten') {
            p.body.forEach(seg => obstacles.add(`${seg.x},${seg.y}`));
        }
    });
    
    // My own body (except head)
    for (let i = 1; i < me.body.length; i++) {
        obstacles.add(`${me.body[i].x},${me.body[i].y}`);
    }
    
    // Evaluate each direction
    const moves = [];
    
    for (const dir of DIRS) {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        const key = `${nx},${ny}`;
        
        // Skip obstacles
        if (obstacles.has(key)) continue;
        
        // Skip out of bounds
        if (nx < border || nx >= gridSize - border || 
            ny < border || ny >= gridSize - border) continue;
        
        let score = 100;
        
        // Check what's at this position
        let collision = null;
        state.players.forEach(p => {
            if (p.id === me.id || !p.alive) return;
            
            // Head position
            if (p.body[0].x === nx && p.body[0].y === ny) {
                collision = { type: 'head', player: p, index: 0 };
            }
            
            // Body positions
            for (let i = 1; i < p.body.length; i++) {
                if (p.body[i].x === nx && p.body[i].y === ny) {
                    collision = { type: 'body', player: p, index: i };
                }
            }
        });
        
        if (collision) {
            const theirLen = collision.player.body.length;
            
            if (collision.type === 'head') {
                // Head-on collision
                if (myLen > theirLen) {
                    // We're longer - GO FOR THE KILL!
                    score = 500 + (myLen - theirLen) * 50;
                } else if (myLen === theirLen) {
                    // Equal length - avoid
                    score = -100;
                } else {
                    // They're longer - AVOID!
                    score = -500;
                }
            } else {
                // Body collision
                if (myLen > theirLen) {
                    // We can eat their tail!
                    const segmentsToEat = collision.player.body.length - collision.index;
                    score = 300 + segmentsToEat * 30;
                } else {
                    // We're shorter - we'll die
                    score = -300;
                }
            }
        } else {
            // Safe move - evaluate position quality
            
            // Prefer center (away from shrinking border)
            const center = gridSize / 2;
            const distToCenter = Math.abs(nx - center) + Math.abs(ny - center);
            score -= distToCenter * 2;
            
            // Look for nearby food
            state.food.forEach(f => {
                const dist = Math.abs(f.x - nx) + Math.abs(f.y - ny);
                if (dist < 5) score += (5 - dist) * 10;
            });
            
            // Hunt shorter snakes nearby
            state.players.forEach(p => {
                if (p.id === me.id || !p.alive) return;
                const pHead = p.body[0];
                const dist = Math.abs(pHead.x - nx) + Math.abs(pHead.y - ny);
                
                if (p.body.length < myLen) {
                    // Hunt them!
                    if (dist < 8) score += (8 - dist) * 15;
                } else if (p.body.length > myLen) {
                    // Avoid them
                    if (dist < 4) score -= (4 - dist) * 20;
                }
            });
            
            // Avoid getting trapped - check future options
            let futureOptions = 0;
            for (const nextDir of DIRS) {
                const nnx = nx + nextDir.x;
                const nny = ny + nextDir.y;
                if (!obstacles.has(`${nnx},${nny}`) && 
                    nnx >= border && nnx < gridSize - border &&
                    nny >= border && nny < gridSize - border) {
                    futureOptions++;
                }
            }
            score += futureOptions * 15;
            
            // If border is about to shrink, move toward center
            if (state.shrinkWarning) {
                score -= distToCenter * 5;
            }
        }
        
        moves.push({ dir, score });
    }
    
    if (moves.length === 0) return null;
    
    // Sort by score and pick best
    moves.sort((a, b) => b.score - a.score);
    return moves[0].dir;
}

connect();
