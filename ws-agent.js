
const WebSocket = require('ws');

const AGENT_NAME = process.argv[2] || 'WsBot';
const SERVER_URL = 'ws://localhost:3000'; // 走 WebSocket 通道

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

    // 2. 寻路 (本地计算)
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
