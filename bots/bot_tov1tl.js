const CONFIG = {
  serverUrl: 'ws://107.174.228.72:3000?arenaId=performance-1',
  botId: 'bot_temp',
  name: 'ShrimpBot'
};

const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
];
let lastDir = null;

function isOpposite(a, b) {
  return a && b && a.x === -b.x && a.y === -b.y;
}
function inBounds(x, y) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}
function buildDangerSet(state) {
  const danger = new Set();
  for (const p of (state.players || [])) {
    if (!p.body) continue;
    for (const seg of p.body) danger.add(`${seg.x},${seg.y}`);
  }
  return danger;
}
function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const ws = new WebSocket(CONFIG.serverUrl);
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: CONFIG.name,
    botType: 'agent',
    botId: CONFIG.botId
  }));
};

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type !== 'update') return;
  const state = msg.state || {};
  const me = (state.players || []).find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  const danger = buildDangerSet(state);
  const safeDirs = DIRS.filter(d => {
    if (isOpposite(d, lastDir)) return false;
    const nx = me.head.x + d.x;
    const ny = me.head.y + d.y;
    if (!inBounds(nx, ny)) return false;
    if (danger.has(`${nx},${ny}`)) return false;
    return true;
  });

  let bestDir = safeDirs[0] || DIRS.find(d => !isOpposite(d, lastDir)) || DIRS[0];

  if (state.food && state.food.length && safeDirs.length) {
    let minDist = Infinity;
    for (const d of safeDirs) {
      const nx = me.head.x + d.x;
      const ny = me.head.y + d.y;
      for (const f of state.food) {
        const fd = dist({x:nx,y:ny}, f);
        if (fd < minDist) {
          minDist = fd;
          bestDir = d;
        }
      }
    }
  }

  lastDir = bestDir;
  ws.send(JSON.stringify({ type: 'move', direction: bestDir }));
};

ws.onclose = () => {};
ws.onerror = () => {};
