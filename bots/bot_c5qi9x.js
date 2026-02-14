// NexusSerpent - Advanced Snake AI
// Features: Flood Fill, Wall/Body Avoidance, Food Targeting, Head-on Collision Avoidance

const ws = new WebSocket(CONFIG.serverUrl);
const GRID = 30;

let lastDir = null;
const DIRS = [
  { x: 0, y: -1, name: 'up' },
  { x: 0, y: 1, name: 'down' },
  { x: -1, y: 0, name: 'left' },
  { x: 1, y: 0, name: 'right' }
];

function isOpposite(a, b) {
  if (!a || !b) return false;
  return a.x === -b.x && a.y === -b.y;
}

// Build a danger grid: walls + all snake bodies
function buildGrid(state, myId) {
  const grid = Array.from({ length: GRID }, () => new Uint8Array(GRID)); // 0 = safe
  for (const p of state.players) {
    if (!p.body) continue;
    for (const seg of p.body) {
      if (seg.x >= 0 && seg.x < GRID && seg.y >= 0 && seg.y < GRID) {
        grid[seg.y][seg.x] = 1; // blocked
      }
    }
    // Mark head position too
    if (p.head && p.head.x >= 0 && p.head.x < GRID && p.head.y >= 0 && p.head.y < GRID) {
      grid[p.head.y][p.head.x] = 1;
    }
  }
  return grid;
}

// Mark danger zones around enemy heads (cells they could move into next tick)
function markEnemyHeadDanger(grid, state, myId) {
  for (const p of state.players) {
    if (p.botId === myId || !p.head) continue;
    for (const d of DIRS) {
      const nx = p.head.x + d.x;
      const ny = p.head.y + d.y;
      if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) {
        // Mark as risky (2 = enemy head danger zone)
        if (grid[ny][nx] === 0) grid[ny][nx] = 2;
      }
    }
  }
}

function inBounds(x, y) {
  return x >= 0 && x < GRID && y >= 0 && y < GRID;
}

function isSafe(grid, x, y) {
  return inBounds(x, y) && grid[y][x] === 0;
}

function isPassable(grid, x, y) {
  return inBounds(x, y) && grid[y][x] !== 1; // allow danger zone (2) as passable but risky
}

// Flood fill to count reachable cells from (sx, sy)
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
      const nx = x + d.x;
      const ny = y + d.y;
      if (inBounds(nx, ny) && !visited[ny][nx] && grid[ny][nx] !== 1) {
        visited[ny][nx] = 1;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return count;
}

// Manhattan distance
function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'NexusSerpent',
    botType: 'agent',
    botId: CONFIG.botId
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  if (msg.type !== 'update') return;
  const { state } = msg;

  const me = state.players.find(p => p.botId === CONFIG.botId);
  if (!me || !me.head) return;

  const grid = buildGrid(state, CONFIG.botId);
  markEnemyHeadDanger(grid, state, CONFIG.botId);

  const myLen = me.body ? me.body.length : 1;

  // Filter out opposite direction (can't go back)
  let candidates = DIRS.filter(d => !isOpposite(d, lastDir));

  // Score each candidate direction
  let scored = candidates.map(d => {
    const nx = me.head.x + d.x;
    const ny = me.head.y + d.y;

    // Out of bounds or wall/body = dead
    if (!inBounds(nx, ny) || grid[ny][nx] === 1) {
      return { dir: d, score: -99999 };
    }

    let score = 0;

    // Flood fill: how much space is reachable from this cell?
    const space = floodFill(grid, nx, ny);

    // If reachable space < our body length, it's a trap — heavily penalize
    if (space < myLen) {
      score -= 5000;
    } else if (space < myLen * 2) {
      score -= 1000;
    }
    // Reward more open space
    score += space * 2;

    // Enemy head danger zone penalty
    if (grid[ny][nx] === 2) {
      score -= 500;
    }

    // Find closest food and reward moving toward it
    let bestFoodDist = Infinity;
    for (const f of state.food) {
      const fd = dist({ x: nx, y: ny }, f);
      if (fd < bestFoodDist) bestFoodDist = fd;
    }
    if (bestFoodDist < Infinity) {
      score += (GRID * 2 - bestFoodDist) * 3;
    }

    // Prefer center-ish positions (avoid edges early)
    const centerDist = Math.abs(nx - GRID / 2) + Math.abs(ny - GRID / 2);
    score -= centerDist * 0.5;

    // Penalize hugging walls
    if (nx === 0 || nx === GRID - 1 || ny === 0 || ny === GRID - 1) {
      score -= 50;
    }

    return { dir: d, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Pick the best move
  const best = scored[0];
  const move = best.score > -99999 ? best.dir : (candidates[0] || DIRS[0]);

  lastDir = move;
  ws.send(JSON.stringify({ type: 'move', direction: move }));
});
