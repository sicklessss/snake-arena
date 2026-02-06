
const WebSocket = require('ws');

// Usage: node ws-agent.js <Name> <ServerURL>
const AGENT_NAME = process.argv[2] || 'WsBot';
const SERVER_URL = process.argv[3] || 'ws://localhost:3000'; 

const ws = new WebSocket(SERVER_URL);

let myId = null;
let gridSize = 30;

ws.on('open', () => {
    console.log(`🔌 ${AGENT_NAME} connected via WebSocket!`);
    // 注册自己
    ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data);

        // 1. 初始化信息
        if (msg.type === 'init') {
            myId = msg.id;
            gridSize = msg.gridSize;
            console.log(`✅ Registered as ID: ${myId}`);
        }

        // 2. 收到服务器的主动推送 (Server Push)
        if (msg.type === 'update') {
            const state = msg.state;
            const me = state.players.find(p => p.id === myId);

            // 如果我还活着，就在本地计算下一步
            if (me) {
                const move = decideMove(me, state);
                // 发送指令给服务器
                ws.send(JSON.stringify({ type: 'move', direction: move }));
            } else {
                // 我死了，尝试重新加入（简单的复活逻辑）
                if (Math.random() < 0.05) { // 偶尔尝试重连，别太频繁
                    ws.send(JSON.stringify({ type: 'join', name: AGENT_NAME }));
                }
            }
        }
    } catch (e) {
        console.error("Error processing message:", e);
    }
});

ws.on('close', () => {
    console.log(`❌ Disconnected.`);
    process.exit(0);
});

ws.on('error', (err) => {
    console.log(`❌ Connection error: ${err.message}`);
});

// --- 本地计算逻辑 (完全在本地运行，不消耗服务器算力) ---
function decideMove(me, state) {
    const head = me.body[0];
    const food = findClosestFood(head, state.food);
    const moves = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];

    // 1. 避障 (本地计算)
    const safeMoves = moves.filter(dir => isSafe(head, dir, state));

    if (safeMoves.length === 0) return moves[0]; // 必死无疑

    // 2. 寻路 (BFS - 简单路径搜索)
    if (food) {
        const path = bfs(head, food, state);
        if (path) return path;
    }
    
    // 3. 如果没路了，或者找不到食物，随机游走但尽量不死
    return safeMoves[Math.floor(Math.random() * safeMoves.length)];
}

// 简单的 BFS 寻路
function bfs(start, end, state) {
    let queue = [{ x: start.x, y: start.y, path: [] }];
    let visited = new Set();
    visited.add(`${start.x},${start.y}`);
    
    // 构建障碍物 Set
    let obstacles = new Set();
    state.players.forEach(p => p.body.forEach(b => obstacles.add(`${b.x},${b.y}`)));

    while (queue.length > 0) {
        let curr = queue.shift();
        
        // 限制搜索深度以节省 CPU (只看未来 20 步)
        if (curr.path.length > 20) continue;

        if (curr.x === end.x && curr.y === end.y) {
            return curr.path[0]; // 返回第一步
        }

        const moves = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
        for (let m of moves) {
            let nx = curr.x + m.x;
            let ny = curr.y + m.y;
            let key = `${nx},${ny}`;

            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize && 
                !obstacles.has(key) && !visited.has(key)) {
                visited.add(key);
                queue.push({ x: nx, y: ny, path: [...curr.path, m] });
            }
        }
    }
    return null;
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
    // 检查撞墙
    if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) return false;
    
    // 检查撞人 (遍历本地收到的数据)
    for (let p of state.players) {
        for (let part of p.body) {
            if (nx === part.x && ny === part.y) return false;
        }
    }
    return true;
}
