
const WebSocket = require('ws');
const http = require('http');

const AGENT_NAME = 'HERO-AI'; 
const SERVER_URL = 'ws://localhost:3000';
const CONTROL_PORT = 3001;

const ws = new WebSocket(SERVER_URL);

let myId = null;
let gridSize = 30;
let nextOverrideDir = null; 

ws.on('open', () => {
    console.log(`🧠 ${AGENT_NAME} (A*) connecting...`);
    ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);
        if (msg.type === 'init') {
            myId = msg.id;
            gridSize = msg.gridSize;
        }
        if (msg.type === 'update') {
            const state = msg.state;
            const me = state.players.find(p => p.id === myId);

            if (me) {
                let move = null;
                // 优先执行人类/云端指令
                if (nextOverrideDir) {
                    move = nextOverrideDir;
                    nextOverrideDir = null;
                } else {
                    // 否则执行本地 A* 高级智力
                    move = aStarStrategy(me, state);
                }
                ws.send(JSON.stringify({ type: 'move', direction: move }));
            } else {
                if (Math.random() < 0.1) ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
            }
        }
    } catch (e) { console.error(e); }
});

// --- HTTP Control ---
http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/command') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const d = JSON.parse(body);
                if (d.direction) nextOverrideDir = d.direction;
                res.end('ok');
            } catch(e) { res.end('err'); }
        });
    } else res.end();
}).listen(CONTROL_PORT);

// --- A* Pathfinding Strategy ---
function aStarStrategy(me, state) {
    const head = me.body[0];
    const food = findClosestFood(head, state.food);
    const obstacles = getObstacles(state, gridSize);

    // 1. 如果有食物，尝试用 A* 找最短路径
    if (food) {
        const path = findPath(head, food, obstacles, gridSize);
        if (path && path.length > 0) {
            // Path[0] 是起点，Path[1] 是第一步
            const nextStep = path[1]; 
            return { x: nextStep.x - head.x, y: nextStep.y - head.y };
        }
    }

    // 2. 如果找不到路（可能被围住了），使用生存模式（填空隙/最长生存时间）
    // 这里简化为：找一个最空旷的安全方向
    return survivalMode(head, obstacles);
}

// 简单的 BFS/A* 实现
function findPath(start, end, obstacles, size) {
    let openSet = [start];
    let cameFrom = {};
    let gScore = {}; // Cost from start
    let fScore = {}; // Estimated cost to end

    const key = p => `${p.x},${p.y}`;
    
    gScore[key(start)] = 0;
    fScore[key(start)] = heuristic(start, end);

    while (openSet.length > 0) {
        // Find node with lowest fScore
        let current = openSet.reduce((a, b) => (fScore[key(a)] < fScore[key(b)] ? a : b));

        if (current.x === end.x && current.y === end.y) {
            return reconstructPath(cameFrom, current);
        }

        openSet = openSet.filter(n => n !== current);
        const currentKey = key(current);

        const neighbors = [
            {x: current.x, y: current.y - 1},
            {x: current.x, y: current.y + 1},
            {x: current.x - 1, y: current.y},
            {x: current.x + 1, y: current.y}
        ].filter(n => 
            n.x >= 0 && n.x < size && n.y >= 0 && n.y < size && 
            !obstacles.has(key(n))
        );

        for (let neighbor of neighbors) {
            let tentativeGScore = gScore[currentKey] + 1;
            let nKey = key(neighbor);

            if (tentativeGScore < (gScore[nKey] || Infinity)) {
                cameFrom[nKey] = current;
                gScore[nKey] = tentativeGScore;
                fScore[nKey] = gScore[nKey] + heuristic(neighbor, end);
                if (!openSet.some(n => n.x === neighbor.x && n.y === neighbor.y)) {
                    openSet.push(neighbor);
                }
            }
        }
    }
    return null; // No path found
}

function reconstructPath(cameFrom, current) {
    const totalPath = [current];
    const key = p => `${p.x},${p.y}`;
    while (key(current) in cameFrom) {
        current = cameFrom[key(current)];
        totalPath.unshift(current);
    }
    return totalPath;
}

function heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getObstacles(state, size) {
    const obs = new Set();
    state.players.forEach(p => {
        p.body.forEach(b => obs.add(`${b.x},${b.y}`));
    });
    return obs;
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

function survivalMode(head, obstacles) {
    const moves = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
    // Filter moves that don't hit obstacles immediately
    const safeMoves = moves.filter(dir => {
        const nx = head.x + dir.x;
        const ny = head.y + dir.y;
        return nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize && !obstacles.has(`${nx},${ny}`);
    });
    
    if (safeMoves.length === 0) return {x:0, y:-1}; // Die
    return safeMoves[Math.floor(Math.random() * safeMoves.length)];
}
