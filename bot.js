
const WebSocket = require('ws');

const SERVER_URL = 'ws://localhost:3000';
const BOT_NAME = process.argv[2] || 'Bot';

const ws = new WebSocket(SERVER_URL);

let myId = null;
let gridSize = 50;

ws.on('open', () => {
    console.log(`${BOT_NAME} connected!`);
    ws.send(JSON.stringify({ type: 'join', name: BOT_NAME }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'init') {
        myId = msg.id;
        gridSize = msg.gridSize;
        console.log(`Initialized as ID: ${myId}`);
    }

    if (msg.type === 'update') {
        const state = msg.state;
        const me = state.players.find(p => p.id === myId);

        if (!me) {
            // I am dead or not spawned yet
            return;
        }

        const move = decideMove(me, state);
        ws.send(JSON.stringify({ type: 'move', direction: move }));
    }
});

ws.on('close', () => {
    console.log(`${BOT_NAME} disconnected (Game Over?)`);
    process.exit(0);
});

// --- AI Logic ---
function decideMove(me, state) {
    const head = me.body[0];
    const food = findClosestFood(head, state.food);
    
    // Default: Keep moving current direction
    // But we need to calculate current direction based on head and neck
    // Since server handles direction persistence, we just need to send CHANGE if needed.
    // Let's just always calculate best move.

    // Simple Greedy Strategy:
    // 1. Move towards food
    // 2. Avoid walls
    // 3. Avoid self
    // 4. Avoid others

    const moves = [
        { x: 0, y: -1 }, // UP
        { x: 0, y: 1 },  // DOWN
        { x: -1, y: 0 }, // LEFT
        { x: 1, y: 0 }   // RIGHT
    ];

    // Filter out suicide moves
    const safeMoves = moves.filter(dir => isSafe(head, dir, state));

    if (safeMoves.length === 0) {
        // No safe moves, goodbye cruel world
        return moves[0]; 
    }

    // Pick move that gets closer to food
    if (food) {
        let bestMove = safeMoves[0];
        let minDist = Infinity;

        safeMoves.forEach(move => {
            const nextX = head.x + move.x;
            const nextY = head.y + move.y;
            const dist = Math.abs(nextX - food.x) + Math.abs(nextY - food.y);
            
            if (dist < minDist) {
                minDist = dist;
                bestMove = move;
            }
        });
        return bestMove;
    }

    // No food? Just wander safely
    return safeMoves[Math.floor(Math.random() * safeMoves.length)];
}

function findClosestFood(head, foodList) {
    if (!foodList || foodList.length === 0) return null;
    let closest = null;
    let min = Infinity;
    
    foodList.forEach(f => {
        const d = Math.abs(head.x - f.x) + Math.abs(head.y - f.y);
        if (d < min) {
            min = d;
            closest = f;
        }
    });
    return closest;
}

function isSafe(head, dir, state) {
    const nextX = head.x + dir.x;
    const nextY = head.y + dir.y;

    // Wall Check
    if (nextX < 0 || nextX >= gridSize || nextY < 0 || nextY >= gridSize) return false;

    // Obstacle Check (All snakes)
    // Note: This is simplified. Doesn't account for tails moving away (creating space).
    for (let p of state.players) {
        for (let part of p.body) {
            if (nextX === part.x && nextY === part.y) return false;
        }
    }

    return true;
}
