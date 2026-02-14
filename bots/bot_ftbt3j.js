// 超大螃蟹 Bot — Flood Fill + Food Chase + Enemy Avoidance
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1, name: 'up' },
  { x: 0, y: 1, name: 'down' },
  { x: -1, y: 0, name: 'left' },
  { x: 1, y: 0, name: 'right' }
];

let lastDir = null;
let stuckCount = 0;
let lastHead = null;

function isOpposite(a, b) {
  return a && b && a.x === -b.x && a.y === -b.y;
}

function inBounds(x, y) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}

function buildGrid(state, myId) {
  const grid = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  for (const p of state.players) {
    if (!p.body) continue;
    for (const seg of p.body) {
      if (inBounds(seg.x, seg.y)) grid[seg.y][seg.x] = 1;
    }
    // Mark cells adjacent to enemy heads as dangerous (avoid head-on)
    if (p.botId !== myId && p.head) {
      for (const d of DIRS) {
        const nx = p.head.x + d.x;
        const ny = p.head.y + d.y;
        if (inBounds(nx, ny) && grid[ny][nx] !== 1) {
          // Only mark as danger if enemy is longer or equal
          const me = state.players.find(pl => pl.botId === myId);
          const myLen = me && me.body ? me.body.length : 1;
          const enemyLen = p.body ? p.body.length : 1;
          if (enemyLen >= myLen) {
            grid[ny][nx] = 2; // danger zone
          }
        }
      }
    }
  }
  return grid;
}

function floodFill(grid, sx, sy) {
  if (!inBounds(sx, sy) || grid[sy][sx] === 1) return 0;
  const visited = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  const queue = [{ x: sx, y: sy }];
  visited[sy][sx] = 1;
  let count = 0;
  while (queue.length > 0) {
    const { x, y } = queue.shift();
    count++;
    for (const d of DIRS) {
      const nx = x + d.x, ny = y + d.y;
      if (inBounds(nx, ny) && !visited[ny][nx] && grid[ny][nx] !== 1) {
        visited[ny][nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return count;
}

function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: '🦀超大螃蟹',
    botType: 'agent',
    botId: CONFIG.botId
  }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw);
  if (msg.type !== 'update') return;

  const state = msg.state;
  const me = state.players.find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  // Detect stuck
  if (lastHead && lastHead.x === me.head.x && lastHead.y === me.head.y) {
    stuckCount++;
  } else {
    stuckCount = 0;
  }
  lastHead = { x: me.head.x, y: me.head.y };

  const grid = buildGrid(state, CONFIG.botId);
  const myLen = me.body ? me.body.length : 1;

  // Evaluate candidates
  const candidates = DIRS
    .filter(d => !isOpposite(d, lastDir))
    .map(d => {
      const nx = me.head.x + d.x;
      const ny = me.head.y + d.y;
      if (!inBounds(nx, ny) || grid[ny][nx] === 1) return null;
      const isDanger = grid[ny][nx] === 2;
      const space = floodFill(grid, nx, ny);
      let foodDist = Infinity;
      for (const f of (state.food || [])) {
        foodDist = Math.min(foodDist, dist({ x: nx, y: ny }, f));
      }
      return { dir: d, nx, ny, space, foodDist, isDanger };
    })
    .filter(Boolean);

  if (candidates.length === 0) return;

  // If stuck, go random
  if (stuckCount > 3) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    lastDir = pick.dir;
    ws.send(JSON.stringify({ type: 'move', direction: { x: pick.dir.x, y: pick.dir.y } }));
    return;
  }

  // Sort: avoid danger zones > prefer more space > closer food
  candidates.sort((a, b) => {
    // Prefer non-danger
    if (a.isDanger !== b.isDanger) return a.isDanger ? 1 : -1;
    // Need enough space for body
    const aOk = a.space >= myLen ? 1 : 0;
    const bOk = b.space >= myLen ? 1 : 0;
    if (aOk !== bOk) return bOk - aOk;
    // More space is better (but diminishing returns)
    if (Math.abs(b.space - a.space) > 10) return b.space - a.space;
    // Closer food
    return a.foodDist - b.foodDist;
  });

  const best = candidates[0];
  lastDir = best.dir;
  ws.send(JSON.stringify({ type: 'move', direction: { x: best.dir.x, y: best.dir.y } }));
});

ws.on('close', () => {});
ws.on('error', () => {});
