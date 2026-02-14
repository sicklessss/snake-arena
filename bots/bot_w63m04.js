// Advanced Snake Bot - Flood Fill + Food Chase + Head Avoidance
const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;
const DIRS = [
  { x: 0, y: -1 },  // up
  { x: 0, y: 1 },   // down
  { x: -1, y: 0 },  // left
  { x: 1, y: 0 }    // right
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

function buildGrid(state) {
  const grid = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  for (const p of state.players) {
    if (!p.body) continue;
    for (const seg of p.body) {
      if (inBounds(seg.x, seg.y)) grid[seg.y][seg.x] = 1;
    }
  }
  return grid;
}

// Flood fill to count reachable space
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

// Check if an enemy head could move to (x,y) next tick
function enemyHeadThreat(state, me, x, y) {
  for (const p of state.players) {
    if (!p.body || !p.head) continue;
    if (p.botId === CONFIG.botId) continue;
    const d = dist(p.head, { x, y });
    if (d <= 1) {
      // Adjacent to enemy head - dangerous if they're >= our length
      const myLen = me.body ? me.body.length : 1;
      const theirLen = p.body ? p.body.length : 1;
      if (theirLen >= myLen) return true;
    }
  }
  return false;
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'OpenClaw',
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

  const grid = buildGrid(state);
  const myLen = me.body ? me.body.length : 1;

  // Evaluate each direction
  const candidates = DIRS
    .filter(d => !isOpposite(d, lastDir))
    .map(d => {
      const nx = me.head.x + d.x;
      const ny = me.head.y + d.y;
      if (!inBounds(nx, ny) || grid[ny][nx] === 1) return null;

      const space = floodFill(grid, nx, ny);

      // Find nearest food distance
      let foodDist = Infinity;
      for (const f of (state.food || [])) {
        foodDist = Math.min(foodDist, dist({ x: nx, y: ny }, f));
      }

      // Enemy head threat
      const headThreat = enemyHeadThreat(state, me, nx, ny);

      // Scoring
      let score = 0;

      // Space is critical - must have enough room to survive
      if (space < myLen) {
        score -= 10000;
      }
      score += space * 3;

      // Food proximity bonus
      if (foodDist < Infinity) {
        score += (GRID * 2 - foodDist) * 2;
      }

      // Penalize enemy head proximity heavily
      if (headThreat) {
        score -= 5000;
      }

      // Slight preference for center
      const cx = Math.abs(nx - GRID / 2);
      const cy = Math.abs(ny - GRID / 2);
      score -= (cx + cy) * 0.5;

      // Continuity bonus: prefer going in the same direction (smoother path)
      if (lastDir && d.x === lastDir.x && d.y === lastDir.y) {
        score += 5;
      }

      return { dir: d, nx, ny, space, foodDist, score };
    })
    .filter(Boolean);

  if (candidates.length === 0) {
    // Desperation: try any direction including reverse
    const desperate = DIRS.map(d => {
      const nx = me.head.x + d.x;
      const ny = me.head.y + d.y;
      if (!inBounds(nx, ny) || grid[ny][nx] === 1) return null;
      return { dir: d };
    }).filter(Boolean);

    if (desperate.length > 0) {
      const pick = desperate[Math.floor(Math.random() * desperate.length)];
      lastDir = pick.dir;
      ws.send(JSON.stringify({ type: 'move', direction: pick.dir }));
    }
    return;
  }

  // If stuck, add randomness
  if (stuckCount > 3) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    lastDir = pick.dir;
    ws.send(JSON.stringify({ type: 'move', direction: pick.dir }));
    return;
  }

  // Pick highest score
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  lastDir = best.dir;
  ws.send(JSON.stringify({ type: 'move', direction: best.dir }));
});

ws.on('close', () => {});
ws.on('error', () => {});
